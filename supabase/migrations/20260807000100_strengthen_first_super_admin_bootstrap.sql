begin;

-- The initial system administrator is established by a database owner only.
-- It intentionally uses role and organization codes, never a person's name or email.
create or replace function public.bootstrap_super_admin(p_target_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile public.profiles%rowtype;
  target_email_confirmed_at timestamptz;
  operations_department_id uuid;
  operations_manager_position_id uuid;
  super_admin_role_id uuid;
  operations_manager_role_id uuid;
  bootstrap_reason constant text := '최초 시스템 최고관리자 bootstrap';
begin
  perform pg_advisory_xact_lock(77134001);

  if exists (
    select 1
    from public.profiles profile
    join public.profile_roles assignment on assignment.profile_id = profile.id and assignment.revoked_at is null
    join public.roles role on role.id = assignment.role_id and role.code = 'super_admin'
    where profile.account_status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'BOOTSTRAP_ALREADY_COMPLETED');
  end if;

  select auth_user.email_confirmed_at
  into target_email_confirmed_at
  from auth.users auth_user
  where auth_user.id = p_target_auth_user_id
  for key share;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'AUTH_USER_NOT_FOUND');
  end if;
  if target_email_confirmed_at is null then
    return jsonb_build_object('ok', false, 'code', 'EMAIL_NOT_CONFIRMED');
  end if;

  select * into target_profile
  from public.profiles
  where id = p_target_auth_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;
  if target_profile.account_status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_PENDING');
  end if;

  select id into operations_department_id
  from public.departments
  where code = 'operations' and active;
  select id into operations_manager_position_id
  from public.positions
  where code = 'operations_manager' and active;
  select id into super_admin_role_id
  from public.roles
  where code = 'super_admin' and active;
  select id into operations_manager_role_id
  from public.roles
  where code = 'operations_manager' and active;

  if operations_department_id is null
     or operations_manager_position_id is null
     or super_admin_role_id is null
     or operations_manager_role_id is null then
    return jsonb_build_object('ok', false, 'code', 'BOOTSTRAP_REFERENCE_DATA_MISSING');
  end if;

  update public.profiles
  set account_status = 'active',
      department_id = operations_department_id,
      position_id = operations_manager_position_id,
      approved_at = now(),
      approved_by = null,
      status_changed_at = now(),
      status_changed_by = null,
      status_reason = bootstrap_reason,
      updated_at = now()
  where id = p_target_auth_user_id;

  insert into public.profile_roles (profile_id, role_id, granted_by)
  values
    (p_target_auth_user_id, super_admin_role_id, null),
    (p_target_auth_user_id, operations_manager_role_id, null);

  insert into public.account_status_history (
    profile_id, previous_status, new_status, reason, changed_by
  ) values (
    p_target_auth_user_id, 'pending', 'active', bootstrap_reason, null
  );

  perform public.private_append_audit(
    null, 'organization_assignment_changed', 'profile', p_target_auth_user_id::text, 'success',
    bootstrap_reason,
    jsonb_build_object(
      'previous_department_id', target_profile.department_id,
      'new_department_id', operations_department_id,
      'previous_position_id', target_profile.position_id,
      'new_position_id', operations_manager_position_id
    )
  );
  perform public.private_append_audit(
    null, 'role_granted', 'profile', p_target_auth_user_id::text, 'success',
    bootstrap_reason, jsonb_build_object('role_code', 'super_admin')
  );
  perform public.private_append_audit(
    null, 'role_granted', 'profile', p_target_auth_user_id::text, 'success',
    bootstrap_reason, jsonb_build_object('role_code', 'operations_manager')
  );
  perform public.private_append_audit(
    null, 'super_admin_bootstrapped', 'profile', p_target_auth_user_id::text, 'success',
    bootstrap_reason, jsonb_build_object('method', 'database_owner_one_time_bootstrap')
  );

  return jsonb_build_object('ok', true, 'code', 'SUPER_ADMIN_BOOTSTRAPPED');
end;
$$;

alter function public.bootstrap_super_admin(uuid) owner to postgres;
revoke execute on function public.bootstrap_super_admin(uuid) from public, anon, authenticated;

commit;
