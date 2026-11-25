-- A registration-only grant never returns the employee roster or account data.
-- No live grants or adapter activation. Existing employee-management RPCs keep
-- their own menu guard even though employee.create is a shared capability.
begin;

create function public.get_employee_registration_context()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.private_menu_operations('employee.new') or not public.private_actor_can('employee.create') then
  raise exception using errcode='42501',message='EMPLOYEE_REGISTRATION_FORBIDDEN';
 end if;
 return jsonb_build_object(
  'registration_only',true,'access_level','operations_manager',
  'departments',(select coalesce(jsonb_agg(jsonb_build_object(
   'id',d.id,'name',d.name,'code',d.code) order by d.sort_order,d.name),'[]'::jsonb)
   from public.departments d where d.active),
  'positions',(select coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'name',p.name,'code',p.code)
   order by case when p.code='general_worker' then 0 else 1 end,p.sort_order,p.name),'[]'::jsonb)
   from public.positions p where p.active));
end;
$$;

create function public.create_employee_from_registration(
 p_full_name text,p_hired_on date,p_department_id uuid,p_position_id uuid,
 p_attendance_required boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare employee_row public.employees%rowtype;
begin
 if not public.private_menu_operations('employee.new') or not public.private_actor_can('employee.create') then
  raise exception using errcode='42501',message='EMPLOYEE_REGISTRATION_FORBIDDEN';
 end if;
 -- Reuse the same validation, Person/Employee insert and immutable ID allocator.
 employee_row:=public.private_insert_employee(p_full_name,p_hired_on,
   p_department_id,p_position_id,p_attendance_required);
 perform public.private_append_audit(auth.uid(),'employee_created','employee',
  employee_row.id::text,'success','직원 마스터 등록',jsonb_build_object(
   'employee_id',employee_row.employee_id,'department_id',employee_row.department_id,
   'position_id',employee_row.position_id,'menu_key','employee.new'));
 return jsonb_build_object('ok',true,'code','EMPLOYEE_CREATED',
  'employee_uuid',employee_row.id,'employee_id',employee_row.employee_id);
end;
$$;

revoke all on function public.get_employee_registration_context(),
 public.create_employee_from_registration(text,date,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.get_employee_registration_context(),
 public.create_employee_from_registration(text,date,uuid,uuid,boolean) to authenticated;
commit;
