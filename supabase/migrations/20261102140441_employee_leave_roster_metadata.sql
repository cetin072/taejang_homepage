begin;
-- Minimal roster metadata; existing balances, history, and approval permissions stay unchanged.
create or replace function public.get_employee_leave_admin_context(p_employee_uuid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; begin
 b:=public.private_get_employee_leave_admin_context_pre573(p_employee_uuid);
 -- The existing delegate performs the same narrow authorization before metadata is read.
 b:=b||jsonb_build_object('roster_version',1,'employees',coalesce((
   select jsonb_agg(item||jsonb_build_object(
     'full_name',item->>'name','employment_status',e.employment_status,
     'hired_on',e.hired_on,'departed_on',e.departed_on,
     'position_id',e.position_id,'position_name',p.name) order by ord)
   from jsonb_array_elements(b->'employees') with ordinality as entry(item,ord)
   join public.employees e on e.id=(item->>'id')::uuid
   left join public.positions p on p.id=e.position_id),'[]'::jsonb),
   'positions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code,'sort_order',sort_order) order by sort_order,name) from public.positions),'[]'::jsonb));
 return b||jsonb_build_object('change_requests',coalesce((select jsonb_agg(to_jsonb(c) order by created_at desc) from
 (select c.*,p.full_name as employee_name,r.work_date as original_work_date,r.portion as original_portion from public.employee_leave_change_requests c join public.employee_leave_requests r on r.id=c.request_id join public.employees e on e.id=c.employee_uuid join public.people p on p.id=e.person_id where p_employee_uuid is null or c.employee_uuid=p_employee_uuid order by c.created_at desc limit 300) c),'[]'::jsonb));
end $$;
revoke all on function public.get_employee_leave_admin_context(uuid) from public,anon,authenticated;
grant execute on function public.get_employee_leave_admin_context(uuid) to authenticated;
commit;
