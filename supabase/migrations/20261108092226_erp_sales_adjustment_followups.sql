begin;

create function public.erp_sales_adjustment_followups_ready()
returns boolean language sql stable set search_path = '' as $$
  select public.erp_sales_can('read');
$$;

create function public.erp_sales_list_pending_followups(p_kind text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  perform private.erp_sales_guard('read');
  if p_kind is not null and p_kind not in
    ('cancel_order','return_goods','service_change','sales_change','commission_change') then
    raise exception using errcode='22023',message='ERP_ADJUSTMENT_INVALID_INPUT';
  end if;
  with approved as (
    select a.id,a.sale_id,a.kind,a.reason,decision.recorded_on as approved_on,
      decision.created_at as approved_at,s.party_snapshot->>'name' as party_name,
      a.kind='return_goods' and not events.recalled as recall_pending,
      greatest(coalesce((a.detail->>'refund_plan')::numeric,0)-events.refunded,0) as refund_remaining
    from public.erp_sales_adjustments a
    join public.erp_sales_transactions s on s.id=a.sale_id
    join public.erp_sales_adjustment_events decision on decision.adjustment_id=a.id and decision.action='approve'
    cross join lateral (
      select coalesce(bool_or(e.action='recall'),false) as recalled,
        coalesce(sum(e.amount) filter(where e.action='refund'),0) as refunded
      from public.erp_sales_adjustment_events e where e.adjustment_id=a.id
    ) events
    where s.organization_key='taejang' and s.status='confirmed'
      and a.kind in ('cancel_order','return_goods') and (p_kind is null or a.kind=p_kind)
  ), pending as (
    select * from approved where recall_pending or refund_remaining>0
  )
  select jsonb_build_object('total',count(*),'limit',200,
    'total_refund_remaining',coalesce(sum(refund_remaining),0)::text,
    'items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.approved_on,x.approved_at,x.id),'[]'::jsonb)
      from (select * from pending order by approved_on,approved_at,id limit 200) x)
  ) into v_result from pending;
  return v_result;
end;
$$;

revoke all on function public.erp_sales_adjustment_followups_ready(),
  public.erp_sales_list_pending_followups(text) from public,anon,authenticated;
grant execute on function public.erp_sales_adjustment_followups_ready(),
  public.erp_sales_list_pending_followups(text) to authenticated;

commit;
