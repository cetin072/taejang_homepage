-- Calculate contractual percentage fees and surface outstanding monthly supplier payments.
begin;

-- Previously saved monthly terms can lack a day. When supplied, validate the
-- day before it is copied into the immutable sale snapshot.
alter table public.erp_sales_items add constraint erp_sales_supplier_due_day_valid check (
  not (automation ? 'supplier_due_day') or (
    automation->>'supplier_cycle' = 'monthly'
    and jsonb_typeof(automation->'supplier_due_day') = 'number'
    and automation->>'supplier_due_day' ~ '^([1-9]|[12][0-9]|3[01])$'
  )
);

create function private.erp_sales_supplier_due_on(p_sales_date date, p_snapshot jsonb)
returns date language sql immutable set search_path = '' as $$
  select case when p_snapshot->>'supplier_cycle' = 'monthly'
    and p_snapshot->'lines'->0->'defaults'->>'supplier_due_day' is not null
    then least(
      (date_trunc('month', p_sales_date::timestamp) + interval '1 month')::date +
        ((p_snapshot->'lines'->0->'defaults'->>'supplier_due_day')::integer - 1),
      (date_trunc('month', p_sales_date::timestamp) + interval '2 months')::date - 1
    ) end;
$$;
revoke all on function private.erp_sales_supplier_due_on(date,jsonb) from public,anon,authenticated;


create or replace function private.erp_sales_payout_summary_legacy(p_sale_id uuid, p_kind text, p_basis_amount numeric default null)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_sale public.erp_sales_transactions;
  v_received numeric;
  v_basis numeric;
  v_cycle text;
  v_paid numeric;
  v_pending numeric;
  v_cash_paid numeric;
  v_allowed numeric := 0;
  v_entries jsonb;
begin
  select * into v_sale from public.erp_sales_transactions
    where id = p_sale_id and organization_key = 'taejang' and status = 'confirmed';
  if not found then
    raise exception using errcode = '22023', message = 'ERP_RECEIPT_CONFIRMED_REQUIRED';
  end if;
  if p_kind = 'commission' and (v_sale.agent_id is null or (v_sale.commission->>'value')::numeric <= 0) then
    return null;
  elsif p_kind = 'supplier' and v_sale.supplier_id is null then
    return null;
  elsif p_kind is null or p_kind not in ('commission', 'supplier') then
    raise exception using errcode = '22023', message = 'ERP_PAYOUT_INVALID_INPUT';
  end if;

  select coalesce(sum(case when reverses_id is null then amount else -amount end), 0)
    into v_received from public.erp_sales_receipts where sale_id = p_sale_id;
  select basis_amount, cycle into v_basis, v_cycle from public.erp_sales_payouts
    where sale_id = p_sale_id and kind = p_kind and outcome is distinct from 'cancelled'
    order by approved_at, id limit 1;
  if p_kind = 'commission' and v_sale.commission->>'kind' = 'fixed' then
    v_basis := (v_sale.commission->>'value')::numeric;
  elsif p_kind = 'commission' and v_sale.commission->>'kind' = 'rate'
    and v_sale.automation_snapshot is null and v_basis is null then
    v_basis := round((case v_sale.commission->>'basis'
      when 'total' then v_sale.total_amount else v_sale.supply_amount end)
      * (v_sale.commission->>'value')::numeric / 100);
  end if;
  if v_basis is not null and p_basis_amount is not null and v_basis <> p_basis_amount then
    raise exception using errcode = '22023', message = 'ERP_PAYOUT_BASIS_CONFLICT';
  end if;
  v_basis := coalesce(v_basis, p_basis_amount);

  select coalesce(sum(p.amount) filter (where outcome = 'paid'), 0),
         coalesce(sum(p.amount) filter (where outcome is null), 0),
         coalesce(sum(p.amount - offsets.amount) filter (where outcome = 'paid'), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'amount', p.amount, 'offset', offsets.amount, 'cash_amount', p.amount - offsets.amount, 'cycle', cycle, 'due_on', due_on,
           'approval_evidence', approval_evidence, 'outcome', outcome,
           'outcome_on', outcome_on, 'outcome_evidence', outcome_evidence
         ) order by approved_at, id), '[]'::jsonb)
    into v_paid, v_pending, v_cash_paid, v_entries from public.erp_sales_payouts p
    cross join lateral (
      select coalesce(sum(o.amount),0) as amount from public.erp_sales_commission_offsets o where o.payout_id=p.id
    ) offsets
    where sale_id = p_sale_id and kind = p_kind;

  if v_received > 0 and v_basis is not null then
    if p_kind = 'supplier' or v_received >= v_sale.total_amount then
      v_allowed := v_basis;
    elsif v_sale.commission->>'settlement_rule' = 'proportional' then
      v_allowed := floor(v_basis * v_received / v_sale.total_amount);
    end if;
  end if;

  return jsonb_build_object(
    'name', case when p_kind = 'commission' then v_sale.agent_snapshot->>'name' else v_sale.supplier_snapshot->>'name' end,
    'commission', case when p_kind = 'commission' then v_sale.commission else null end,
    'basis', v_basis, 'cycle', v_cycle, 'received', v_received, 'allowed', v_allowed,
    'paid', v_paid, 'cash_paid', v_cash_paid, 'pending', v_pending, 'remaining', v_basis - v_paid, 'entries', v_entries
  );
