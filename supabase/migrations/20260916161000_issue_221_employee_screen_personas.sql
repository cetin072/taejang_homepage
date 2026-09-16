-- Issue #221: production-safe employee screen personas for operations manager.
-- This contract returns only non-secret display/identity fields and never returns
-- passwords, auth tokens, refresh tokens, service-role material, or user email.

create or replace function public.get_operations_employee_screen_personas()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  personas jsonb;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'EMPLOYEE_SCREEN_PERSONAS_FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.profile_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = actor_id
      and assignment.revoked_at is null
      and role.active
      and role.code = 'operations_manager'
  ) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_SCREEN_PERSONAS_FORBIDDEN';
  end if;

  if not public.private_actor_has_capability('account.view_management') then
    raise exception using errcode = '42501', message = 'EMPLOYEE_SCREEN_PERSONAS_FORBIDDEN';
  end if;

  with ranked as (
    select
      profile.id as profile_id,
      employee.id as employee_uuid,
      employee.employee_id,
      person.full_name,
      role.code as role_code,
      row_number() over (
        partition by employee.id
        order by case role.code
          when 'promotion_lead' then 1
          when 'promotion_staff' then 2
          when 'general_worker' then 3
          else 99
        end,
        role.code
      ) as role_rank
    from public.profiles profile
    join auth.users auth_user
      on auth_user.id = profile.id
    join public.account_person_links account_link
      on account_link.profile_id = profile.id
     and account_link.revoked_at is null
    join public.employees employee
      on employee.person_id = account_link.person_id
     and employee.employment_status = 'active'
     and employee.archived_at is null
    join public.people person
      on person.id = employee.person_id
    join public.profile_roles assignment
      on assignment.profile_id = profile.id
     and assignment.revoked_at is null
    join public.roles role
      on role.id = assignment.role_id
     and role.active
    where profile.account_status = 'active'
      and role.code in ('general_worker', 'promotion_staff', 'promotion_lead')
      and auth_user.confirmed_at is not null
      and auth_user.deleted_at is null
      and (auth_user.banned_until is null or auth_user.banned_until <= now())
  ), selected as (
    select profile_id, employee_uuid, employee_id, full_name, role_code
    from ranked
    where role_rank = 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'profile_id', profile_id,
        'employee_uuid', employee_uuid,
        'employee_id', employee_id,
        'name', full_name,
        'role_code', role_code
      )
      order by full_name, employee_id
    ),
    '[]'::jsonb
  )
  into personas
  from selected;

  return jsonb_build_object('personas', personas);
end;
$$;

revoke all on function public.get_operations_employee_screen_personas() from public;
grant execute on function public.get_operations_employee_screen_personas() to authenticated;

-- general_worker was already permitted by the role_simulation_modes table constraint.
-- Extend only the operations-manager-controlled setter so the same privilege-reducing
-- simulation mechanism can safely represent a general employee screen.
create or replace function public.set_role_simulation_mode(p_role_code text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_role text := nullif(btrim(coalesce(p_role_code, '')), '');
  can_switch boolean := false;
  mode_expires_at timestamptz;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'ROLE_SIMULATION_FORBIDDEN';
  end if;

  select exists (
    select 1
    from public.profile_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = actor_id
      and assignment.revoked_at is null
      and role.active
      and role.code = 'operations_manager'
  ) into can_switch;

  if not can_switch then
    raise exception using errcode = '42501', message = 'ROLE_SIMULATION_FORBIDDEN';
  end if;

  delete from public.role_simulation_modes where expires_at <= now();

  if normalized_role is null or normalized_role = 'actual' then
    delete from public.role_simulation_modes where profile_id = actor_id;
    perform public.private_append_audit(
      actor_id,
      'role_simulation_cleared',
      'profile',
      actor_id::text,
      'success',
      '원래 운영총괄 권한으로 복귀',
      jsonb_build_object('effective_role', null)
    );
    return jsonb_build_object('ok', true, 'code', 'ROLE_SIMULATION_CLEARED', 'role_code', null);
  end if;

  if normalized_role not in ('general_worker', 'promotion_staff', 'promotion_lead') then
    raise exception using errcode = '22023', message = 'INVALID_ROLE_SIMULATION_MODE';
  end if;

  mode_expires_at := now() + interval '2 hours';
  insert into public.role_simulation_modes(profile_id, role_code, expires_at, updated_at)
  values (actor_id, normalized_role, mode_expires_at, now())
  on conflict (profile_id) do update
    set role_code = excluded.role_code,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at;

  perform public.private_append_audit(
    actor_id,
    'role_simulation_started',
    'profile',
    actor_id::text,
    'success',
    case normalized_role
      when 'general_worker' then '일반직원 권한 체험 시작'
      when 'promotion_staff' then '홍보직원 권한 체험 시작'
      else '운영팀장 권한 체험 시작'
    end,
    jsonb_build_object('effective_role', normalized_role, 'expires_at', mode_expires_at)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'ROLE_SIMULATION_SET',
    'role_code', normalized_role,
    'expires_at', mode_expires_at
  );
end;
$$;
