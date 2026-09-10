-- Issue #148: capability-gate Employee management while preserving the existing
-- department scope, protected-account rules, immutable employee_id and archive safety.

begin;

insert into public.platform_capabilities(code, capability_kind, operations_manager_auto_grant, description)
values
  ('employee.view_scoped', 'operational', true, 'View existing Employees in the actor existing team/department scope'),
  ('employee.request_change', 'operational', true, 'Submit scoped Employee registration/update/photo requests'),
  ('employee.profile_photo_manage_scoped', 'operational', true, 'Manage work profile photos inside existing Employee scope'),
  ('employee.id_photo_manage', 'operational', true, 'Directly manage protected Employee ID photos'),
  ('employee.review_change_requests', 'operational', true, 'Review and decide Employee change requests')
on conflict (code) do update
set capability_kind=excluded.capability_kind,
    operations_manager_auto_grant=excluded.operations_manager_auto_grant,
    description=excluded.description,
    active=true,
    updated_at=now();

with grants(role_code, capability_code) as (
  values
    ('promotion_lead','employee.view_scoped'),
    ('promotion_lead','employee.request_change'),
    ('promotion_lead','employee.profile_photo_manage_scoped'),
    ('department_lead','employee.view_scoped'),
    ('department_lead','employee.request_change'),
    ('department_lead','employee.profile_photo_manage_scoped')
)
insert into public.role_capability_grants(role_id, capability_code)
select role.id, grants.capability_code
from grants
join public.roles role on role.code=grants.role_code and role.active
join public.platform_capabilities capability on capability.code=grants.capability_code and capability.active
on conflict (role_id, capability_code) do nothing;

-- Preserve the final accumulated Employee business implementations.
alter function public.get_employee_management_context()
  rename to private_get_employee_management_context_pre148;
alter function public.create_employee(text,date,uuid,uuid,boolean)
  rename to private_create_employee_pre148;
alter function public.update_employee_core(uuid,text,date,uuid,uuid,text,date,boolean,text)
  rename to private_update_employee_core_pre148;
alter function public.set_employee_photo(uuid,text,text)
  rename to private_set_employee_photo_pre148;
alter function public.submit_employee_change_request(text,uuid,jsonb)
  rename to private_submit_employee_change_request_pre148;
alter function public.review_employee_change_request(uuid,text,text)
  rename to private_review_employee_change_request_pre148;
alter function public.archive_employee(uuid,text)
  rename to private_archive_employee_pre148;
alter function public.restore_employee(uuid,text)
  rename to private_restore_employee_pre148;
alter function public.get_archived_employee_management()
  rename to private_get_archived_employee_management_pre148;