end;
$$;

create or replace function private.erp_sales_prepare_product(p_data jsonb) returns jsonb language plpgsql set search_path='' as $$
declare i public.erp_sales_items;a jsonb;c jsonb;price jsonb;cost jsonb;line jsonb;lines jsonb:='[]';snap jsonb:='[]';d jsonb:=p_data;sid uuid;fulfillment text;fee jsonb;purchase_supply numeric:=0;purchase_tax numeric:=0;sup numeric:=0;tax numeric:=0;commission_amount numeric;begin
 if jsonb_typeof(d) is distinct from 'object' or octet_length(d::text)>64000 or jsonb_typeof(d->'lines') is distinct from 'array' or jsonb_array_length(d->'lines') not between 1 and 50 then raise exception 'ERP_LINES_REQUIRED';end if;
 for line in select value from jsonb_array_elements(d->'lines') loop
  select * into i from public.erp_sales_items where id=(line->>'item_id')::uuid and organization_key='taejang' and active and kind<>'service';
  if not found or i.automation is null then raise exception 'ERP_ITEM_DEFAULTS_REQUIRED';end if;
  a:=i.automation;c:=coalesce(d->'commission',a->'commission');
  if sid is not null and (sid<>(a->>'supplier_id')::uuid or fulfillment<>a->>'fulfillment' or fee<>c or (snap->0->'defaults'->>'supplier_cycle')<>a->>'supplier_cycle'
    or (snap->0->'defaults'->>'supplier_due_day') is distinct from (a->>'supplier_due_day')) then raise exception 'ERP_SPLIT_SUPPLIER_OR_TERMS_REQUIRED';end if;
  sid:=(a->>'supplier_id')::uuid;fulfillment:=a->>'fulfillment';fee:=c;
  price:=private.erp_sales_price(coalesce(nullif(line->>'entered_price','')::numeric,i.base_price),(line->>'quantity')::numeric,coalesce(line->>'pricing_basis',i.pricing_basis),i.tax_class);
  cost:=private.erp_sales_price((a->>'purchase_price')::numeric,(line->>'quantity')::numeric,a->>'purchase_pricing_basis',a->>'purchase_tax_class');
  lines:=lines||jsonb_build_array(jsonb_build_object('item_id',i.id,'quantity',(line->>'quantity')::numeric,'unit_price',price->'unit_price','tax_class',i.tax_class,'tax_amount',price->'tax'));
  snap:=snap||jsonb_build_array(jsonb_build_object('item_id',i.id,'code',i.code,'unit',i.unit,'quantity',line->'quantity','entered_price',coalesce(nullif(line->>'entered_price','')::numeric,i.base_price),'pricing_basis',coalesce(line->>'pricing_basis',i.pricing_basis),'defaults',a,'purchase_supply',cost->'supply','purchase_tax',cost->'tax','sales_supply',price->'supply','sales_total',price->'total'));
  purchase_supply:=purchase_supply+(cost->>'supply')::numeric;purchase_tax:=purchase_tax+(cost->>'tax')::numeric;sup:=sup+(price->>'supply')::numeric;tax:=tax+(price->>'tax')::numeric;
 end loop;
 if fee->>'kind' is null or fee->>'kind' not in ('none','fixed','rate') or jsonb_typeof(fee->'value') is distinct from 'number' or not ((fee->>'value')::numeric between 0 and case when fee->>'kind'='rate' then 100 else 2000000000000 end) or (fee->>'kind'='none' and (fee->>'value')::numeric<>0) or fee->>'settlement_rule' is null or fee->>'settlement_rule' not in ('after_full_payment','proportional') then raise exception 'ERP_INVALID_COMMISSION';end if;
 if fee->>'basis' is null or fee->>'basis' not in ('supply','total') then raise exception 'ERP_INVALID_COMMISSION';end if;
 commission_amount:=case fee->>'kind' when 'none' then 0 when 'fixed' then (fee->>'value')::numeric when 'rate' then round((case fee->>'basis' when 'supply' then sup else sup+tax end)*(fee->>'value')::numeric/100) end;
 return jsonb_build_object('data',d||jsonb_build_object('kind','product','supplier_id',sid,'order_date',coalesce(d->>'order_date',d->>'sales_date'),'order_channel',coalesce(d->>'order_channel','other'),'shipping_status',coalesce(d->>'shipping_status','preparing'),'commission',fee,'lines',lines),
 'snapshot',jsonb_build_object('version',1,'fulfillment',fulfillment,'supplier_cycle',a->>'supplier_cycle','lines',snap,'purchase_supply',purchase_supply,'purchase_tax',purchase_tax,'commission_amount',commission_amount,'commission',fee),
 'supply',sup,'tax',tax,'total',sup+tax);
