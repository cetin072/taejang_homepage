begin;

create function public.erp_sales_adjustment_queue_ready()
returns boolean language sql stable set search_path = '' as $$
  select public.erp_sales_can('read');
$$;

create function public.erp_sales_list_pending_adjustments(p_kind text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  perform private.erp_sales_guard('read');
  if p_kind is not null and p_kind not in
    ('cancel_order','return_goods','service_change','sales_change','commission_change') then
    raise exception using errcode='22023',message='ERP_ADJUSTMENT_INVALID_INPUT';
  end if;
  with pending as (
    select a.id,a.sale_id,a.kind,a.requested_on,a.reason,a.created_at,
      s.party_snapshot->>'name' as party_name
    from public.erp_sales_adjustments a
    join public.erp_sales_transactions s on s.id=a.sale_id
    where s.organization_key='taejang' and s.status='confirmed'
      and (p_kind is null or a.kind=p_kind)
      and not exists(select 1 from public.erp_sales_adjustment_events e
        where e.adjustment_id=a.id and e.action in ('approve','reject'))
  )
  select jsonb_build_object('total',count(*),'limit',200,
    'items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_on,x.created_at,x.id),'[]'::jsonb)
      from (select * from pending order by requested_on,created_at,id limit 200) x)
  ) into v_result from pending;
  return v_result;
end;
$$;

revoke all on function public.erp_sales_adjustment_queue_ready(),
  public.erp_sales_list_pending_adjustments(text) from public,anon,authenticated;
grant execute on function public.erp_sales_adjustment_queue_ready(),
  public.erp_sales_list_pending_adjustments(text) to authenticated;

commit;
