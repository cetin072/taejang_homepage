-- Phase C pilot account onboarding for real staff field use.
-- Applicants do not choose their own role. The operations manager alone reviews
-- pending signups and assigns department, position, and the pilot permission.
-- Pilot permissions are deliberately limited to promotion_staff / promotion_lead.
begin;

create or replace function public.list_pending_signup_requests()
returns table (
  id uuid,
  display_name text,
  work_email text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return query
  select profile.id, profile.display_name, profile.work_email, profile.created_at
  from public.profiles profile
  where profile.account_status = 'pending'
  order by profile.created_at;
end;
$$;

create or replace function public.get_signup_approval_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$;

-- Recreate body separately because PostgreSQL does not allow a stray semicolon in
-- the dollar-quoted block when this file is linted by older tooling.
create or replace function public.get_signup_approval_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'name', d.name) order by d.sort_order, d.name)
      from public.departments d
      where d.active
    ), '[]'::jsonb),
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name) order by p.sort_order, p.name)
      from public.positions p
      where p.active
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name) order by r.code)
      from public.roles r
      where r.active
        and r.code in ('promotion_staff', 'promotion_lead')
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.approve_signup_request(
  p_target_profile_id uuid,
  p_department_id uuid,
  p_position_id uuid,
  p_role_code text,
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_profile public.profiles%rowtype;
  target_role_id uuid;
  normalized_role text := nullif(trim(p_role_code), '');
begin
  if actor_id is null or not public.current_user_has_role('operations_manager') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if normalized_role not in ('promotion_staff', 'promotion_lead') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ROLE');
  end if;

  select * into target_profile
  from public.profiles
  where id = p_target_profile_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;
  if target_profile.account_status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_PENDING');
  end if;

  if p_department_id is null
     or not exists (select 1 from public.departments where id = p_department_id and active) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DEPARTMENT');
  end if;

  if p_position_id is null
     or not exists (select 1 from public.positions where id = p_position_id and active) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_POSITION');
  end if;

  select role.id into target_role_id
  from public.roles role
  where role.code = normalized_role
    and role.active;

  if target_role_id is null then
    return jsonb_build_object('ok', false, 'code', 'ROLE_NOT_AVAILABLE');
  end if;

  update public.profiles
  set account_status = 'active',
      department_id = p_department_id,
      position_id = p_position_id,
      approved_at = now(),
      approved_by = actor_id,
      status_changed_at = now(),
      status_changed_by = actor_id,
      status_reason = left(coalesce(nullif(trim(p_reason_summary), ''), '가입 승인'), 300),
      updated_at = now()
  where id = p_target_profile_id;

  insert into public.account_status_history (
    profile_id,
    previous_status,
    new_status,
    reason,
    changed_by
  ) values (
    p_target_profile_id,
    'pending',
    'active',
    left(coalesce(nullif(trim(p_reason_summary), ''), '가입 승인'), 300),
    actor_id
  );

  insert into public.profile_roles (profile_id, role_id, granted_by)
  values (p_target_profile_id, target_role_id, actor_id)
  on conflict do nothing;

  perform public.private_append_audit(
    actor_id,
    'operations_manager_account_approved',
    'profile',
    p_target_profile_id::text,
    'success',
    left(coalesce(nullif(trim(p_reason_summary), ''), '가입 승인'), 300),
    jsonb_build_object(
      'role_code', normalized_role,
      'department_id', p_department_id,
      'position_id', p_position_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'ACCOUNT_APPROVED',
    'role_code', normalized_role
  );
end;
$$;

revoke all on function public.list_pending_signup_requests() from public, anon;
revoke all on function public.get_signup_approval_options() from public, anon;
revoke all on function public.approve_signup_request(uuid, uuid, uuid, text, text) from public, anon;

grant execute on function public.list_pending_signup_requests() to authenticated;
grant execute on function public.get_signup_approval_options() to authenticated;
grant execute on function public.approve_signup_request(uuid, uuid, uuid, text, text) to authenticated;

commit;
