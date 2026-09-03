-- Phase C: highest-authority account can temporarily exercise only lower-role permissions.
-- This is not visual impersonation. While simulation is active, shared role helpers
-- expose only the selected effective role to server-side authorization checks.

create table if not exists public.role_simulation_modes (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  role_code text not null check (role_code in ('promotion_staff', 'promotion_lead')),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.role_simulation_modes enable row level security;
revoke all on table public.role_simulation_modes from anon, authenticated;

create or replace function public.set_role_simulation_mode(p_role_code text default null)
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

  -- Deliberately inspect actual assignments, not current_user_has_role(), so an
  -- already-simulated account can always return to its original authority.
  select count(distinct role.code) = 2
  into can_switch
  from public.profile_roles assignment
  join public.roles role on role.id = assignment.role_id
  where assignment.profile_id = actor_id
    and assignment.revoked_at is null
    and role.active
    and role.code in ('operations_manager', 'super_admin');

  if not can_switch then
    raise exception using errcode = '42501', message = 'ROLE_SIMULATION_FORBIDDEN';
  end if;

  delete from public.role_simulation_modes
  where expires_at <= now();

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

  if normalized_role not in ('promotion_staff', 'promotion_lead') then
    raise exception using errcode = '22023', message = 'INVALID_ROLE_SIMULATION_MODE';
  end if;

  mode_expires_at := now() + interval '2 hours';
  insert into public.role_simulation_modes (profile_id, role_code, expires_at, updated_at)
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

revoke all on function public.set_role_simulation_mode(text) from public, anon;
grant execute on function public.set_role_simulation_mode(text) to authenticated;

create or replace function public.current_user_has_role(p_role_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and case
      when exists (
        select 1
        from public.role_simulation_modes simulation
        where simulation.profile_id = (select auth.uid())
          and simulation.expires_at > now()
      ) then exists (
        select 1
        from public.role_simulation_modes simulation
        where simulation.profile_id = (select auth.uid())
          and simulation.expires_at > now()
          and simulation.role_code = p_role_code
      )
      else exists (
        select 1
        from public.profile_roles assignment
        join public.roles role on role.id = assignment.role_id
        where assignment.profile_id = (select auth.uid())
          and assignment.revoked_at is null
          and role.active
          and role.code = p_role_code
      )
    end;
$$;

create or replace function public.current_user_is_promotion_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and (
      exists (
        select 1
        from public.role_simulation_modes simulation
        where simulation.profile_id = (select auth.uid())
          and simulation.expires_at > now()
          and simulation.role_code in ('promotion_staff', 'promotion_lead')
      )
      or (
        not exists (
          select 1
          from public.role_simulation_modes simulation
          where simulation.profile_id = (select auth.uid())
            and simulation.expires_at > now()
        )
        and exists (
          select 1
          from public.profiles profile
          join public.departments department on department.id = profile.department_id
          where profile.id = (select auth.uid())
            and department.code = 'promotion'
            and department.active
        )
      )
    );
$$;

create or replace function public.current_user_department_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.role_simulation_modes simulation
      where simulation.profile_id = (select auth.uid())
        and simulation.expires_at > now()
        and simulation.role_code in ('promotion_staff', 'promotion_lead')
    ) then (
      select department.id
      from public.departments department
      where department.code = 'promotion' and department.active
      limit 1
    )
    else (
      select profile.department_id
      from public.profiles profile
      where profile.id = (select auth.uid())
        and profile.account_status = 'active'
    )
  end;
$$;

create or replace function public.get_my_access_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  profile_row public.profiles%rowtype;
  simulation_role text;
  simulation_expires_at timestamptz;
  can_switch boolean := false;
  department_json jsonb;
  position_json jsonb;
  roles_json jsonb := '[]'::jsonb;
begin
  select * into profile_row
  from public.profiles profile
  where profile.id = actor_id;

  if not found then
    return null;
  end if;

  select simulation.role_code, simulation.expires_at
  into simulation_role, simulation_expires_at
  from public.role_simulation_modes simulation
  where simulation.profile_id = actor_id
    and simulation.expires_at > now();

  select count(distinct role.code) = 2
  into can_switch
  from public.profile_roles assignment
  join public.roles role on role.id = assignment.role_id
  where assignment.profile_id = actor_id
    and assignment.revoked_at is null
    and role.active
    and role.code in ('operations_manager', 'super_admin');

  if profile_row.account_status = 'active' and simulation_role is not null then
    select jsonb_build_object('id', department.id, 'code', department.code, 'name', department.name)
    into department_json
    from public.departments department
    where department.code = 'promotion' and department.active
    limit 1;

    select jsonb_build_object('id', position.id, 'code', position.code, 'name', position.name)
    into position_json
    from public.positions position
    where position.code = case simulation_role
      when 'promotion_lead' then 'department_lead'
      else 'staff'
    end
      and position.active
    limit 1;

    select jsonb_build_array(jsonb_build_object('code', role.code, 'name', role.name))
    into roles_json
    from public.roles role
    where role.code = simulation_role and role.active
    limit 1;
  elsif profile_row.account_status = 'active' then
    select jsonb_build_object('id', department.id, 'code', department.code, 'name', department.name)
    into department_json
    from public.departments department
    where department.id = profile_row.department_id;

    select jsonb_build_object('id', position.id, 'code', position.code, 'name', position.name)
    into position_json
    from public.positions position
    where position.id = profile_row.position_id;

    select coalesce(
      jsonb_agg(jsonb_build_object('code', role.code, 'name', role.name) order by role.code),
      '[]'::jsonb
    )
    into roles_json
    from public.profile_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = actor_id
      and assignment.revoked_at is null
      and role.active;
  end if;

  return jsonb_build_object(
    'id', profile_row.id,
    'display_name', case
      when profile_row.account_status in ('pending', 'active') then profile_row.display_name
      else null
    end,
    'account_status', profile_row.account_status,
    'department', case when profile_row.account_status = 'active' then department_json else null end,
    'position', case when profile_row.account_status = 'active' then position_json else null end,
    'roles', case when profile_row.account_status = 'active' then coalesce(roles_json, '[]'::jsonb) else '[]'::jsonb end,
    'role_simulation', jsonb_build_object(
      'can_switch', profile_row.account_status = 'active' and can_switch,
      'active', simulation_role is not null,
      'role_code', simulation_role,
      'expires_at', simulation_expires_at
    )
  );
end;
$$;
