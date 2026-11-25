begin;
-- The existing promotion_lead role (formerly 홍보팀장, now 운영팀장) may edit work hours.
-- Keep leave baseline/adjustment restricted to operations_manager despite sharing the legacy capability.
update public.platform_capabilities set description='직원 근무요일·시간·휴게·장소 등록 및 변경' where code='employee.work_terms_manage';
insert into public.role_capability_grants(role_id,capability_code)
select id,'employee.work_terms_manage' from public.roles where code='promotion_lead'
on conflict do nothing;

create or replace function public.initialize_employee_leave(p_employee_uuid uuid,p_baseline_on date,p_accrued numeric,p_remaining numeric,p_monthly_enabled boolean,p_reason text) returns jsonb
 language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not (public.current_user_has_role('operations_manager') and public.private_actor_can('employee.work_terms_manage')) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_baseline_on is null or p_baseline_on<>(now() at time zone 'Asia/Seoul')::date then raise exception 'BASELINE_MUST_BE_TODAY'; end if;
 if p_accrued is null or p_remaining is null or p_monthly_enabled is distinct from true or length(btrim(coalesce(p_reason,''))) not between 2 and 300 then raise exception 'INVALID_BASELINE'; end if;
 perform 1 from public.employees where id=p_employee_uuid and archived_at is null and employment_status='active' for update;
 if not found then raise exception 'EMPLOYEE_NOT_ACTIVE'; end if;
 insert into public.employee_leave_accounts values(p_employee_uuid,p_baseline_on,p_accrued,p_remaining,p_monthly_enabled,auth.uid(),now());
 perform public.private_append_audit(auth.uid(),'employee_leave_initialized','employee',p_employee_uuid::text,'success',p_reason,
 jsonb_build_object('baseline_on',p_baseline_on,'accrued',p_accrued,'remaining',p_remaining,'monthly_enabled',p_monthly_enabled));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.adjust_employee_leave(p_employee_uuid uuid,p_id uuid,p_delta numeric,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; begin
 if not (public.current_user_has_role('operations_manager') and public.private_actor_can('employee.work_terms_manage')) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_delta is null or p_delta=0 or mod(p_delta*2,1)<>0 or abs(p_delta)>100 or length(btrim(coalesce(p_reason,''))) not between 2 and 300 then raise exception 'INVALID_ADJUSTMENT'; end if;
 perform 1 from public.employee_leave_accounts where employee_uuid=p_employee_uuid for update;
 if not found then raise exception 'LEAVE_NOT_CONFIGURED'; end if;
 if exists(select 1 from public.employee_leave_ledger where employee_uuid=p_employee_uuid and entry_key='adjust:'||p_id) then
  if not exists(select 1 from public.employee_leave_ledger where employee_uuid=p_employee_uuid and entry_key='adjust:'||p_id and delta=p_delta and note=p_reason) then raise exception 'ADJUSTMENT_ID_CONFLICT'; end if;
  return jsonb_build_object('ok',true); end if;
 perform public.private_accrue_employee_leave(p_employee_uuid); b:=public.private_employee_leave_balance(p_employee_uuid);
 if (b->>'available')::numeric+p_delta<0 then raise exception 'INSUFFICIENT_LEAVE'; end if;
 insert into public.employee_leave_ledger(employee_uuid,kind,entry_key,delta,note,actor_id)
 values(p_employee_uuid,'adjustment','adjust:'||p_id,p_delta,p_reason,auth.uid());
 perform public.private_append_audit(auth.uid(),'employee_leave_adjusted','employee',p_employee_uuid::text,'success',p_reason,jsonb_build_object('adjustment_id',p_id,'delta',p_delta));
 return jsonb_build_object('ok',true);
end $$;

-- Minimal roster metadata; existing balances, history, and approval permissions stay unchanged.
create or replace function public.get_employee_leave_admin_context(p_employee_uuid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; begin
 b:=public.private_get_employee_leave_admin_context_pre573(p_employee_uuid);
 -- The existing delegate performs the same narrow authorization before metadata is read.
 b:=b||jsonb_build_object('can_manage_work_terms',public.private_actor_can('employee.work_terms_manage'),
   'can_initialize',public.current_user_has_role('operations_manager') and public.private_actor_can('employee.work_terms_manage'),
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

revoke all on function public.initialize_employee_leave(uuid,date,numeric,numeric,boolean,text),public.adjust_employee_leave(uuid,uuid,numeric,text) from public,anon;
grant execute on function public.initialize_employee_leave(uuid,date,numeric,numeric,boolean,text),public.adjust_employee_leave(uuid,uuid,numeric,text) to authenticated;
commit;
