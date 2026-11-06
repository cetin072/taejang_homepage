begin;

create table public.erp_sales_adjustments (
  id uuid primary key,
  sale_id uuid not null references public.erp_sales_transactions(id),
  kind text not null check (kind in ('cancel_order','return_goods','service_change','sales_change','commission_change')),
  requested_on date not null,
  reason text not null check (length(reason) between 1 and 500),
  detail jsonb not null,
  before_data jsonb not null,
  requested_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index erp_sales_adjustments_sale on public.erp_sales_adjustments(sale_id, created_at);

create table public.erp_sales_adjustment_events (
  id uuid primary key,
  adjustment_id uuid not null references public.erp_sales_adjustments(id),
  action text not null check (action in ('approve','reject','recall','refund')),
  recorded_on date not null,
  amount bigint check (amount between 1 and 2000000000000),
  note text not null check (length(note) between 1 and 500),
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((action='refund')=(amount is not null))
);
create index erp_sales_adjustment_events_request on public.erp_sales_adjustment_events(adjustment_id, created_at);
create unique index erp_sales_adjustment_single_decision on public.erp_sales_adjustment_events(adjustment_id)
  where action in ('approve','reject');
create unique index erp_sales_adjustment_single_recall on public.erp_sales_adjustment_events(adjustment_id)
  where action='recall';

alter table public.erp_sales_adjustments enable row level security;
alter table public.erp_sales_adjustment_events enable row level security;
revoke all on public.erp_sales_adjustments, public.erp_sales_adjustment_events from public,anon,authenticated;
create trigger erp_sales_adjustments_immutable before update or delete on public.erp_sales_adjustments
  for each row execute function private.erp_sales_receipts_immutable();
create trigger erp_sales_adjustment_events_immutable before update or delete on public.erp_sales_adjustment_events
  for each row execute function private.erp_sales_receipts_immutable();

create function public.erp_sales_adjustments_ready()
returns boolean language sql stable set search_path = '' as $$
  select public.erp_sales_can('read');
$$;

create function public.erp_sales_list_adjustments(p_sale_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.erp_sales_guard('read');
  if not exists(select 1 from public.erp_sales_transactions
    where id=p_sale_id and organization_key='taejang' and status='confirmed') then
    raise exception using errcode='22023',message='ERP_RECEIPT_CONFIRMED_REQUIRED';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'requested_on',a.requested_on,
      'reason',a.reason,'detail',a.detail,'before',a.before_data,
      'events',coalesce((select jsonb_agg(jsonb_build_object('action',e.action,'recorded_on',e.recorded_on,
        'amount',e.amount,'note',e.note) order by e.created_at,e.id)
        from public.erp_sales_adjustment_events e where e.adjustment_id=a.id),'[]'::jsonb))
      order by a.created_at,a.id)
    from public.erp_sales_adjustments a where a.sale_id=p_sale_id
  ),'[]'::jsonb);
end;
$$;

