begin;
-- A lead may register a previously unconfigured employee once, but cannot adjust an existing balance.
create or replace function public.initialize_employee_leave(p_employee_uuid uuid,p_baseline_on date,p_accrued numeric,p_remaining numeric,p_monthly_enabled boolean,p_reason text) returns jsonb
 language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not ((public.current_user_has_role('operations_manager') or public.current_user_has_role('promotion_lead')) and public.private_actor_can('employee.work_terms_manage')) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_baseline_on is null or p_baseline_on<>(now() at time zone 'Asia/Seoul')::date then raise exception 'BASELINE_MUST_BE_TODAY'; end if;
 if p_accrued is null or p_remaining is null or p_monthly_enabled is distinct from true or length(btrim(coalesce(p_reason,''))) not between 2 and 300 then raise exception 'INVALID_BASELINE'; end if;
 perform 1 from public.employees where id=p_employee_uuid and archived_at is null and employment_status='active' for update;
 if not found then raise exception 'EMPLOYEE_NOT_ACTIVE'; end if;
 -- Employee row lock serializes first registration; the account PK remains a second guard.
 if exists(select 1 from public.employee_leave_accounts where employee_uuid=p_employee_uuid) then raise exception 'LEAVE_ALREADY_INITIALIZED'; end if;
 insert into public.employee_leave_accounts values(p_employee_uuid,p_baseline_on,p_accrued,p_remaining,p_monthly_enabled,auth.uid(),now());
 perform public.private_append_audit(auth.uid(),'employee_leave_initialized','employee',p_employee_uuid::text,'success',p_reason,
 jsonb_build_object('baseline_on',p_baseline_on,'accrued',p_accrued,'remaining',p_remaining,'monthly_enabled',p_monthly_enabled));
 return jsonb_build_object('ok',true);
end $$;

-- Minimal roster metadata; existing balances, history, and approval permissions stay unchanged.
create or replace function public.get_employee_leave_admin_context(p_employee_uuid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; begin
 b:=public.private_get_employee_leave_admin_context_pre573(p_employee_uuid);
 -- The existing delegate performs the same narrow authorization before metadata is read.
 b:=b||jsonb_build_object('can_manage_work_terms',public.private_actor_can('employee.work_terms_manage'),
   -- Per-employee eligibility also keeps older web clients from offering adjustment to a lead.
   'can_initialize',public.private_actor_can('employee.work_terms_manage') and (public.current_user_has_role('operations_manager') or (public.current_user_has_role('promotion_lead') and (p_employee_uuid is null or not exists(select 1 from public.employee_leave_accounts where employee_uuid=p_employee_uuid)))),
   'can_adjust',public.current_user_has_role('operations_manager') and public.private_actor_can('employee.work_terms_manage'),
   'roster_version',1,'employees',coalesce((
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

revoke all on function public.initialize_employee_leave(uuid,date,numeric,numeric,boolean,text) from public,anon;
grant execute on function public.initialize_employee_leave(uuid,date,numeric,numeric,boolean,text) to authenticated;
commit;
