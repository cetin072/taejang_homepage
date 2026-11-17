-- Read-only additive summary; existing access guard and immutable ledger are preserved.
create or replace function logistics_private.read_workspace(p_customer_id uuid,p_query text,p_page integer)
 returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid; result jsonb; pattern text;
begin
 actor:=logistics_private.assert_access();
 if p_page is null or p_page not between 0 and 100000 or length(coalesce(p_query,''))>120 then raise exception 'LOGISTICS_INVALID';end if;
 pattern:='%'||coalesce(p_query,'')||'%';
 select jsonb_build_object(
 'settings',(select jsonb_build_object('revision',s.revision,'data',s.data) from logistics_private.settings s where singleton),
 'customers',coalesce((select jsonb_agg(row_to_json(c) order by c.name,c.id) from (
  select c.id,c.name,c.phone,c.memo,c.revision,coalesce((select sum(case when e.type='deposit' then e.amount else -e.amount end) from logistics_private.entries e where e.customer_id=c.id),0) as balance,
  (select jsonb_build_object('amount',e.amount,'created_at',e.created_at)
   from logistics_private.entries e where e.customer_id=c.id and e.type='debit' and e.source<>'reversal'
   and not exists(select 1 from logistics_private.entries r where r.reversal_of=e.id)
   order by e.created_at desc,e.id desc limit 1) as latest_debit
  from logistics_private.customers c) c),'[]'::jsonb),
 'quotes',coalesce((select jsonb_agg(row_to_json(q) order by q.created_at desc,q.id desc) from (
  select q.id,q.number,q.customer_id,q.snapshot,q.total,q.created_at,p.display_name as actor,
    exists(select 1 from logistics_private.entries e where e.quote_id=q.id and e.source='quote') as charged
  from logistics_private.quotes q join public.profiles p on p.id=q.created_by join logistics_private.customers c on c.id=q.customer_id
  where (p_customer_id is null or q.customer_id=p_customer_id) and (q.number ilike pattern or c.name ilike pattern)
  order by q.created_at desc,q.id desc limit 50 offset p_page*50) q),'[]'::jsonb),
 'entries',coalesce((select jsonb_agg(row_to_json(e) order by e.created_at desc,e.id desc) from (
  select e.id,e.customer_id,c.name as customer_name,e.type,e.source,e.amount,e.memo,e.quote_id,e.reversal_of,e.created_at,p.display_name as actor,
    exists(select 1 from logistics_private.entries z where z.reversal_of=e.id) as reversed
  from logistics_private.entries e join logistics_private.customers c on c.id=e.customer_id join public.profiles p on p.id=e.created_by
  where (p_customer_id is null or e.customer_id=p_customer_id) and (c.name ilike pattern or e.memo ilike pattern)
  order by e.created_at desc,e.id desc limit 50 offset p_page*50) e),'[]'::jsonb),
 'quoteCount',(select count(*) from logistics_private.quotes q join logistics_private.customers c on c.id=q.customer_id where (p_customer_id is null or q.customer_id=p_customer_id) and (q.number ilike pattern or c.name ilike pattern)),
 'entryCount',(select count(*) from logistics_private.entries e join logistics_private.customers c on c.id=e.customer_id where (p_customer_id is null or e.customer_id=p_customer_id) and (c.name ilike pattern or e.memo ilike pattern))
 ) into result;return result;
end $$;