create function private.erp_sales_check_adjustment(p_sale_id uuid,p_kind text,p_detail jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_sale public.erp_sales_transactions;
  v_line public.erp_sales_lines;
  v_shipping text;
  v_line_id uuid := (p_detail->>'line_id')::uuid;
  v_qty numeric := (p_detail->>'quantity')::numeric;
  v_amount numeric := (p_detail->>'amount')::numeric;
  v_refund numeric := coalesce((p_detail->>'refund_plan')::numeric,0);
  v_received numeric;
  v_reserved numeric;
  v_prior_qty numeric;
  v_paid numeric;
  v_prior_commission numeric;
begin
  select * into strict v_sale from public.erp_sales_transactions where id=p_sale_id;
  v_shipping := public.erp_sales_get(p_sale_id)->>'shippingCurrent';
  if not (v_refund between 0 and 2000000000000) or v_refund<>trunc(v_refund) then
    raise exception using errcode='22023',message='ERP_ADJUSTMENT_INVALID_INPUT';
  end if;
  if p_kind in ('cancel_order','return_goods') then
    if v_amount is not null or v_sale.kind<>'product'
       or (p_kind='cancel_order' and (v_shipping is distinct from 'preparing' or v_sale.shipping_status in ('shipped','delivered') or exists(
         select 1 from public.erp_sales_history where entity_kind='sale' and entity_id=p_sale_id
           and action='shipping' and after_data->>'status' in ('shipped','delivered')
       )))
       or (p_kind='return_goods' and coalesce(v_shipping,'') not in ('shipped','delivered')) then
      raise exception using errcode='22023',message='ERP_ADJUSTMENT_SHIPPING_STATE';
    end if;
    if exists(
      select 1 from public.erp_sales_adjustments a join public.erp_sales_adjustment_events e on e.adjustment_id=a.id and e.action='approve'
      where a.sale_id=p_sale_id and a.kind in ('cancel_order','return_goods')
        and (p_kind='cancel_order' or a.kind='cancel_order' or a.detail->>'line_id' is null or v_line_id is null)
    ) then
      raise exception using errcode='22023',message='ERP_ADJUSTMENT_DUPLICATE';
    end if;
    if p_kind='return_goods' and v_line_id is not null then
      select * into v_line from public.erp_sales_lines where id=v_line_id and sale_id=p_sale_id;
      select coalesce(sum((a.detail->>'quantity')::numeric),0) into v_prior_qty
        from public.erp_sales_adjustments a join public.erp_sales_adjustment_events e on e.adjustment_id=a.id and e.action='approve'
        where a.sale_id=p_sale_id and a.kind='return_goods' and a.detail->>'line_id'=v_line_id::text;
      if v_line.id is null or v_qty is null or not (v_qty between 0.001 and v_line.quantity-v_prior_qty)
         or v_qty<>trunc(v_qty,3) then
        raise exception using errcode='22023',message='ERP_ADJUSTMENT_QUANTITY';
      end if;
    elsif v_line_id is not null or v_qty is not null then
      raise exception using errcode='22023',message='ERP_ADJUSTMENT_INVALID_INPUT';
    end if;
    select (public.erp_sales_get_receipts(p_sale_id)->>'received')::numeric into v_received;
    select coalesce(sum((a.detail->>'refund_plan')::numeric),0) into v_reserved
      from public.erp_sales_adjustments a join public.erp_sales_adjustment_events e on e.adjustment_id=a.id and e.action='approve'
      where a.sale_id=p_sale_id;
    if v_refund>greatest(v_received-v_reserved,0) then
      raise exception using errcode='22023',message='ERP_ADJUSTMENT_REFUND_LIMIT';
    end if;
  else
    if v_refund<>0 or v_line_id is not null or v_qty is not null
       or v_amount is null or not (v_amount between 0 and 2000000000000) or v_amount<>trunc(v_amount)
       or (p_kind='service_change' and v_sale.kind<>'service')
       or (p_kind='sales_change' and v_sale.kind<>'product') then
      raise exception using errcode='22023',message='ERP_ADJUSTMENT_INVALID_INPUT';
    end if;
    if p_kind='commission_change' then
      v_paid:=coalesce((public.erp_sales_get_payouts(p_sale_id)->'commission'->>'paid')::numeric,0);
      select coalesce(sum((a.detail->>'amount')::numeric),0) into v_prior_commission
        from public.erp_sales_adjustments a join public.erp_sales_adjustment_events e on e.adjustment_id=a.id and e.action='approve'
        where a.sale_id=p_sale_id and a.kind='commission_change';
      if v_amount<=0 or v_amount+v_prior_commission>v_paid
         or coalesce(p_detail->>'commission_action','') not in ('offset','return','waive','difference') then
        raise exception using errcode='22023',message='ERP_ADJUSTMENT_INVALID_INPUT';
      end if;
    end if;
  end if;
  return jsonb_build_object('total_amount',v_sale.total_amount,'shipping',v_shipping,
    'quantity',v_line.quantity,'paid_commission',v_paid);
end;
$$;
revoke all on function private.erp_sales_check_adjustment(uuid,text,jsonb) from public,anon,authenticated;

create function public.erp_sales_request_adjustment(p_sale_id uuid,p_request_id uuid,p_kind text,p_reason text,p_detail jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_saved public.erp_sales_adjustments;
  v_reason text := btrim(coalesce(p_reason,''));
begin
  perform private.erp_sales_guard('write');
  perform private.erp_sales_guard('read');
  perform 1 from public.erp_sales_transactions where id=p_sale_id
    and organization_key='taejang' and status='confirmed' for update;
  if not found then raise exception using errcode='22023',message='ERP_RECEIPT_CONFIRMED_REQUIRED'; end if;
  if p_request_id is null or p_kind is null
     or p_kind not in ('cancel_order','return_goods','service_change','sales_change','commission_change')
     or length(v_reason) not between 1 and 500 or jsonb_typeof(p_detail) is distinct from 'object'
     or octet_length(p_detail::text)>1000 then
    raise exception using errcode='22023',message='ERP_ADJUSTMENT_INVALID_INPUT';
  end if;
  select * into v_saved from public.erp_sales_adjustments where id=p_request_id;
  if found then
    if (v_saved.sale_id,v_saved.kind,v_saved.reason,v_saved.detail) is distinct from (p_sale_id,p_kind,v_reason,p_detail) then
      raise exception using errcode='22023',message='ERP_REQUEST_REUSE';
    end if;
    return public.erp_sales_list_adjustments(p_sale_id);
  end if;
  v_before:=private.erp_sales_check_adjustment(p_sale_id,p_kind,p_detail);
  insert into public.erp_sales_adjustments(id,sale_id,kind,requested_on,reason,detail,before_data,requested_by)
    values(p_request_id,p_sale_id,p_kind,(now() at time zone 'Asia/Seoul')::date,v_reason,p_detail,v_before,auth.uid());
  perform private.erp_sales_history('adjustment',p_request_id,'adjustment_requested',v_before,p_detail);
  return public.erp_sales_list_adjustments(p_sale_id);
end;
$$;

create function public.erp_sales_record_adjustment_event(
  p_sale_id uuid,p_adjustment_id uuid,p_request_id uuid,p_action text,p_on date,p_note text,p_amount numeric default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_adjustment public.erp_sales_adjustments;
  v_existing public.erp_sales_adjustment_events;
  v_decision public.erp_sales_adjustment_events;
  v_note text := btrim(coalesce(p_note,''));
  v_received numeric;
  v_case_refunded numeric;
  v_sale_refunded numeric;
begin
  perform private.erp_sales_guard('write');
  perform private.erp_sales_guard('confirm');
  perform private.erp_sales_guard('read');
  perform 1 from public.erp_sales_transactions where id=p_sale_id
    and organization_key='taejang' and status='confirmed' for update;
  if not found then raise exception using errcode='22023',message='ERP_RECEIPT_CONFIRMED_REQUIRED'; end if;
  select * into v_adjustment from public.erp_sales_adjustments where id=p_adjustment_id and sale_id=p_sale_id;
  if not found then raise exception using errcode='22023',message='ERP_ADJUSTMENT_INVALID_INPUT'; end if;
  if p_request_id is null or p_action is null or p_action not in ('approve','reject','recall','refund')
     or p_on is null or not isfinite(p_on) or p_on<v_adjustment.requested_on
     or p_on>(now() at time zone 'Asia/Seoul')::date or length(v_note) not between 1 and 500
     or ((p_action='refund')<>(p_amount is not null))
     or (p_amount is not null and (not (p_amount between 1 and 2000000000000) or p_amount<>trunc(p_amount))) then
    raise exception using errcode='22023',message='ERP_ADJUSTMENT_INVALID_INPUT';
  end if;
  select * into v_existing from public.erp_sales_adjustment_events where id=p_request_id;
  if found then
    if (v_existing.adjustment_id,v_existing.action,v_existing.recorded_on,v_existing.note,v_existing.amount)
       is distinct from (p_adjustment_id,p_action,p_on,v_note,p_amount) then
      raise exception using errcode='22023',message='ERP_REQUEST_REUSE';
    end if;
    return public.erp_sales_list_adjustments(p_sale_id);
  end if;
  select * into v_decision from public.erp_sales_adjustment_events
    where adjustment_id=p_adjustment_id and action in ('approve','reject');
  if p_action in ('approve','reject') then
    if v_decision.id is not null then raise exception using errcode='22023',message='ERP_ADJUSTMENT_DUPLICATE'; end if;
    if p_action='approve' then
      perform private.erp_sales_check_adjustment(p_sale_id,v_adjustment.kind,v_adjustment.detail);
    end if;
  else
    if v_decision.action is distinct from 'approve' or p_on<v_decision.recorded_on then
      raise exception using errcode='22023',message='ERP_ADJUSTMENT_APPROVAL_REQUIRED';
    end if;
    if p_action='recall' and (v_adjustment.kind<>'return_goods' or exists(
      select 1 from public.erp_sales_adjustment_events where adjustment_id=p_adjustment_id and action='recall'
    )) then
      raise exception using errcode='22023',message='ERP_ADJUSTMENT_INVALID_INPUT';
    elsif p_action='refund' then
      select (public.erp_sales_get_receipts(p_sale_id)->>'received')::numeric into v_received;
      select coalesce(sum(e.amount) filter(where e.adjustment_id=p_adjustment_id),0),coalesce(sum(e.amount),0)
        into v_case_refunded,v_sale_refunded from public.erp_sales_adjustment_events e
        join public.erp_sales_adjustments a on a.id=e.adjustment_id where a.sale_id=p_sale_id and e.action='refund';
      if p_amount+v_case_refunded>coalesce((v_adjustment.detail->>'refund_plan')::numeric,0)
         or p_amount+v_sale_refunded>v_received then
        raise exception using errcode='22023',message='ERP_ADJUSTMENT_REFUND_LIMIT';
      end if;
    end if;
  end if;
  insert into public.erp_sales_adjustment_events(id,adjustment_id,action,recorded_on,amount,note,actor_id)
    values(p_request_id,p_adjustment_id,p_action,p_on,p_amount,v_note,auth.uid());
  perform private.erp_sales_history('adjustment',p_adjustment_id,'adjustment_'||p_action,null,
    jsonb_build_object('event_id',p_request_id,'recorded_on',p_on,'amount',p_amount));
  return public.erp_sales_list_adjustments(p_sale_id);
end;
$$;

revoke all on function public.erp_sales_adjustments_ready(),public.erp_sales_list_adjustments(uuid),
  public.erp_sales_request_adjustment(uuid,uuid,text,text,jsonb),
  public.erp_sales_record_adjustment_event(uuid,uuid,uuid,text,date,text,numeric) from public,anon,authenticated;
grant execute on function public.erp_sales_adjustments_ready(),public.erp_sales_list_adjustments(uuid),
  public.erp_sales_request_adjustment(uuid,uuid,text,text,jsonb),
  public.erp_sales_record_adjustment_event(uuid,uuid,uuid,text,date,text,numeric) to authenticated;

create function private.erp_sales_stop_cancelled_shipping()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.entity_kind='sale' and new.action='shipping' and exists(
    select 1 from public.erp_sales_adjustments a join public.erp_sales_adjustment_events e
      on e.adjustment_id=a.id and e.action='approve'
    where a.sale_id=new.entity_id and a.kind='cancel_order'
  ) then
    raise exception using errcode='55000',message='ERP_ADJUSTMENT_SHIPPING_STATE';
  end if;
  return new;
end;
$$;
revoke all on function private.erp_sales_stop_cancelled_shipping() from public,anon,authenticated;
create trigger erp_sales_cancelled_shipping_guard before insert on public.erp_sales_history
  for each row execute function private.erp_sales_stop_cancelled_shipping();

create function private.erp_sales_stop_cancelled_payout()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op='INSERT' or new.outcome='paid') and exists(
    select 1 from public.erp_sales_adjustments a join public.erp_sales_adjustment_events e
      on e.adjustment_id=a.id and e.action='approve'
    where a.sale_id=new.sale_id and a.kind='cancel_order'
  ) then
    raise exception using errcode='55000',message='ERP_ADJUSTMENT_CANCELLED_PAYOUT';
  end if;
  return new;
end;
$$;
revoke all on function private.erp_sales_stop_cancelled_payout() from public,anon,authenticated;
create trigger erp_sales_cancelled_payout_guard before insert or update on public.erp_sales_payouts
  for each row execute function private.erp_sales_stop_cancelled_payout();

create table public.erp_sales_month_events (
  id uuid primary key,
  month date not null check (month=date_trunc('month',month)::date),
  closed boolean not null,
  reason text not null check (length(reason) between 1 and 500),
  actor_id uuid not null references public.profiles(id),
  revision bigint generated always as identity unique,
  created_at timestamptz not null default now()
);
create index erp_sales_month_events_period on public.erp_sales_month_events(month, revision desc);
alter table public.erp_sales_month_events enable row level security;
revoke all on public.erp_sales_month_events from public,anon,authenticated;
revoke all on sequence public.erp_sales_month_events_revision_seq from public,anon,authenticated;
create trigger erp_sales_month_events_immutable before update or delete on public.erp_sales_month_events
  for each row execute function private.erp_sales_receipts_immutable();

create function private.erp_sales_month_is_closed(p_day date)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select closed from public.erp_sales_month_events
    where month=date_trunc('month',p_day)::date order by revision desc limit 1),false);
