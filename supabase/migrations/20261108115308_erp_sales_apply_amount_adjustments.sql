begin;

-- NULL marks historical/record-only approvals. No historical balance backfill.
alter table public.erp_sales_adjustment_events add column sales_delta bigint
  check (sales_delta is null or (action='approve' and sales_delta between -2000000000000 and 2000000000000));

create or replace function private.erp_sales_customer_position(p_sale_id uuid)
returns table(effective_total numeric, gross_received numeric, refunded numeric, net_received numeric, balance numeric)
language sql stable set search_path = '' as $$
  select adjusted.total, receipts.gross, changes.refunded, receipts.gross - changes.refunded,
    greatest(adjusted.total - receipts.gross + changes.refunded, 0)
  from public.erp_sales_transactions s
  cross join lateral (
    select coalesce(sum(case when r.reverses_id is null then r.amount else -r.amount end),0) as gross
    from public.erp_sales_receipts r where r.sale_id=s.id
  ) receipts
  cross join lateral (
    select coalesce(bool_or(a.kind='cancel_order' and e.action='approve'),false) as cancelled,
      coalesce(sum((a.detail->>'credit_amount')::numeric) filter(where a.kind='return_goods' and e.action='approve'),0) as credits,
      coalesce(sum(e.amount) filter(where e.action='refund'),0) as refunded,
      coalesce(sum(e.sales_delta),0) as sales_delta
    from public.erp_sales_adjustments a join public.erp_sales_adjustment_events e on e.adjustment_id=a.id
    where a.sale_id=s.id
  ) changes
  cross join lateral (select case when changes.cancelled then 0 else s.total_amount-changes.credits+changes.sales_delta end as total) adjusted
  where s.id=p_sale_id;
$$;

create or replace function public.erp_sales_list_adjustments(p_sale_id uuid)
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
        'amount',e.amount,'note',e.note,'sales_delta',e.sales_delta) order by e.created_at,e.id)
        from public.erp_sales_adjustment_events e where e.adjustment_id=a.id),'[]'::jsonb))
      order by a.created_at,a.id)
    from public.erp_sales_adjustments a where a.sale_id=p_sale_id
  ),'[]'::jsonb);
end;
$$;


create function public.erp_sales_amount_adjustments_ready()
returns boolean language sql stable set search_path = '' as $$
  select public.erp_sales_can('read');
$$;

-- Existing approval RPC remains record-only for older clients. This explicit
-- endpoint applies newly approved target totals, under the same sale row lock.
create function public.erp_sales_approve_amount_adjustment(
  p_sale_id uuid,p_adjustment_id uuid,p_request_id uuid,p_on date,p_note text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_adjustment public.erp_sales_adjustments;
  v_existing public.erp_sales_adjustment_events;
  v_note text := btrim(coalesce(p_note,''));
  v_current numeric;
  v_target numeric;
  v_delta bigint;
begin
  perform private.erp_sales_guard('write');
  perform private.erp_sales_guard('confirm');
  perform private.erp_sales_guard('read');
  perform 1 from public.erp_sales_transactions where id=p_sale_id
    and organization_key='taejang' and status='confirmed' for update;
  if not found then raise exception using errcode='22023',message='ERP_RECEIPT_CONFIRMED_REQUIRED'; end if;
  select * into v_adjustment from public.erp_sales_adjustments where id=p_adjustment_id and sale_id=p_sale_id;
  if not found or v_adjustment.kind not in ('service_change','sales_change') then
    raise exception using errcode='22023',message='ERP_ADJUSTMENT_INVALID_INPUT';
  end if;
  if p_request_id is null or p_on is null or not isfinite(p_on)
     or p_on<v_adjustment.requested_on or p_on>(now() at time zone 'Asia/Seoul')::date
     or length(v_note) not between 1 and 500 then
    raise exception using errcode='22023',message='ERP_ADJUSTMENT_INVALID_INPUT';
  end if;
  select * into v_existing from public.erp_sales_adjustment_events where id=p_request_id;
  if found then
    if v_existing.sales_delta is null or
       (v_existing.adjustment_id,v_existing.action,v_existing.recorded_on,v_existing.note)
       is distinct from (p_adjustment_id,'approve',p_on,v_note) then
      raise exception using errcode='22023',message='ERP_REQUEST_REUSE';
    end if;
    return public.erp_sales_list_adjustments(p_sale_id);
  end if;
  if exists(select 1 from public.erp_sales_adjustment_events
    where adjustment_id=p_adjustment_id and action in ('approve','reject')) then
    raise exception using errcode='22023',message='ERP_ADJUSTMENT_DUPLICATE';
  end if;
  if exists(select 1 from public.erp_sales_adjustments a
    join public.erp_sales_adjustment_events e on e.adjustment_id=a.id and e.action='approve'
    where a.sale_id=p_sale_id and a.kind='cancel_order') then
    raise exception using errcode='22023',message='ERP_ADJUSTMENT_CANCELLED_SALE';
  end if;
  perform private.erp_sales_check_adjustment(p_sale_id,v_adjustment.kind,v_adjustment.detail);
  select effective_total into strict v_current from private.erp_sales_customer_position(p_sale_id);
  v_target:=(v_adjustment.detail->>'amount')::numeric;
  v_delta:=(v_target-v_current)::bigint;
  -- The existing event period trigger enforces closed-month protection.
  insert into public.erp_sales_adjustment_events(id,adjustment_id,action,recorded_on,amount,note,actor_id,sales_delta)
    values(p_request_id,p_adjustment_id,'approve',p_on,null,v_note,auth.uid(),v_delta);
  perform private.erp_sales_history('adjustment',p_adjustment_id,'adjustment_approve',null,
    jsonb_build_object('event_id',p_request_id,'recorded_on',p_on,
      'before_effective_total',v_current,'effective_total',v_target,'sales_delta',v_delta));
  return public.erp_sales_list_adjustments(p_sale_id);
end;
$$;

revoke all on function public.erp_sales_amount_adjustments_ready(),
  public.erp_sales_approve_amount_adjustment(uuid,uuid,uuid,date,text) from public,anon,authenticated;
grant execute on function public.erp_sales_amount_adjustments_ready(),
  public.erp_sales_approve_amount_adjustment(uuid,uuid,uuid,date,text) to authenticated;

commit;
