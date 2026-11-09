begin;

-- Add current amount without rewriting the immutable original total_amount.
-- Calculate positions only for the already limited page; preserve filters and ACL.
create or replace function public.erp_sales_list(p_from date,p_to date,p_party_id uuid default null,p_kind text default null,p_status text default null,p_agent_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_rows jsonb;v_count integer;begin
 perform private.erp_sales_guard('read');
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'ERP_INVALID_PERIOD'; end if;
 select count(*) into v_count from public.erp_sales_transactions s where organization_key='taejang' and sales_date between p_from and p_to and (p_party_id is null or party_id=p_party_id) and (p_kind is null or kind=p_kind) and (p_status is null or status=p_status) and (p_agent_id is null or agent_id=p_agent_id);
 select coalesce(jsonb_agg(to_jsonb(t) order by sales_date desc,created_at desc),'[]') into v_rows from (
 select page.*,case when page.status='confirmed' then position.effective_total else page.total_amount end as effective_total
 from (select id,kind,party_id,agent_id,party_snapshot->>'name' as party_name,agent_snapshot->>'name' as agent_name,sales_date,status,total_amount,contract_id,revision,created_at from public.erp_sales_transactions s
 where organization_key='taejang' and sales_date between p_from and p_to and (p_party_id is null or party_id=p_party_id) and (p_kind is null or kind=p_kind) and (p_status is null or status=p_status) and (p_agent_id is null or agent_id=p_agent_id) order by sales_date desc,created_at desc limit 200) page
 left join lateral private.erp_sales_customer_position(page.id) position on page.status='confirmed'
 ) t;
 return jsonb_build_object('items',v_rows,'total',v_count,'limit',200);
end $$;

commit;
