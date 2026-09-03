begin;

create or replace function public.get_employee_management_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  is_ops boolean := public.current_user_has_role('operations_manager');
  dept uuid := public.private_team_lead_department();
  employees_json jsonb;
  requests_json jsonb;
  departments_json jsonb;
  positions_json jsonb;
begin
  if actor_id is null or (not is_ops and dept is null) then
    raise exception using errcode='42501', message='EMPLOYEE_MANAGEMENT_FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'employee_id', e.employee_id,
    'full_name', p.full_name,
    'employment_status', e.employment_status,
    'department_id', e.department_id,
    'department_name', d.name,
    'position_id', e.position_id,
    'position_name', pos.name,
    'hired_on', e.hired_on,
    'departed_on', e.departed_on,
    'attendance_required', e.attendance_required,
    'profile_photo_path', (
      select ep.storage_path from public.employee_photos ep
      where ep.employee_uuid=e.id and ep.photo_type='profile' and ep.is_current limit 1
    ),
    'id_photo_path', case when is_ops then (
      select ep.storage_path from public.employee_photos ep
      where ep.employee_uuid=e.id and ep.photo_type='id_photo' and ep.is_current limit 1
    ) else null end,
    'linked_profile', (
      select jsonb_build_object(
        'id', prf.id,
        'display_name', prf.display_name,
        'work_email', case when is_ops then prf.work_email else null end,
        'account_status', prf.account_status::text
      )
      from public.account_person_links apl
      join public.profiles prf on prf.id=apl.profile_id
      where apl.person_id=e.person_id and apl.revoked_at is null limit 1
    ),
    'protected', public.private_employee_is_protected(e.id)
  ) order by e.employee_id), '[]'::jsonb)
  into employees_json
  from public.employees e
  join public.people p on p.id=e.person_id
  join public.departments d on d.id=e.department_id
  join public.positions pos on pos.id=e.position_id
  where is_ops or e.department_id=dept;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'employee_uuid', r.employee_uuid,
    'request_type', r.request_type,
    'requested_changes', r.requested_changes,
    'requested_by', r.requested_by,
    'requested_at', r.requested_at,
    'status', r.status,
    'decision_comment', r.decision_comment
  ) order by r.requested_at desc), '[]'::jsonb)
  into requests_json
  from public.employee_change_requests r
  left join public.employees e on e.id=r.employee_uuid
  where (is_ops and r.status='pending')
     or (not is_ops and r.requested_by=actor_id and r.status in ('pending','changes_requested'));

  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'code',d.code) order by d.sort_order,d.name),'[]'::jsonb)
  into departments_json
  from public.departments d
  where d.active and (is_ops or d.id=dept);

  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'code',p.code) order by p.sort_order,p.name),'[]'::jsonb)
  into positions_json
  from public.positions p
  where p.active;

  return jsonb_build_object(
    'access_level', case when is_ops then 'operations_manager' else 'team_lead' end,
    'department_id', dept,
    'employees', employees_json,
    'change_requests', requests_json,
    'departments', departments_json,
    'positions', positions_json
  );
end;
$$;

revoke all on function public.get_employee_management_context() from public, anon, authenticated;
grant execute on function public.get_employee_management_context() to authenticated;

commit;
