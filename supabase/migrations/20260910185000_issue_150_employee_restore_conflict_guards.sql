-- Issue #150: strengthen recoverable Employee restore without changing identity ownership.
-- The public capability wrapper remains authoritative. Archive captures an additive
-- guard snapshot and restore refuses to overwrite post-archive account/link/role changes.

begin;

create or replace function public.archive_employee(
  p_employee_uuid uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  employee_row public.employees%rowtype;
  snapshot jsonb;
  guard_snapshot jsonb;
  linked_profile_id uuid;
  profile_row public.profiles%rowtype;
  active_role_codes jsonb := '[]'::jsonb;
begin
  if not public.private_actor_can('employee.archive') then
    raise exception using errcode='42501', message='EMPLOYEE_DELETE_FORBIDDEN';
  end if;

  result := public.private_archive_employee_pre148(p_employee_uuid, p_reason);

  -- Never manufacture a new guard snapshot for a record that was already archived.
  -- Its original archive state remains the source of truth.
  if result ->> 'code' <> 'EMPLOYEE_DELETED' then
    return result;
  end if;

  select * into employee_row
  from public.employees
  where id = p_employee_uuid;

  snapshot := coalesce(employee_row.archive_snapshot, '{}'::jsonb);
  linked_profile_id := nullif(snapshot ->> 'linked_profile_id', '')::uuid;

  if linked_profile_id is not null then
    select * into profile_row
    from public.profiles
    where id = linked_profile_id;

    select coalesce(jsonb_agg(role.code order by role.code), '[]'::jsonb)
    into active_role_codes
    from public.profile_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = linked_profile_id
      and assignment.revoked_at is null
      and role.active;
  end if;

  guard_snapshot := jsonb_build_object(
    'guard_version', 2,
    'archived_at', employee_row.archived_at,
    'employee_hired_on', employee_row.hired_on,
    'employee_department_id', employee_row.department_id,
    'employee_position_id', employee_row.position_id,
    'person_full_name', (select person.full_name from public.people person where person.id = employee_row.person_id),
    'linked_profile_department_id', case when linked_profile_id is null then null else profile_row.department_id end,
    'linked_profile_position_id', case when linked_profile_id is null then null else profile_row.position_id end,
    'linked_profile_status_changed_at', case when linked_profile_id is null then null else profile_row.status_changed_at end,
    'active_role_codes', active_role_codes
  );

  update public.employees
  set archive_snapshot = snapshot || jsonb_build_object('restore_guard', guard_snapshot)
  where id = employee_row.id;

  return result || jsonb_build_object('restore_guard_version', 2);
end;
$$;

create or replace function public.private_employee_restore_conflict_code(
  p_employee_uuid uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  employee_row public.employees%rowtype;
  snapshot jsonb;
  guard_snapshot jsonb;
  guard_version integer := 0;
  linked_profile_id uuid;
  previous_account_status public.account_status;
  profile_row public.profiles%rowtype;
  expected_department_id uuid;
  expected_position_id uuid;
  expected_hired_on date;
  expected_full_name text;
  expected_profile_department_id uuid;
  expected_profile_position_id uuid;
  expected_profile_status_changed_at timestamptz;
  current_role_codes jsonb := '[]'::jsonb;
  expected_role_codes jsonb := '[]'::jsonb;
begin
  select * into employee_row
  from public.employees
  where id = p_employee_uuid;

  if not found or employee_row.archived_at is null then
    return null;
  end if;

  snapshot := coalesce(employee_row.archive_snapshot, '{}'::jsonb);
  guard_snapshot := coalesce(snapshot -> 'restore_guard', '{}'::jsonb);
  if jsonb_typeof(guard_snapshot) <> 'object' then
    return 'EMPLOYEE_RESTORE_GUARD_SNAPSHOT_INVALID';
  end if;

  guard_version := coalesce(nullif(guard_snapshot ->> 'guard_version', '')::integer, 0);
  if guard_version not in (0, 2) then
    return 'EMPLOYEE_RESTORE_GUARD_SNAPSHOT_INVALID';
  end if;

  expected_department_id := nullif(snapshot ->> 'department_id', '')::uuid;
  expected_position_id := nullif(snapshot ->> 'position_id', '')::uuid;

  -- Department/position are part of the original archive snapshot. An archived
  -- Employee must not be silently rewritten before restore.
  if employee_row.department_id is distinct from expected_department_id
     or employee_row.position_id is distinct from expected_position_id then
    return 'EMPLOYEE_RESTORE_EMPLOYEE_STATE_CONFLICT';
  end if;

  if guard_version = 2 then
    expected_hired_on := nullif(guard_snapshot ->> 'employee_hired_on', '')::date;
    expected_full_name := guard_snapshot ->> 'person_full_name';
    if expected_hired_on is null or expected_full_name is null then
      return 'EMPLOYEE_RESTORE_GUARD_SNAPSHOT_INVALID';
    end if;
    if employee_row.hired_on is distinct from expected_hired_on
       or (select person.full_name from public.people person where person.id = employee_row.person_id)
          is distinct from expected_full_name then
      return 'EMPLOYEE_RESTORE_EMPLOYEE_STATE_CONFLICT';
    end if;
  end if;

  linked_profile_id := nullif(snapshot ->> 'linked_profile_id', '')::uuid;
  previous_account_status := nullif(snapshot ->> 'linked_profile_account_status', '')::public.account_status;

  if linked_profile_id is null then
    -- There was no linked Auth account at archive time. A later account-person
    -- link would make automatic restore ambiguous, so refuse to guess.
    if exists (
      select 1 from public.account_person_links link
      where link.person_id = employee_row.person_id
        and link.linked_at > employee_row.archived_at
    ) then
      return 'EMPLOYEE_RESTORE_LINK_HISTORY_CONFLICT';
    end if;
    return null;
  end if;

  select * into profile_row
  from public.profiles
  where id = linked_profile_id;
  if not found then
    return 'EMPLOYEE_RESTORE_PROFILE_NOT_FOUND';
  end if;

  if profile_row.account_status <> 'deleted' then
    return 'EMPLOYEE_RESTORE_ACCOUNT_STATE_CONFLICT';
  end if;

  -- The exact relationship archived by the original operation must still exist
  -- as a revoked historical row. We never reconstruct identity from a name.
  if not exists (
    select 1 from public.account_person_links link
    where link.person_id = employee_row.person_id
      and link.profile_id = linked_profile_id
      and link.linked_at <= employee_row.archived_at
      and link.revoked_at = employee_row.archived_at
      and link.revoked_by = employee_row.archived_by
  ) then
    return 'EMPLOYEE_RESTORE_ORIGINAL_LINK_MISSING';
  end if;

  -- Any later link attempt involving either side means the relationship has been
  -- superseded or reconsidered. Restore must stop instead of overwriting it.
  if exists (
    select 1 from public.account_person_links link
    where (link.person_id = employee_row.person_id or link.profile_id = linked_profile_id)
      and link.linked_at > employee_row.archived_at
  ) then
    return 'EMPLOYEE_RESTORE_LINK_HISTORY_CONFLICT';
  end if;

  -- Existing active-link guards are retained here as an early explicit result;
  -- the legacy restore function still enforces the same unique-link boundary.
  if exists (
    select 1 from public.account_person_links link
    where link.person_id = employee_row.person_id and link.revoked_at is null
  ) then
    return 'EMPLOYEE_RESTORE_LINK_CONFLICT';
  end if;
  if exists (
    select 1 from public.account_person_links link
    where link.profile_id = linked_profile_id and link.revoked_at is null
  ) then
    return 'EMPLOYEE_RESTORE_PROFILE_LINK_CONFLICT';
  end if;

  -- Archive itself changes a non-deleted account to deleted at the same
  -- transaction timestamp. Any later status mutation, even if changed back to
  -- deleted, makes automatic restoration unsafe.
  if previous_account_status is distinct from 'deleted'::public.account_status then
    if profile_row.status_changed_at is distinct from employee_row.archived_at
       or profile_row.status_changed_by is distinct from employee_row.archived_by
       or not exists (
         select 1 from public.account_status_history history
         where history.profile_id = linked_profile_id
           and history.previous_status is not distinct from previous_account_status
           and history.new_status = 'deleted'
           and history.changed_by = employee_row.archived_by
           and history.created_at = employee_row.archived_at
       )
       or exists (
         select 1 from public.account_status_history history
         where history.profile_id = linked_profile_id
           and history.created_at > employee_row.archived_at
       ) then
      return 'EMPLOYEE_RESTORE_ACCOUNT_HISTORY_CONFLICT';
    end if;
  else
    if profile_row.status_changed_at > employee_row.archived_at
       or exists (
         select 1 from public.account_status_history history
         where history.profile_id = linked_profile_id
           and history.created_at > employee_row.archived_at
       ) then
      return 'EMPLOYEE_RESTORE_ACCOUNT_HISTORY_CONFLICT';
    end if;
  end if;

  if guard_version = 2 then
    expected_profile_department_id := nullif(guard_snapshot ->> 'linked_profile_department_id', '')::uuid;
    expected_profile_position_id := nullif(guard_snapshot ->> 'linked_profile_position_id', '')::uuid;
    expected_profile_status_changed_at := nullif(guard_snapshot ->> 'linked_profile_status_changed_at', '')::timestamptz;
    expected_role_codes := coalesce(guard_snapshot -> 'active_role_codes', '[]'::jsonb);

    if jsonb_typeof(expected_role_codes) <> 'array'
       or profile_row.department_id is distinct from expected_profile_department_id
       or profile_row.position_id is distinct from expected_profile_position_id
       or profile_row.status_changed_at is distinct from expected_profile_status_changed_at then
      return 'EMPLOYEE_RESTORE_ACCOUNT_METADATA_CONFLICT';
    end if;

    select coalesce(jsonb_agg(role.code order by role.code), '[]'::jsonb)
    into current_role_codes
    from public.profile_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = linked_profile_id
      and assignment.revoked_at is null
      and role.active;

    if current_role_codes is distinct from expected_role_codes then
      return 'EMPLOYEE_RESTORE_ROLE_STATE_CONFLICT';
    end if;
  end if;

  -- Even for legacy archive snapshots, a role grant/revoke after archive is a
  -- meaningful authority mutation and must not be activated implicitly.
  if exists (
    select 1 from public.profile_roles assignment
    where assignment.profile_id = linked_profile_id
      and (assignment.granted_at > employee_row.archived_at
           or assignment.revoked_at > employee_row.archived_at)
  ) then
    return 'EMPLOYEE_RESTORE_ROLE_HISTORY_CONFLICT';
  end if;

  return null;
end;
$$;

create or replace function public.restore_employee(
  p_employee_uuid uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conflict_code text;
begin
  if not public.private_actor_can('employee.restore') then
    raise exception using errcode='42501', message='EMPLOYEE_RESTORE_FORBIDDEN';
  end if;

  -- Lock the Employee archive state for the preflight + restore transaction.
  perform 1 from public.employees where id = p_employee_uuid for update;

  conflict_code := public.private_employee_restore_conflict_code(p_employee_uuid);
  if conflict_code is not null then
    raise exception using errcode='55000', message=conflict_code;
  end if;

  return public.private_restore_employee_pre148(p_employee_uuid, p_reason);
end;
$$;

revoke all on function public.private_employee_restore_conflict_code(uuid) from public, anon, authenticated;
revoke all on function public.archive_employee(uuid,text) from public, anon;
revoke all on function public.restore_employee(uuid,text) from public, anon;
grant execute on function public.archive_employee(uuid,text) to authenticated;
grant execute on function public.restore_employee(uuid,text) to authenticated;

commit;