end $$;

create or replace function private.erp_sales_payout_summary(p_sale_id uuid,p_kind text,p_basis_amount numeric default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.erp_sales_transactions;r jsonb;pos jsonb;basis numeric;planned numeric;allowed numeric:=0;settled_offset numeric:=0;begin
 select * into s from public.erp_sales_transactions where id=p_sale_id and organization_key='taejang';
 if s.automation_snapshot is null then return private.erp_sales_payout_summary_legacy(p_sale_id,p_kind,p_basis_amount);end if;
 if p_kind not in ('supplier','commission') or p_kind is null then raise exception 'ERP_PAYOUT_INVALID_INPUT';end if;
 basis:=case p_kind when 'supplier' then (s.automation_snapshot->>'purchase_supply')::numeric+(s.automation_snapshot->>'purchase_tax')::numeric else (s.automation_snapshot->>'commission_amount')::numeric end;
 if p_basis_amount is not null and p_basis_amount<>basis then raise exception 'ERP_PAYOUT_BASIS_CONFLICT';end if;
 r:=private.erp_sales_payout_summary_legacy(p_sale_id,p_kind,basis);if r is null then return null;end if;
 select coalesce(sum(case p_kind when 'supplier' then purchase_supply+purchase_tax else commission_amount end),0) into planned from public.erp_sales_accrual_events where sale_id=p_sale_id;
 select to_jsonb(p) into pos from private.erp_sales_customer_position(p_sale_id) p;
 if (pos->>'net_received')::numeric>0 and (pos->>'effective_total')::numeric>0 then
  if p_kind='supplier' or (pos->>'net_received')::numeric>=(pos->>'effective_total')::numeric then allowed:=planned;
  elsif s.commission->>'settlement_rule'='proportional' then allowed:=floor(planned*(pos->>'net_received')::numeric/(pos->>'effective_total')::numeric);end if;
 end if;
 if p_kind='commission' then select coalesce(sum(o.amount),0) into settled_offset from public.erp_sales_commission_offsets o join public.erp_sales_payouts p on p.id=o.payout_id and p.outcome='paid' join public.erp_sales_adjustments a on a.id=o.adjustment_id where a.sale_id=p_sale_id;end if;
 return r||jsonb_build_object('settled_offset',settled_offset,
  'due_on',case when p_kind='supplier' then private.erp_sales_supplier_due_on(s.sales_date,s.automation_snapshot) end,'cycle',coalesce(r->>'cycle',case when p_kind='supplier' then s.automation_snapshot->>'supplier_cycle' else 'transaction' end),'planned',planned,'allowed',allowed,'remaining',greatest(planned-(r->>'paid')::numeric,0),'unapproved',greatest(allowed-(r->>'paid')::numeric-(r->>'pending')::numeric,0),'recovery_due',greatest((r->>'paid')::numeric+(r->>'pending')::numeric-planned-settled_offset,0));
end $$;

create or replace function public.erp_sales_approve_payout(
  p_sale_id uuid, p_request_id uuid, p_kind text, p_amount numeric,
  p_evidence text, p_basis_amount numeric default null,
  p_cycle text default 'transaction', p_due_on date default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_summary jsonb;
  v_existing public.erp_sales_payouts;
  v_evidence text := btrim(coalesce(p_evidence, ''));
  v_due_on date := coalesce(p_due_on, (now() at time zone 'Asia/Seoul')::date + 7);
  v_fingerprint text := md5(jsonb_build_array(
    p_sale_id, p_kind, p_amount, p_basis_amount, p_cycle, p_due_on, v_evidence
  )::text);
begin
  perform private.erp_sales_guard('write');
  perform private.erp_sales_guard('confirm');
  perform private.erp_sales_guard('read');

  perform 1 from public.erp_sales_transactions
    where id = p_sale_id and organization_key = 'taejang' and status = 'confirmed' for update;
  if not found then
    raise exception using errcode = '22023', message = 'ERP_RECEIPT_CONFIRMED_REQUIRED';
  end if;
  if p_request_id is null or p_amount is null or not (p_amount between 1 and 2000000000000)
     or p_amount <> trunc(p_amount) or length(v_evidence) not between 1 and 500
     or (p_basis_amount is not null and (not (p_basis_amount between 1 and 2000000000000) or p_basis_amount <> trunc(p_basis_amount)))
     or p_cycle is null or p_cycle not in ('transaction', 'monthly')
     or (p_cycle = 'monthly' and (p_kind <> 'supplier' or p_due_on is null))
     or not isfinite(v_due_on) then
    raise exception using errcode = '22023', message = 'ERP_PAYOUT_INVALID_INPUT';
  end if;
  select * into v_existing from public.erp_sales_payouts where id = p_request_id;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '22023', message = 'ERP_REQUEST_REUSE';
    end if;
    return public.erp_sales_get_payouts(p_sale_id);
  end if;

  v_summary := private.erp_sales_payout_summary(p_sale_id, p_kind, p_basis_amount);
  if v_summary is null or v_summary->>'basis' is null then
    raise exception using errcode = '22023', message = 'ERP_PAYOUT_BASIS_REQUIRED';
  end if;
  if v_summary->>'cycle' is not null and v_summary->>'cycle' <> p_cycle then
    raise exception using errcode = '22023', message = 'ERP_PAYOUT_BASIS_CONFLICT';
  end if;
  if v_summary->>'due_on' is not null and v_due_on <> (v_summary->>'due_on')::date then
    raise exception using errcode = '22023', message = 'ERP_SUPPLIER_DUE_DATE_MISMATCH';
  end if;
  if p_amount > (v_summary->>'allowed')::numeric - (v_summary->>'paid')::numeric - (v_summary->>'pending')::numeric then
    raise exception using errcode = '22023', message = 'ERP_PAYOUT_OVER_LIMIT';
  end if;
  insert into public.erp_sales_payouts
    (id, request_fingerprint, sale_id, kind, basis_amount, amount, cycle, due_on, approval_evidence, approved_by)
    values (p_request_id, v_fingerprint, p_sale_id, p_kind, (v_summary->>'basis')::bigint, p_amount, p_cycle, v_due_on, v_evidence, auth.uid());
  perform private.erp_sales_history('payout', p_request_id, 'payout_approved', null,
    jsonb_build_object('sale_id', p_sale_id, 'kind', p_kind, 'amount', p_amount));
  return public.erp_sales_get_payouts(p_sale_id);
end;
$$;

-- Include confirmed, adjusted accruals before approval. Include manually dated
-- pending approvals only when the sale has no scheduled accrual, to avoid double counting.
create function public.erp_sales_list_monthly_supplier_payments()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_result jsonb;
begin
  perform private.erp_sales_guard('read');
  with scheduled_sales as materialized (
    select s.id, s.supplier_id, s.supplier_snapshot->>'name' as supplier,
      private.erp_sales_supplier_due_on(s.sales_date, s.automation_snapshot) as due_on
    from public.erp_sales_transactions s
    where s.organization_key='taejang' and s.status='confirmed' and s.supplier_id is not null
  ), positions as (
    select s.id, s.supplier_id, s.supplier, s.due_on,
      cost.amount as accrued, payments.paid, payments.pending,
      greatest(cost.amount-payments.paid,0) as unpaid
    from scheduled_sales s
    cross join lateral (
      select coalesce(sum(e.purchase_supply+e.purchase_tax),0) as amount
      from public.erp_sales_accrual_events e where e.sale_id=s.id
    ) cost
    cross join lateral (
      select coalesce(sum(p.amount) filter (where p.outcome='paid'),0) as paid,
        coalesce(sum(p.amount) filter (where p.outcome is null),0) as pending
      from public.erp_sales_payouts p where p.sale_id=s.id and p.kind='supplier'
    ) payments
    where s.due_on is not null
    union all
    select s.id, s.supplier_id, s.supplier, p.due_on,
      sum(p.amount), 0, sum(p.amount), sum(p.amount)
    from scheduled_sales s
    join public.erp_sales_payouts p on p.sale_id=s.id
    where s.due_on is null and p.kind='supplier' and p.cycle='monthly' and p.outcome is null
      and not exists (
        select 1 from public.erp_sales_adjustments a
        join public.erp_sales_adjustment_events e on e.adjustment_id=a.id and e.action='approve'
        where a.sale_id=s.id and a.kind='cancel_order'
      )
    group by s.id,s.supplier_id,s.supplier,p.due_on
  ), batches as (
    select supplier_id, max(supplier) as supplier, due_on, sum(accrued) as accrued,
      sum(paid) as paid, sum(pending) as pending, sum(unpaid) as unpaid,
      array_agg(id order by id) filter (where unpaid>0) as sale_ids
    from positions group by supplier_id,due_on having sum(unpaid)>0
  )
  select jsonb_build_object('today',v_today,
    'due_today',coalesce(sum(unpaid) filter (where due_on=v_today),0),
    'overdue',coalesce(sum(unpaid) filter (where due_on<v_today),0),
    'items',coalesce(jsonb_agg(to_jsonb(b) order by due_on,supplier,supplier_id),'[]'::jsonb))
  into v_result from batches b;
  return v_result;
end;
$$;
revoke all on function public.erp_sales_list_monthly_supplier_payments() from public,anon,authenticated;
grant execute on function public.erp_sales_list_monthly_supplier_payments() to authenticated;

create function public.erp_sales_settlement_automation_ready()
returns boolean language sql stable set search_path = '' as $$ select true; $$;
revoke all on function public.erp_sales_settlement_automation_ready() from public,anon,authenticated;
grant execute on function public.erp_sales_settlement_automation_ready() to authenticated;

commit;