revoke all on function public.private_get_employee_management_context_pre148() from public,anon,authenticated;
revoke all on function public.private_create_employee_pre148(text,date,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.private_update_employee_core_pre148(uuid,text,date,uuid,uuid,text,date,boolean,text) from public,anon,authenticated;
revoke all on function public.private_set_employee_photo_pre148(uuid,text,text) from public,anon,authenticated;
revoke all on function public.private_submit_employee_change_request_pre148(text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.private_review_employee_change_request_pre148(uuid,text,text) from public,anon,authenticated;
revoke all on function public.private_archive_employee_pre148(uuid,text) from public,anon,authenticated;
revoke all on function public.private_restore_employee_pre148(uuid,text) from public,anon,authenticated;
revoke all on function public.private_get_archived_employee_management_pre148() from public,anon,authenticated;

create function public.get_employee_management_context()
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
begin
  if not (
    public.private_actor_can('employee.view_all')
    or public.private_actor_can('employee.view_scoped')
    or public.private_actor_can('employee.create')
  ) then
    raise exception using errcode='42501', message='EMPLOYEE_MANAGEMENT_FORBIDDEN';
  end if;
  return public.private_get_employee_management_context_pre148();
end;
$$;

create function public.create_employee(
  p_full_name text,
  p_hired_on date,
  p_department_id uuid,
  p_position_id uuid,
  p_attendance_required boolean default true
)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not public.private_actor_can('employee.create') then
    raise exception using errcode='42501', message='EMPLOYEE_CREATE_FORBIDDEN';
  end if;
  return public.private_create_employee_pre148(
    p_full_name,p_hired_on,p_department_id,p_position_id,p_attendance_required
  );
end;
$$;

create function public.update_employee_core(
  p_employee_uuid uuid,
  p_full_name text,
  p_hired_on date,
  p_department_id uuid,
  p_position_id uuid,
  p_employment_status text,
  p_departed_on date default null,
  p_attendance_required boolean default true,
  p_reason text default null
)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not public.private_actor_can('employee.update') then
    raise exception using errcode='42501', message='EMPLOYEE_UPDATE_FORBIDDEN';
  end if;
  return public.private_update_employee_core_pre148(
    p_employee_uuid,p_full_name,p_hired_on,p_department_id,p_position_id,
    p_employment_status,p_departed_on,p_attendance_required,p_reason
  );
end;
$$;

create function public.set_employee_photo(
  p_employee_uuid uuid,
  p_photo_type text,
  p_storage_path text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if p_photo_type='profile' and not public.private_actor_can('employee.profile_photo_manage_scoped') then
    raise exception using errcode='42501', message='PROFILE_PHOTO_UPDATE_FORBIDDEN';
  elsif p_photo_type='id_photo' and not public.private_actor_can('employee.id_photo_manage') then
    raise exception using errcode='42501', message='ID_PHOTO_UPDATE_FORBIDDEN';
  elsif p_photo_type not in ('profile','id_photo') then
    raise exception using errcode='22023', message='INVALID_EMPLOYEE_PHOTO';
  end if;
  return public.private_set_employee_photo_pre148(p_employee_uuid,p_photo_type,p_storage_path);
end;
$$;

create function public.submit_employee_change_request(
  p_request_type text,
  p_employee_uuid uuid default null,
  p_requested_changes jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not public.private_actor_can('employee.request_change') then
    raise exception using errcode='42501', message='EMPLOYEE_CHANGE_REQUEST_FORBIDDEN';
  end if;
  return public.private_submit_employee_change_request_pre148(p_request_type,p_employee_uuid,p_requested_changes);
end;
$$;

create function public.review_employee_change_request(
  p_request_id uuid,
  p_action text,
  p_comment text default null
)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not public.private_actor_can('employee.review_change_requests') then
    raise exception using errcode='42501', message='EMPLOYEE_CHANGE_REVIEW_FORBIDDEN';
  end if;
  return public.private_review_employee_change_request_pre148(p_request_id,p_action,p_comment);
end;
$$;

create function public.archive_employee(p_employee_uuid uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not public.private_actor_can('employee.archive') then
    raise exception using errcode='42501', message='EMPLOYEE_DELETE_FORBIDDEN';
  end if;
  return public.private_archive_employee_pre148(p_employee_uuid,p_reason);
end;
$$;

create function public.restore_employee(p_employee_uuid uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not public.private_actor_can('employee.restore') then
    raise exception using errcode='42501', message='EMPLOYEE_RESTORE_FORBIDDEN';
  end if;
  return public.private_restore_employee_pre148(p_employee_uuid,p_reason);
end;
$$;

create function public.get_archived_employee_management()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if not (
    public.private_actor_can('employee.archive')
    or public.private_actor_can('employee.restore')
  ) then
    raise exception using errcode='42501', message='EMPLOYEE_ARCHIVE_READ_FORBIDDEN';
  end if;
  return public.private_get_archived_employee_management_pre148();
end;
$$;

revoke all on function public.get_employee_management_context() from public,anon;
revoke all on function public.create_employee(text,date,uuid,uuid,boolean) from public,anon;
revoke all on function public.update_employee_core(uuid,text,date,uuid,uuid,text,date,boolean,text) from public,anon;
revoke all on function public.set_employee_photo(uuid,text,text) from public,anon;
revoke all on function public.submit_employee_change_request(text,uuid,jsonb) from public,anon;
revoke all on function public.review_employee_change_request(uuid,text,text) from public,anon;
revoke all on function public.archive_employee(uuid,text) from public,anon;
revoke all on function public.restore_employee(uuid,text) from public,anon;
revoke all on function public.get_archived_employee_management() from public,anon;

grant execute on function public.get_employee_management_context() to authenticated;
grant execute on function public.create_employee(text,date,uuid,uuid,boolean) to authenticated;
grant execute on function public.update_employee_core(uuid,text,date,uuid,uuid,text,date,boolean,text) to authenticated;
grant execute on function public.set_employee_photo(uuid,text,text) to authenticated;
grant execute on function public.submit_employee_change_request(text,uuid,jsonb) to authenticated;
grant execute on function public.review_employee_change_request(uuid,text,text) to authenticated;
grant execute on function public.archive_employee(uuid,text) to authenticated;
grant execute on function public.restore_employee(uuid,text) to authenticated;
grant execute on function public.get_archived_employee_management() to authenticated;

commit;