$$;
revoke all on function private.erp_sales_month_is_closed(date) from public,anon,authenticated;

create function private.erp_sales_lock_period(p_day date)
returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock(5074, (date_trunc('month',p_day)::date-date '2000-01-01'));
$$;
revoke all on function private.erp_sales_lock_period(date) from public,anon,authenticated;

create function private.erp_sales_guard_period()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_first date;
  v_second date;
begin
  if tg_op<>'INSERT' then v_old:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then v_new:=to_jsonb(new); end if;
  if tg_table_name='erp_sales_payouts' then
    -- An actual payment can occur in a later period than its approval.
    v_first:=case when tg_op='INSERT' then (now() at time zone 'Asia/Seoul')::date
      else (v_new->>'outcome_on')::date end;
  else
    v_first:=(v_old->>tg_argv[0])::date;
    v_second:=(v_new->>tg_argv[0])::date;
  end if;
  if v_first is not null and v_second is not null and v_first>v_second then
    perform private.erp_sales_lock_period(v_second);
    perform private.erp_sales_lock_period(v_first);
  else
    if v_first is not null then perform private.erp_sales_lock_period(v_first); end if;
    if v_second is not null then perform private.erp_sales_lock_period(v_second); end if;
  end if;
  if private.erp_sales_month_is_closed(v_first) or private.erp_sales_month_is_closed(v_second) then
    raise exception using errcode='55000',message='ERP_PERIOD_CLOSED';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.erp_sales_guard_period() from public,anon,authenticated;

