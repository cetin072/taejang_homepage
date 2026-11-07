begin;

create function public.erp_sales_payout_queue_ready()
returns boolean language sql stable set search_path = '' as $$
  select public.erp_sales_can('read');
$$;

create function public.erp_sales_list_pending_payouts(
  p_kind text default null, p_due_to date default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  perform private.erp_sales_guard('read');
  if (p_kind is not null and p_kind not in ('commission','supplier'))
     or (p_due_to is not null and not isfinite(p_due_to)) then
    raise exception using errcode='22023',message='ERP_PAYOUT_INVALID_INPUT';
  end if;
  with pending as (
    select p.id,p.sale_id,p.kind,p.due_on,p.cycle,p.amount,
      offsets.amount as offset_amount,p.amount-offsets.amount as cash_amount,
      s.sales_date,s.party_snapshot->>'name' as party_name,
      case when p.kind='commission' then s.agent_snapshot->>'name'
        else s.supplier_snapshot->>'name' end as payee_name,
      exists(select 1 from public.erp_sales_adjustments a
        join public.erp_sales_adjustment_events e on e.adjustment_id=a.id and e.action='approve'
        where a.sale_id=s.id and a.kind='cancel_order') as cancelled_sale
    from public.erp_sales_payouts p
    join public.erp_sales_transactions s on s.id=p.sale_id
    cross join lateral (
      select coalesce(sum(o.amount),0) as amount
      from public.erp_sales_commission_offsets o where o.payout_id=p.id
    ) offsets
    where s.organization_key='taejang' and s.status='confirmed' and p.outcome is null
      and (p_kind is null or p.kind=p_kind)
      and (p_due_to is null or p.due_on<=p_due_to)
  )
  select jsonb_build_object(
    'total',count(*),'total_amount',coalesce(sum(amount),0)::text,
    'total_offset',coalesce(sum(offset_amount),0)::text,
    'total_cash',coalesce(sum(cash_amount),0)::text,'limit',200,
    'items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.due_on,x.id),'[]'::jsonb)
      from (select * from pending order by due_on,id limit 200) x)
  ) into v_result from pending;
  return v_result;
end;
$$;

revoke all on function public.erp_sales_payout_queue_ready(),
  public.erp_sales_list_pending_payouts(text,date) from public,anon,authenticated;
grant execute on function public.erp_sales_payout_queue_ready(),
  public.erp_sales_list_pending_payouts(text,date) to authenticated;

commit;