create trigger erp_sales_month_guard before insert or update or delete on public.erp_sales_transactions
  for each row execute function private.erp_sales_guard_period('sales_date');
create trigger erp_sales_receipt_month_guard before insert on public.erp_sales_receipts
  for each row execute function private.erp_sales_guard_period('recorded_on');
create trigger erp_sales_payout_month_guard before insert or update on public.erp_sales_payouts
  for each row execute function private.erp_sales_guard_period();
create trigger erp_sales_purchase_month_guard before insert on public.erp_sales_purchases
  for each row execute function private.erp_sales_guard_period('purchased_on');
create trigger erp_sales_stock_month_guard before insert on public.erp_sales_stock_movements
  for each row execute function private.erp_sales_guard_period('moved_on');
create trigger erp_sales_evidence_month_guard before insert on public.erp_sales_evidence
  for each row execute function private.erp_sales_guard_period('issued_on');
create trigger erp_sales_adjustment_month_guard before insert on public.erp_sales_adjustments
  for each row execute function private.erp_sales_guard_period('requested_on');
create trigger erp_sales_adjustment_event_month_guard before insert on public.erp_sales_adjustment_events
  for each row execute function private.erp_sales_guard_period('recorded_on');

create function public.erp_sales_get_month_close(p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.erp_sales_guard('read');
  if p_month is null or not isfinite(p_month) or p_month<>date_trunc('month',p_month)::date then
    raise exception using errcode='22023',message='ERP_INVALID_PERIOD';
  end if;
  return jsonb_build_object('closed',private.erp_sales_month_is_closed(p_month),'events',
    (select coalesce(jsonb_agg(jsonb_build_object('closed',closed,'reason',reason,'created_at',created_at)
      order by revision desc),'[]'::jsonb) from public.erp_sales_month_events where month=p_month));
end;
$$;

create function public.erp_sales_set_month_close(
  p_month date,p_request_id uuid,p_closed boolean,p_expected_closed boolean,p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := btrim(coalesce(p_reason,''));
  v_old boolean;
  v_existing public.erp_sales_month_events;
begin
  perform private.erp_sales_guard('write');
  perform private.erp_sales_guard('confirm');
  perform private.erp_sales_guard('read');
  if p_request_id is null or p_month is null or not isfinite(p_month)
     or p_month<>date_trunc('month',p_month)::date or p_month<date '1900-01-01'
     or p_month>date_trunc('month',(now() at time zone 'Asia/Seoul'))::date
     or p_closed is null or p_expected_closed is null or length(v_reason) not between 1 and 500 then
    raise exception using errcode='22023',message='ERP_INVALID_PERIOD';
  end if;
  perform private.erp_sales_lock_period(p_month);
  select * into v_existing from public.erp_sales_month_events where id=p_request_id;
  if found then
    if (v_existing.month,v_existing.closed,v_existing.reason) is distinct from (p_month,p_closed,v_reason) then
      raise exception using errcode='22023',message='ERP_REQUEST_REUSE';
    end if;
    return public.erp_sales_get_month_close(p_month);
  end if;
  v_old:=private.erp_sales_month_is_closed(p_month);
  if v_old is distinct from p_expected_closed or v_old=p_closed then
    raise exception using errcode='40001',message='ERP_REVISION_CONFLICT';
  end if;
  insert into public.erp_sales_month_events(id,month,closed,reason,actor_id)
    values(p_request_id,p_month,p_closed,v_reason,auth.uid());
  perform private.erp_sales_history('month_close',p_request_id,case when p_closed then 'period_closed' else 'period_reopened' end,
    jsonb_build_object('month',p_month,'closed',v_old),jsonb_build_object('month',p_month,'closed',p_closed));
  return public.erp_sales_get_month_close(p_month);
end;
$$;

revoke all on function public.erp_sales_get_month_close(date),
  public.erp_sales_set_month_close(date,uuid,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.erp_sales_get_month_close(date),
  public.erp_sales_set_month_close(date,uuid,boolean,boolean,text) to authenticated;

commit;
