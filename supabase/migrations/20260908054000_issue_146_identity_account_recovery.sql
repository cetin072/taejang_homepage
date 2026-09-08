-- Issue #146 end-to-end contract fixes: employee identity, account authority,
-- recoverable archive, promotion recovery, and role simulation.
-- Forward-only: no production data mutation is performed by this migration.
begin;

-- ---------------------------------------------------------------------------
-- Employee identity: allow a truly unassigned new Employee.
-- Position remains required; department may be assigned later.
-- ---------------------------------------------------------------------------
alter table public.employees
  alter column department_id drop not null;

alter table public.employees
  add column if not exists archive_snapshot jsonb not null default '{}'::jsonb;

alter table public.employees
  drop constraint if exists employees_archive_snapshot_object;
alter table public.employees
  add constraint employees_archive_snapshot_object
  check (jsonb_typeof(archive_snapshot) = 'object' and octet_length(archive_snapshot::text) <= 8192);

create or replace function public.private_insert_employee(
  p_full_name text,
  p_hired_on date,
  p_department_id uuid,
  p_position_id uuid,
  p_attendance_required boolean
)
returns public.employees
language plpgsql
security definer
set search_path = ''
as $$
declare
  person_row public.people%rowtype;
  employee_row public.employees%rowtype;
begin
  if nullif(btrim(p_full_name), '') is null or char_length(btrim(p_full_name)) > 80 then
    raise exception using errcode = '22023', message = 'INVALID_EMPLOYEE_NAME';
  end if;
  if p_hired_on is null then
    raise exception using errcode = '22023', message = 'HIRED_ON_REQUIRED';
  end if;
  if p_department_id is not null
     and not exists (select 1 from public.departments d where d.id = p_department_id and d.active) then
    raise exception using errcode = '22023', message = 'INVALID_DEPARTMENT';
  end if;
  if p_position_id is null
     or not exists (select 1 from public.positions p where p.id = p_position_id and p.active) then
    raise exception using errcode = '22023', message = 'INVALID_POSITION';
  end if;

  insert into public.people(full_name)
  values (btrim(p_full_name))
  returning * into person_row;

  insert into public.employees(
    employee_id,
    person_id,
    department_id,
    position_id,
    hired_on,
    attendance_required
  ) values (
    public.private_next_employee_id(),
    person_row.id,
    p_department_id,
    p_position_id,
    p_hired_on,
    coalesce(p_attendance_required, true)
  ) returning * into employee_row;

  return employee_row;
end;
$$;

create or replace function public.create_employee(
  p_full_name text,
  p_hired_on date,
  p_department_id uuid,
  p_position_id uuid,
  p_attendance_required boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  employee_row public.employees%rowtype;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not (
       public.current_user_has_role('operations_manager')
       or public.current_user_has_role('promotion_lead')
     ) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_CREATE_FORBIDDEN';
  end if;

  employee_row := public.private_insert_employee(
    p_full_name,
    p_hired_on,
    p_department_id,
    p_position_id,
    p_attendance_required
  );

  perform public.private_append_audit(
    actor_id,
    'employee_created',
    'employee',
    employee_row.id::text,
    'success',
    '직원 마스터 등록',
    jsonb_build_object(
      'employee_id', employee_row.employee_id,
      'department_id', employee_row.department_id,
      'position_id', employee_row.position_id,
      'unassigned_department', employee_row.department_id is null,
      'authority', case
        when public.current_user_has_role('operations_manager') then 'operations_manager'
        else 'promotion_lead'
      end
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'EMPLOYEE_CREATED',
    'employee_uuid', employee_row.id,
    'employee_id', employee_row.employee_id
  );
end;
$$;

create or replace function public.update_employee_core(
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
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  employee_row public.employees%rowtype;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'EMPLOYEE_UPDATE_FORBIDDEN';
  end if;

  select * into employee_row
  from public.employees
  where id = p_employee_uuid
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  if employee_row.archived_at is not null then
    raise exception using errcode = '55000', message = 'EMPLOYEE_ARCHIVED_RESTORE_FIRST';
  end if;
  if nullif(btrim(p_full_name), '') is null or char_length(btrim(p_full_name)) > 80 then
    raise exception using errcode = '22023', message = 'INVALID_EMPLOYEE_NAME';
  end if;
  if p_hired_on is null then
    raise exception using errcode = '22023', message = 'HIRED_ON_REQUIRED';
  end if;
  if p_employment_status not in ('active', 'leave', 'departed') then
    raise exception using errcode = '22023', message = 'INVALID_EMPLOYMENT_STATUS';
  end if;
  if p_employment_status = 'departed' and p_departed_on is null then
    raise exception using errcode = '22023', message = 'DEPARTED_ON_REQUIRED';
  end if;
  if p_department_id is not null
     and not exists (select 1 from public.departments d where d.id = p_department_id and d.active) then
    raise exception using errcode = '22023', message = 'INVALID_DEPARTMENT';
  end if;
  if p_position_id is null
     or not exists (select 1 from public.positions p where p.id = p_position_id and p.active) then
    raise exception using errcode = '22023', message = 'INVALID_POSITION';
  end if;

  update public.people
  set full_name = btrim(p_full_name), updated_at = now()
  where id = employee_row.person_id;

  update public.employees
  set hired_on = p_hired_on,
      department_id = p_department_id,
      position_id = p_position_id,
      employment_status = p_employment_status,
      departed_on = case when p_employment_status = 'departed' then p_departed_on else null end,
      attendance_required = coalesce(p_attendance_required, true),
      updated_at = now()
  where id = employee_row.id;

  perform public.private_append_audit(
    actor_id,
    'employee_updated',
    'employee',
    employee_row.id::text,
    'success',
    left(coalesce(nullif(btrim(p_reason), ''), '직원정보 수정'), 300),
    jsonb_build_object(
      'employee_id', employee_row.employee_id,
      'department_id', p_department_id,
      'position_id', p_position_id,
      'employment_status', p_employment_status,
      'unassigned_department', p_department_id is null
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'EMPLOYEE_UPDATED',
    'employee_uuid', employee_row.id,
    'employee_id', employee_row.employee_id
  );
end;
$$;

-- Promotion lead gets the full organization catalog for new registration, but
-- does not gain cross-department access to existing employee records.
create or replace function public.get_employee_management_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  is_ops boolean := public.current_user_has_role('operations_manager');
  is_promotion_lead boolean := public.current_user_has_role('promotion_lead');
  actor_department uuid := public.private_team_lead_department();
  employees_json jsonb;
  requests_json jsonb;
  departments_json jsonb;
  positions_json jsonb;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or (not is_ops and not is_promotion_lead and actor_department is null) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_MANAGEMENT_FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'employee_id', e.employee_id,
    'full_name', person.full_name,
    'employment_status', e.employment_status,
    'department_id', e.department_id,
    'department_name', department.name,
    'position_id', e.position_id,
    'position_name', position.name,
    'hired_on', e.hired_on,
    'departed_on', e.departed_on,
    'attendance_required', e.attendance_required,
    'profile_photo_path', (
      select photo.storage_path
      from public.employee_photos photo
      where photo.employee_uuid = e.id and photo.photo_type = 'profile' and photo.is_current
      limit 1
    ),
    'id_photo_path', case when is_ops then (
      select photo.storage_path
      from public.employee_photos photo
      where photo.employee_uuid = e.id and photo.photo_type = 'id_photo' and photo.is_current
      limit 1
    ) else null end,
    'linked_profile', (
      select jsonb_build_object(
        'id', profile.id,
        'display_name', profile.display_name,
        'work_email', case when is_ops then profile.work_email else null end,
        'account_status', profile.account_status::text
      )
      from public.account_person_links link
      join public.profiles profile on profile.id = link.profile_id
      where link.person_id = e.person_id and link.revoked_at is null
      limit 1
    ),
    'protected', public.private_employee_is_protected(e.id)
  ) order by e.employee_id), '[]'::jsonb)
  into employees_json
  from public.employees e
  join public.people person on person.id = e.person_id
  left join public.departments department on department.id = e.department_id
  join public.positions position on position.id = e.position_id
  where e.archived_at is null
    and (
      is_ops
      or (actor_department is not null and e.department_id = actor_department)
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id,
    'employee_uuid', request.employee_uuid,
    'request_type', request.request_type,
    'requested_changes', request.requested_changes,
    'requested_by', request.requested_by,
    'requested_at', request.requested_at,
    'status', request.status,
    'decision_comment', request.decision_comment
  ) order by request.requested_at desc), '[]'::jsonb)
  into requests_json
  from public.employee_change_requests request
  left join public.employees e on e.id = request.employee_uuid
  where (
    (is_ops and request.status = 'pending')
    or (not is_ops and request.requested_by = actor_id and request.status in ('pending', 'changes_requested'))
  )
  and (e.id is null or e.archived_at is null);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', department.id,
    'name', department.name,
    'code', department.code
  ) order by department.sort_order, department.name), '[]'::jsonb)
  into departments_json
  from public.departments department
  where department.active
    and (is_ops or is_promotion_lead or department.id = actor_department);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', position.id,
    'name', position.name,
    'code', position.code
  ) order by case when position.code = 'general_worker' then 0 else 1 end, position.sort_order, position.name), '[]'::jsonb)
  into positions_json
  from public.positions position
  where position.active;

  return jsonb_build_object(
    'access_level', case
      when is_ops then 'operations_manager'
      when is_promotion_lead then 'promotion_lead_global_create'
      else 'team_lead'
    end,
    'department_id', actor_department,
    'employees', employees_json,
    'change_requests', requests_json,
    'departments', departments_json,
    'positions', positions_json,
    'can_create_unassigned', is_ops or is_promotion_lead,
    'can_delete_employee', is_ops
  );
end;
$$;

create or replace function public.get_signup_employee_options()
returns table(
  employee_uuid uuid,
  employee_id text,
  full_name text,
  department_id uuid,
  department_name text,
  position_id uuid,
  position_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'SIGNUP_EMPLOYEE_OPTIONS_FORBIDDEN';
  end if;

  return query
  select
    e.id,
    e.employee_id,
    person.full_name,
    e.department_id,
    department.name,
    e.position_id,
    position.name
  from public.employees e
  join public.people person on person.id = e.person_id
  left join public.departments department on department.id = e.department_id
  join public.positions position on position.id = e.position_id
  where e.employment_status = 'active'
    and e.archived_at is null
    and not exists (
      select 1
      from public.account_person_links link
      where link.person_id = e.person_id and link.revoked_at is null
    )
  order by e.employee_id;
end;
$$;

create or replace function public.approve_signup_request_with_employee(
  p_target_profile_id uuid,
  p_employee_uuid uuid,
  p_role_code text,
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target public.profiles%rowtype;
  employee_row public.employees%rowtype;
  target_role_id uuid;
  normalized_role text := nullif(btrim(p_role_code), '');
  active_profile uuid;
begin
  if actor_id is null or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'SIGNUP_APPROVAL_FORBIDDEN';
  end if;
  if normalized_role not in ('general_worker', 'promotion_staff', 'promotion_lead') then
    raise exception using errcode = '22023', message = 'INVALID_ROLE';
  end if;

  select * into target
  from public.profiles
  where id = p_target_profile_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_NOT_FOUND';
  end if;
  if target.account_status <> 'pending' then
    raise exception using errcode = '55000', message = 'PROFILE_NOT_PENDING';
  end if;

  select * into employee_row
  from public.employees
  where id = p_employee_uuid
  for update;
  if not found
     or employee_row.archived_at is not null
     or employee_row.employment_status <> 'active' then
    raise exception using errcode = '22023', message = 'EMPLOYEE_NOT_AVAILABLE';
  end if;

  select link.profile_id into active_profile
  from public.account_person_links link
  where link.person_id = employee_row.person_id and link.revoked_at is null
  limit 1;

  if active_profile is not null and active_profile <> p_target_profile_id then
    raise exception using errcode = '23505', message = 'EMPLOYEE_ALREADY_LINKED';
  end if;
  if exists (
    select 1
    from public.account_person_links link
    where link.profile_id = p_target_profile_id
      and link.revoked_at is null
      and link.person_id <> employee_row.person_id
  ) then
    raise exception using errcode = '23505', message = 'PROFILE_ALREADY_LINKED';
  end if;

  if active_profile is null then
    insert into public.account_person_links(profile_id, person_id, linked_by, reason)
    values (
      p_target_profile_id,
      employee_row.person_id,
      actor_id,
      left(coalesce(nullif(btrim(p_reason_summary), ''), '직원 계정 연결'), 300)
    );
  end if;

  select role.id into target_role_id
  from public.roles role
  where role.code = normalized_role and role.active;
  if target_role_id is null then
    raise exception using errcode = '22023', message = 'ROLE_NOT_AVAILABLE';
  end if;

  update public.profiles
  set account_status = 'active',
      department_id = employee_row.department_id,
      position_id = employee_row.position_id,
      approved_at = now(),
      approved_by = actor_id,
      status_changed_at = now(),
      status_changed_by = actor_id,
      status_reason = left(coalesce(nullif(btrim(p_reason_summary), ''), '직원 계정 연결 후 가입 승인'), 300),
      updated_at = now()
  where id = p_target_profile_id;

  insert into public.account_status_history(profile_id, previous_status, new_status, reason, changed_by)
  values (
    p_target_profile_id,
    'pending',
    'active',
    left(coalesce(nullif(btrim(p_reason_summary), ''), '직원 계정 연결 후 가입 승인'), 300),
    actor_id
  );

  insert into public.profile_roles(profile_id, role_id, granted_by)
  values (p_target_profile_id, target_role_id, actor_id);

  perform public.private_append_audit(
    actor_id,
    'employee_account_linked_and_approved',
    'employee',
    employee_row.id::text,
    'success',
    left(coalesce(nullif(btrim(p_reason_summary), ''), '직원 계정 연결 후 가입 승인'), 300),
    jsonb_build_object(
      'employee_id', employee_row.employee_id,
      'profile_id', p_target_profile_id,
      'role_code', normalized_role,
      'unassigned_department', employee_row.department_id is null
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'EMPLOYEE_ACCOUNT_APPROVED',
    'employee_uuid', employee_row.id,
    'employee_id', employee_row.employee_id,
    'role_code', normalized_role
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Employee recoverable archive with a real restore path.
-- ---------------------------------------------------------------------------
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
  actor_id uuid := auth.uid();
  employee_row public.employees%rowtype;
  linked_profile_id uuid;
  previous_account_status public.account_status;
  reason text := nullif(btrim(p_reason), '');
  snapshot jsonb;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'EMPLOYEE_DELETE_FORBIDDEN';
  end if;
  if reason is null then
    raise exception using errcode = '22023', message = 'EMPLOYEE_DELETE_REASON_REQUIRED';
  end if;

  select * into employee_row
  from public.employees
  where id = p_employee_uuid
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  if employee_row.archived_at is not null then
    return jsonb_build_object('ok', true, 'code', 'EMPLOYEE_ALREADY_DELETED');
  end if;
  if public.private_employee_is_protected(employee_row.id) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_DELETE_PROTECTED';
  end if;

  select link.profile_id
  into linked_profile_id
  from public.account_person_links link
  where link.person_id = employee_row.person_id
    and link.revoked_at is null
  limit 1
  for update;

  if linked_profile_id = actor_id then
    raise exception using errcode = '42501', message = 'EMPLOYEE_DELETE_SELF_FORBIDDEN';
  end if;

  if linked_profile_id is not null then
    select profile.account_status
    into previous_account_status
    from public.profiles profile
    where profile.id = linked_profile_id
    for update;
  end if;

  snapshot := jsonb_build_object(
    'employment_status', employee_row.employment_status,
    'departed_on', employee_row.departed_on,
    'attendance_required', employee_row.attendance_required,
    'department_id', employee_row.department_id,
    'position_id', employee_row.position_id,
    'linked_profile_id', linked_profile_id,
    'linked_profile_account_status', previous_account_status
  );

  update public.employees
  set archived_at = now(),
      archived_by = actor_id,
      archive_reason = left(reason, 300),
      archive_snapshot = snapshot,
      employment_status = 'departed',
      departed_on = coalesce(departed_on, current_date),
      attendance_required = false,
      updated_at = now()
  where id = employee_row.id;

  if linked_profile_id is not null then
    if previous_account_status <> 'deleted' then
      update public.profiles
      set account_status = 'deleted',
          status_changed_at = now(),
          status_changed_by = actor_id,
          status_reason = left(reason, 300),
          updated_at = now()
      where id = linked_profile_id;

      insert into public.account_status_history(profile_id, previous_status, new_status, reason, changed_by)
      values (linked_profile_id, previous_account_status, 'deleted', left(reason, 300), actor_id);
    end if;

    update public.account_person_links
    set revoked_at = now(),
        revoked_by = actor_id,
        reason = left(reason, 300)
    where person_id = employee_row.person_id
      and profile_id = linked_profile_id
      and revoked_at is null;
  end if;

  perform public.private_append_audit(
    actor_id,
    'employee_deleted',
    'employee',
    employee_row.id::text,
    'success',
    left(reason, 300),
    jsonb_build_object(
      'employee_id', employee_row.employee_id,
      'linked_profile_id', linked_profile_id,
      'recoverable_archive_preserved', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'EMPLOYEE_DELETED',
    'employee_uuid', employee_row.id,
    'account_blocked', linked_profile_id is not null,
    'recoverable_archive_preserved', true
  );
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
  actor_id uuid := auth.uid();
  employee_row public.employees%rowtype;
  snapshot jsonb;
  previous_employment_status text;
  previous_departed_on date;
  previous_attendance_required boolean;
  linked_profile_id uuid;
  previous_account_status public.account_status;
  current_account_status public.account_status;
  reason text := nullif(btrim(p_reason), '');
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'EMPLOYEE_RESTORE_FORBIDDEN';
  end if;
  if reason is null then
    raise exception using errcode = '22023', message = 'EMPLOYEE_RESTORE_REASON_REQUIRED';
  end if;

  select * into employee_row
  from public.employees
  where id = p_employee_uuid
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  if employee_row.archived_at is null then
    return jsonb_build_object('ok', true, 'code', 'EMPLOYEE_ALREADY_ACTIVE');
  end if;

  snapshot := coalesce(employee_row.archive_snapshot, '{}'::jsonb);
  previous_employment_status := coalesce(nullif(snapshot ->> 'employment_status', ''), 'active');
  if previous_employment_status not in ('active', 'leave', 'departed') then
    raise exception using errcode = '55000', message = 'EMPLOYEE_RESTORE_SNAPSHOT_INVALID';
  end if;
  previous_departed_on := nullif(snapshot ->> 'departed_on', '')::date;
  previous_attendance_required := coalesce((snapshot ->> 'attendance_required')::boolean, true);
  linked_profile_id := nullif(snapshot ->> 'linked_profile_id', '')::uuid;
  previous_account_status := nullif(snapshot ->> 'linked_profile_account_status', '')::public.account_status;

  if previous_employment_status = 'departed' and previous_departed_on is null then
    raise exception using errcode = '55000', message = 'EMPLOYEE_RESTORE_SNAPSHOT_INVALID';
  end if;

  if linked_profile_id is not null then
    if exists (
      select 1 from public.account_person_links link
      where link.person_id = employee_row.person_id and link.revoked_at is null
    ) then
      raise exception using errcode = '23505', message = 'EMPLOYEE_RESTORE_LINK_CONFLICT';
    end if;
    if exists (
      select 1 from public.account_person_links link
      where link.profile_id = linked_profile_id and link.revoked_at is null
    ) then
      raise exception using errcode = '23505', message = 'EMPLOYEE_RESTORE_PROFILE_LINK_CONFLICT';
    end if;

    select profile.account_status
    into current_account_status
    from public.profiles profile
    where profile.id = linked_profile_id
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'EMPLOYEE_RESTORE_PROFILE_NOT_FOUND';
    end if;
    if current_account_status <> 'deleted' then
      raise exception using errcode = '55000', message = 'EMPLOYEE_RESTORE_ACCOUNT_STATE_CONFLICT';
    end if;
  end if;

  update public.employees
  set employment_status = previous_employment_status,
      departed_on = case when previous_employment_status = 'departed' then previous_departed_on else null end,
      attendance_required = previous_attendance_required,
      archived_at = null,
      archived_by = null,
      archive_reason = null,
      archive_snapshot = '{}'::jsonb,
      updated_at = now()
  where id = employee_row.id;

  if linked_profile_id is not null then
    if previous_account_status is null then
      previous_account_status := 'active';
    end if;

    update public.profiles
    set account_status = previous_account_status,
        department_id = employee_row.department_id,
        position_id = employee_row.position_id,
        status_changed_at = now(),
        status_changed_by = actor_id,
        status_reason = left(reason, 300),
        updated_at = now()
    where id = linked_profile_id;

    if current_account_status is distinct from previous_account_status then
      insert into public.account_status_history(profile_id, previous_status, new_status, reason, changed_by)
      values (linked_profile_id, current_account_status, previous_account_status, left(reason, 300), actor_id);
    end if;

    insert into public.account_person_links(profile_id, person_id, linked_by, reason)
    values (linked_profile_id, employee_row.person_id, actor_id, left(reason, 300));
  end if;

  perform public.private_append_audit(
    actor_id,
    'employee_restored',
    'employee',
    employee_row.id::text,
    'success',
    left(reason, 300),
    jsonb_build_object(
      'employee_id', employee_row.employee_id,
      'employment_status', previous_employment_status,
      'linked_profile_id', linked_profile_id,
      'account_status', previous_account_status
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'EMPLOYEE_RESTORED',
    'employee_uuid', employee_row.id,
    'employee_id', employee_row.employee_id
  );
end;
$$;

create or replace function public.get_archived_employee_management()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'EMPLOYEE_ARCHIVE_READ_FORBIDDEN';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id,
      'employee_id', e.employee_id,
      'full_name', person.full_name,
      'department_id', e.department_id,
      'department_name', department.name,
      'position_id', e.position_id,
      'position_name', position.name,
      'archived_at', e.archived_at,
      'archive_reason', e.archive_reason,
      'previous_employment_status', e.archive_snapshot ->> 'employment_status',
      'previous_attendance_required', e.archive_snapshot ->> 'attendance_required',
      'linked_profile_id', e.archive_snapshot ->> 'linked_profile_id'
    ) order by e.archived_at desc)
    from public.employees e
    join public.people person on person.id = e.person_id
    left join public.departments department on department.id = e.department_id
    join public.positions position on position.id = e.position_id
    where e.archived_at is not null
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Auth <-> Employee operational link management.
-- ---------------------------------------------------------------------------
create or replace function public.get_operations_account_management()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'ACCOUNT_MANAGEMENT_FORBIDDEN';
  end if;

  return jsonb_build_object(
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', profile.id,
        'display_name', profile.display_name,
        'work_email', profile.work_email,
        'account_status', profile.account_status::text,
        'department_id', profile.department_id,
        'position_id', profile.position_id,
        'roles', coalesce((
          select jsonb_agg(role.code order by role.code)
          from public.profile_roles assignment
          join public.roles role on role.id = assignment.role_id
          where assignment.profile_id = profile.id
            and assignment.revoked_at is null
            and role.active
        ), '[]'::jsonb),
        'linked_employee_uuid', (
          select employee.id
          from public.account_person_links link
          join public.employees employee on employee.person_id = link.person_id
          where link.profile_id = profile.id and link.revoked_at is null
          limit 1
        )
      ) order by profile.display_name)
      from public.profiles profile
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', employee.id,
        'employee_id', employee.employee_id,
        'full_name', person.full_name,
        'department_id', employee.department_id,
        'department_name', department.name,
        'position_id', employee.position_id,
        'position_name', position.name,
        'employment_status', employee.employment_status,
        'archived', employee.archived_at is not null,
        'linked_profile_id', (
          select link.profile_id
          from public.account_person_links link
          where link.person_id = employee.person_id and link.revoked_at is null
          limit 1
        )
      ) order by employee.employee_id)
      from public.employees employee
      join public.people person on person.id = employee.person_id
      left join public.departments department on department.id = employee.department_id
      join public.positions position on position.id = employee.position_id
    ), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('id', department.id, 'code', department.code, 'name', department.name) order by department.sort_order, department.name)
      from public.departments department where department.active
    ), '[]'::jsonb),
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object('id', position.id, 'code', position.code, 'name', position.name) order by position.sort_order, position.name)
      from public.positions position where position.active
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('code', role.code, 'name', role.name, 'technical', role.code = 'super_admin') order by role.code)
      from public.roles role where role.active
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.link_employee_account(
  p_employee_uuid uuid,
  p_profile_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  employee_row public.employees%rowtype;
  profile_row public.profiles%rowtype;
  reason text := nullif(btrim(p_reason), '');
begin
  if actor_id is null or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'ACCOUNT_LINK_FORBIDDEN';
  end if;
  if reason is null then
    raise exception using errcode = '22023', message = 'ACCOUNT_LINK_REASON_REQUIRED';
  end if;

  select * into employee_row
  from public.employees
  where id = p_employee_uuid
  for update;
  if not found or employee_row.archived_at is not null then
    raise exception using errcode = '22023', message = 'EMPLOYEE_NOT_AVAILABLE';
  end if;

  select * into profile_row
  from public.profiles
  where id = p_profile_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.account_person_links link
    where link.person_id = employee_row.person_id and link.revoked_at is null
  ) then
    raise exception using errcode = '23505', message = 'EMPLOYEE_ALREADY_LINKED';
  end if;
  if exists (
    select 1 from public.account_person_links link
    where link.profile_id = p_profile_id and link.revoked_at is null
  ) then
    raise exception using errcode = '23505', message = 'PROFILE_ALREADY_LINKED';
  end if;

  insert into public.account_person_links(profile_id, person_id, linked_by, reason)
  values (p_profile_id, employee_row.person_id, actor_id, left(reason, 300));

  update public.profiles
  set department_id = employee_row.department_id,
      position_id = employee_row.position_id,
      updated_at = now()
  where id = p_profile_id;

  perform public.private_append_audit(
    actor_id,
    'employee_account_linked',
    'employee',
    employee_row.id::text,
    'success',
    left(reason, 300),
    jsonb_build_object('profile_id', p_profile_id, 'employee_id', employee_row.employee_id)
  );

  return jsonb_build_object('ok', true, 'code', 'EMPLOYEE_ACCOUNT_LINKED');
end;
$$;

create or replace function public.unlink_employee_account(
  p_employee_uuid uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  employee_row public.employees%rowtype;
  linked_profile_id uuid;
  reason text := nullif(btrim(p_reason), '');
  active_super_admin_count integer;
begin
  if actor_id is null or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'ACCOUNT_UNLINK_FORBIDDEN';
  end if;
  if reason is null then
    raise exception using errcode = '22023', message = 'ACCOUNT_UNLINK_REASON_REQUIRED';
  end if;

  select * into employee_row
  from public.employees
  where id = p_employee_uuid
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;

  select link.profile_id into linked_profile_id
  from public.account_person_links link
  where link.person_id = employee_row.person_id and link.revoked_at is null
  limit 1
  for update;

  if linked_profile_id is null then
    return jsonb_build_object('ok', true, 'code', 'EMPLOYEE_ACCOUNT_ALREADY_UNLINKED');
  end if;
  if linked_profile_id = actor_id then
    raise exception using errcode = '42501', message = 'ACCOUNT_UNLINK_SELF_FORBIDDEN';
  end if;

  if exists (
    select 1
    from public.profile_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = linked_profile_id
      and assignment.revoked_at is null
      and role.code = 'super_admin'
  ) then
    select count(distinct profile.id)
    into active_super_admin_count
    from public.profiles profile
    join public.profile_roles assignment on assignment.profile_id = profile.id and assignment.revoked_at is null
    join public.roles role on role.id = assignment.role_id and role.code = 'super_admin'
    where profile.account_status = 'active';

    if active_super_admin_count <= 1 then
      raise exception using errcode = '42501', message = 'LAST_ACTIVE_SUPER_ADMIN_PROTECTED';
    end if;
  end if;

  update public.account_person_links
  set revoked_at = now(), revoked_by = actor_id, reason = left(reason, 300)
  where person_id = employee_row.person_id
    and profile_id = linked_profile_id
    and revoked_at is null;

  perform public.private_append_audit(
    actor_id,
    'employee_account_unlinked',
    'employee',
    employee_row.id::text,
    'success',
    left(reason, 300),
    jsonb_build_object('profile_id', linked_profile_id, 'employee_id', employee_row.employee_id)
  );

  return jsonb_build_object('ok', true, 'code', 'EMPLOYEE_ACCOUNT_UNLINKED');
end;
$$;

-- ---------------------------------------------------------------------------
-- Operations manager = normal operational account authority.
-- Technical super_admin remains a separate safety role.
-- ---------------------------------------------------------------------------
create or replace function public.change_account_status(
  p_target_profile_id uuid,
  p_new_status public.account_status,
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_ops boolean := public.current_user_has_role('operations_manager');
  actor_is_super boolean := public.current_user_has_role('super_admin');
  target_profile public.profiles%rowtype;
  active_super_admin_count integer;
  reason text := nullif(btrim(p_reason_summary), '');
begin
  if actor_id is null or not public.current_profile_is_active() or not (actor_is_ops or actor_is_super) then
    perform public.private_append_audit(actor_id, 'account_status_change', 'profile', p_target_profile_id::text, 'denied', '계정 상태 변경 권한 없음');
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if reason is null then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;
  if p_new_status = 'pending' then
    return jsonb_build_object('ok', false, 'code', 'PENDING_REQUIRES_NEW_SIGNUP');
  end if;
  if actor_id = p_target_profile_id and p_new_status <> 'active' then
    perform public.private_append_audit(actor_id, 'account_status_change', 'profile', p_target_profile_id::text, 'denied', '자기 계정 잠금 방지');
    return jsonb_build_object('ok', false, 'code', 'SELF_LOCKOUT_PROTECTED');
  end if;

  perform pg_advisory_xact_lock(77134001);
  select * into target_profile
  from public.profiles
  where id = p_target_profile_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;
  if target_profile.account_status = 'pending' and p_new_status = 'active' then
    return jsonb_build_object('ok', false, 'code', 'USE_APPROVAL_FUNCTION');
  end if;
  if target_profile.account_status = p_new_status then
    return jsonb_build_object('ok', true, 'code', 'NO_CHANGE');
  end if;

  if target_profile.account_status = 'active'
     and p_new_status <> 'active'
     and exists (
       select 1
       from public.profile_roles assignment
       join public.roles role on role.id = assignment.role_id
       where assignment.profile_id = p_target_profile_id
         and assignment.revoked_at is null
         and role.code = 'super_admin'
     ) then
    select count(distinct profile.id)
    into active_super_admin_count
    from public.profiles profile
    join public.profile_roles assignment on assignment.profile_id = profile.id and assignment.revoked_at is null
    join public.roles role on role.id = assignment.role_id and role.code = 'super_admin'
    where profile.account_status = 'active';

    if active_super_admin_count <= 1 then
      perform public.private_append_audit(actor_id, 'last_super_admin_change_denied', 'profile', p_target_profile_id::text, 'denied', '마지막 활성 최고관리자 보호');
      return jsonb_build_object('ok', false, 'code', 'LAST_ACTIVE_SUPER_ADMIN_PROTECTED');
    end if;
  end if;

  update public.profiles
  set account_status = p_new_status,
      status_changed_at = now(),
      status_changed_by = actor_id,
      status_reason = left(reason, 300),
      updated_at = now()
  where id = p_target_profile_id;

  insert into public.account_status_history(profile_id, previous_status, new_status, reason, changed_by)
  values (p_target_profile_id, target_profile.account_status, p_new_status, left(reason, 300), actor_id);

  perform public.private_append_audit(
    actor_id,
    case when p_new_status = 'active' then 'account_reactivated' else 'account_status_changed' end,
    'profile',
    p_target_profile_id::text,
    'success',
    left(reason, 300),
    jsonb_build_object('from', target_profile.account_status, 'to', p_new_status, 'authority', case when actor_is_ops then 'operations_manager' else 'super_admin' end)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'STATUS_CHANGED',
    'database_access_blocked', p_new_status <> 'active',
    'auth_session_revocation_required', p_new_status <> 'active'
  );
end;
$$;

create or replace function public.assign_profile_organization(
  p_target_profile_id uuid,
  p_department_id uuid,
  p_position_id uuid,
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_profile public.profiles%rowtype;
  reason text := nullif(btrim(p_reason_summary), '');
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not (
       public.current_user_has_role('operations_manager')
       or public.current_user_has_role('super_admin')
     ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if reason is null then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;
  if p_department_id is not null
     and not exists (select 1 from public.departments where id = p_department_id and active) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DEPARTMENT');
  end if;
  if p_position_id is null
     or not exists (select 1 from public.positions where id = p_position_id and active) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_POSITION');
  end if;

  select * into target_profile
  from public.profiles
  where id = p_target_profile_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;

  update public.profiles
  set department_id = p_department_id,
      position_id = p_position_id,
      updated_at = now()
  where id = p_target_profile_id;

  perform public.private_append_audit(
    actor_id,
    'organization_assignment_changed',
    'profile',
    p_target_profile_id::text,
    'success',
    left(reason, 300),
    jsonb_build_object(
      'previous_department_id', target_profile.department_id,
      'new_department_id', p_department_id,
      'previous_position_id', target_profile.position_id,
      'new_position_id', p_position_id
    )
  );

  return jsonb_build_object('ok', true, 'code', 'ASSIGNMENT_CHANGED');
end;
$$;

create or replace function public.set_profile_roles(
  p_target_profile_id uuid,
  p_role_codes text[],
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_ops boolean := public.current_user_has_role('operations_manager');
  actor_is_super boolean := public.current_user_has_role('super_admin');
  target_status public.account_status;
  normalized_roles text[];
  active_super_admin_count integer;
  target_has_super boolean := false;
  target_has_ops boolean := false;
  role_to_revoke record;
  requested_role record;
  reason text := nullif(btrim(p_reason_summary), '');
begin
  if actor_id is null or not public.current_profile_is_active() or not (actor_is_ops or actor_is_super) then
    perform public.private_append_audit(actor_id, 'role_change', 'profile', p_target_profile_id::text, 'denied', '역할 변경 권한 없음');
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if reason is null then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  perform pg_advisory_xact_lock(77134001);
  select account_status into target_status
  from public.profiles
  where id = p_target_profile_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;

  select coalesce(array_agg(distinct code order by code), array[]::text[])
  into normalized_roles
  from unnest(coalesce(p_role_codes, array[]::text[])) as requested(code);

  if (select count(*) from public.roles where active and code = any(normalized_roles)) <> cardinality(normalized_roles) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ROLES');
  end if;

  select exists (
    select 1 from public.profile_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = p_target_profile_id and assignment.revoked_at is null and role.code = 'super_admin'
  ), exists (
    select 1 from public.profile_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = p_target_profile_id and assignment.revoked_at is null and role.code = 'operations_manager'
  ) into target_has_super, target_has_ops;

  if not actor_is_super and 'super_admin' = any(normalized_roles) then
    return jsonb_build_object('ok', false, 'code', 'TECHNICAL_ROLE_REQUIRES_SUPER_ADMIN');
  end if;

  -- Operations manager edits only operational roles; an existing technical
  -- super_admin assignment is preserved unless a technical super_admin acts.
  if not actor_is_super and target_has_super and not ('super_admin' = any(normalized_roles)) then
    normalized_roles := array_append(normalized_roles, 'super_admin');
  end if;

  if actor_id = p_target_profile_id
     and target_has_ops
     and not ('operations_manager' = any(normalized_roles)) then
    return jsonb_build_object('ok', false, 'code', 'SELF_OPERATION_ROLE_REMOVAL_PROTECTED');
  end if;
  if actor_id = p_target_profile_id
     and target_has_super
     and not ('super_admin' = any(normalized_roles)) then
    return jsonb_build_object('ok', false, 'code', 'SELF_TECHNICAL_ROLE_REMOVAL_PROTECTED');
  end if;
  if 'super_admin' = any(normalized_roles) and target_status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'SUPER_ADMIN_MUST_BE_ACTIVE');
  end if;

  if target_has_super and not ('super_admin' = any(normalized_roles)) then
    select count(distinct profile.id)
    into active_super_admin_count
    from public.profiles profile
    join public.profile_roles assignment on assignment.profile_id = profile.id and assignment.revoked_at is null
    join public.roles role on role.id = assignment.role_id and role.code = 'super_admin'
    where profile.account_status = 'active';

    if active_super_admin_count <= 1 then
      perform public.private_append_audit(actor_id, 'last_super_admin_change_denied', 'profile', p_target_profile_id::text, 'denied', '마지막 활성 최고관리자 역할 보호');
      return jsonb_build_object('ok', false, 'code', 'LAST_ACTIVE_SUPER_ADMIN_PROTECTED');
    end if;
  end if;

  for role_to_revoke in
    select assignment.id, role.code
    from public.profile_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = p_target_profile_id
      and assignment.revoked_at is null
      and not (role.code = any(normalized_roles))
  loop
    update public.profile_roles
    set revoked_at = now(), revoked_by = actor_id
    where id = role_to_revoke.id;

    perform public.private_append_audit(
      actor_id,
      'role_revoked',
      'profile',
      p_target_profile_id::text,
      'success',
      left(reason, 300),
      jsonb_build_object('role_code', role_to_revoke.code)
    );
  end loop;

  for requested_role in
    select role.id, role.code
    from public.roles role
    where role.active
      and role.code = any(normalized_roles)
      and not exists (
        select 1
        from public.profile_roles assignment
        where assignment.profile_id = p_target_profile_id
          and assignment.role_id = role.id
          and assignment.revoked_at is null
      )
  loop
    insert into public.profile_roles(profile_id, role_id, granted_by)
    values (p_target_profile_id, requested_role.id, actor_id);

    perform public.private_append_audit(
      actor_id,
      'role_granted',
      'profile',
      p_target_profile_id::text,
      'success',
      left(reason, 300),
      jsonb_build_object('role_code', requested_role.code)
    );
  end loop;

  return jsonb_build_object('ok', true, 'code', 'ROLES_CHANGED');
end;
$$;

-- ---------------------------------------------------------------------------
-- Operations-manager role simulation no longer requires super_admin.
-- ---------------------------------------------------------------------------
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

  if normalized_role not in ('promotion_staff', 'promotion_lead') then
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

  select exists (
    select 1
    from public.profile_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = actor_id
      and assignment.revoked_at is null
      and role.active
      and role.code = 'operations_manager'
  ) into can_switch;

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
    'display_name', case when profile_row.account_status in ('pending', 'active') then profile_row.display_name else null end,
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

-- ---------------------------------------------------------------------------
-- Promotion archive is genuinely recoverable.
-- ---------------------------------------------------------------------------
alter table public.promotion_contents
  add column if not exists archive_snapshot jsonb not null default '{}'::jsonb;

alter table public.promotion_contents
  drop constraint if exists promotion_contents_archive_snapshot_object;
alter table public.promotion_contents
  add constraint promotion_contents_archive_snapshot_object
  check (jsonb_typeof(archive_snapshot) = 'object' and octet_length(archive_snapshot::text) <= 16384);

create or replace function public.archive_unpublished_promotion_content(
  p_content_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  reason text := nullif(btrim(p_reason), '');
  pending_reviews jsonb := '[]'::jsonb;
  queued_publications jsonb := '[]'::jsonb;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not (
       public.current_user_is_promotion_lead()
       or public.current_user_has_role('operations_manager')
     ) then
    raise exception using errcode = '42501', message = 'PROMOTION_UNPUBLISHED_ARCHIVE_FORBIDDEN';
  end if;
  if reason is null then
    raise exception using errcode = '22023', message = 'PROMOTION_UNPUBLISHED_ARCHIVE_REASON_REQUIRED';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;
  if content_row.published_at is not null
     or content_row.lifecycle in ('published', 'hidden', 'archived') then
    raise exception using errcode = '22023', message = 'PROMOTION_UNPUBLISHED_ARCHIVE_REQUIRES_NO_PUBLIC_HISTORY';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'revision_id', review.revision_id,
    'stage', review.stage::text,
    'requested_by_profile_id', review.requested_by_profile_id
  ) order by review.created_at), '[]'::jsonb)
  into pending_reviews
  from public.promotion_review_requests review
  where review.revision_id in (
    select revision.id
    from public.promotion_content_revisions revision
    where revision.content_id = content_row.id
  ) and review.decision = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
    'revision_id', queue.revision_id,
    'scheduled_for', queue.scheduled_for,
    'queued_by_profile_id', queue.queued_by_profile_id
  ) order by queue.created_at), '[]'::jsonb)
  into queued_publications
  from public.promotion_publication_queue queue
  where queue.revision_id in (
    select revision.id
    from public.promotion_content_revisions revision
    where revision.content_id = content_row.id
  ) and queue.status = 'queued';

  update public.promotion_contents
  set lifecycle = 'archived',
      archive_snapshot = jsonb_build_object(
        'previous_lifecycle', content_row.lifecycle::text,
        'published_at', content_row.published_at,
        'current_revision_id', content_row.current_revision_id,
        'pending_reviews', pending_reviews,
        'queued_publications', queued_publications,
        'archive_kind', 'unpublished'
      ),
      updated_at = now()
  where id = content_row.id;

  update public.promotion_review_requests
  set decision = 'withdrawn',
      decided_by_profile_id = actor_id,
      decision_comment = left(reason, 1000),
      decided_at = now()
  where revision_id in (
    select id from public.promotion_content_revisions where content_id = content_row.id
  ) and decision = 'pending';

  update public.promotion_publication_queue
  set status = 'cancelled', updated_at = now()
  where revision_id in (
    select id from public.promotion_content_revisions where content_id = content_row.id
  ) and status = 'queued';

  perform public.private_append_audit(
    actor_id,
    'promotion_unpublished_archived',
    'promotion_content',
    content_row.id::text,
    'success',
    left(reason, 300),
    jsonb_build_object('recoverable', true, 'previous_lifecycle', content_row.lifecycle::text)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PROMOTION_UNPUBLISHED_ARCHIVED',
    'recoverable_archive_preserved', true
  );
end;
$$;

create or replace function public.delete_promotion_content(
  p_content_id uuid,
  p_confirm_title text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  content_title text;
  reason text := nullif(btrim(p_reason), '');
  pending_reviews jsonb := '[]'::jsonb;
  queued_publications jsonb := '[]'::jsonb;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'PROMOTION_DELETE_FORBIDDEN';
  end if;
  if reason is null then
    raise exception using errcode = '22023', message = 'PROMOTION_DELETE_REASON_REQUIRED';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;
  if content_row.lifecycle = 'archived' then
    return jsonb_build_object('ok', true, 'code', 'PROMOTION_CONTENT_ALREADY_DELETED', 'recoverable_archive_preserved', true);
  end if;

  select title into content_title
  from public.promotion_content_revisions
  where id = content_row.current_revision_id;

  if content_title is null or btrim(coalesce(p_confirm_title, '')) <> content_title then
    raise exception using errcode = '22023', message = 'PROMOTION_DELETE_TITLE_CONFIRMATION_MISMATCH';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'revision_id', review.revision_id,
    'stage', review.stage::text,
    'requested_by_profile_id', review.requested_by_profile_id
  ) order by review.created_at), '[]'::jsonb)
  into pending_reviews
  from public.promotion_review_requests review
  where review.revision_id in (
    select revision.id from public.promotion_content_revisions revision where revision.content_id = content_row.id
  ) and review.decision = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
    'revision_id', queue.revision_id,
    'scheduled_for', queue.scheduled_for,
    'queued_by_profile_id', queue.queued_by_profile_id
  ) order by queue.created_at), '[]'::jsonb)
  into queued_publications
  from public.promotion_publication_queue queue
  where queue.revision_id in (
    select revision.id from public.promotion_content_revisions revision where revision.content_id = content_row.id
  ) and queue.status = 'queued';

  update public.promotion_contents
  set lifecycle = 'archived',
      archive_snapshot = jsonb_build_object(
        'previous_lifecycle', content_row.lifecycle::text,
        'published_at', content_row.published_at,
        'current_revision_id', content_row.current_revision_id,
        'pending_reviews', pending_reviews,
        'queued_publications', queued_publications,
        'archive_kind', case when content_row.published_at is null then 'unpublished' else 'published' end
      ),
      updated_at = now()
  where id = content_row.id;

  update public.promotion_review_requests
  set decision = 'withdrawn',
      decided_by_profile_id = actor_id,
      decision_comment = left(reason, 1000),
      decided_at = now()
  where revision_id in (
    select id from public.promotion_content_revisions where content_id = content_row.id
  ) and decision = 'pending';

  update public.promotion_publication_queue
  set status = 'cancelled', updated_at = now()
  where revision_id in (
    select id from public.promotion_content_revisions where content_id = content_row.id
  ) and status = 'queued';

  update public.promotion_deletion_requests
  set status = 'deleted',
      decided_by_profile_id = actor_id,
      decision_comment = left(reason, 1000),
      decided_at = now()
  where content_id = content_row.id and status = 'pending';

  perform public.private_append_audit(
    actor_id,
    'promotion_content_deleted',
    'promotion_content',
    content_row.id::text,
    'success',
    left(reason, 300),
    jsonb_build_object(
      'title', content_title,
      'previous_lifecycle', content_row.lifecycle::text,
      'new_lifecycle', 'archived',
      'revision_id', content_row.current_revision_id,
      'authority', 'operations_manager',
      'recoverable', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PROMOTION_CONTENT_DELETED',
    'recoverable_archive_preserved', true
  );
end;
$$;

create or replace function public.restore_promotion_content(
  p_content_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  snapshot jsonb;
  previous_lifecycle text;
  reason text := nullif(btrim(p_reason), '');
  item jsonb;
  revision_id uuid;
  review_stage public.promotion_review_stage;
  requested_by uuid;
  scheduled_for timestamptz;
  queued_by uuid;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'PROMOTION_RESTORE_FORBIDDEN';
  end if;
  if reason is null then
    raise exception using errcode = '22023', message = 'PROMOTION_RESTORE_REASON_REQUIRED';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;
  if content_row.lifecycle <> 'archived' then
    return jsonb_build_object('ok', true, 'code', 'PROMOTION_CONTENT_NOT_ARCHIVED');
  end if;

  snapshot := coalesce(content_row.archive_snapshot, '{}'::jsonb);
  previous_lifecycle := nullif(snapshot ->> 'previous_lifecycle', '');
  if previous_lifecycle is null or previous_lifecycle = 'archived' then
    raise exception using errcode = '55000', message = 'PROMOTION_RESTORE_SNAPSHOT_INVALID';
  end if;

  update public.promotion_contents
  set lifecycle = previous_lifecycle::public.promotion_lifecycle,
      published_at = nullif(snapshot ->> 'published_at', '')::timestamptz,
      archive_snapshot = '{}'::jsonb,
      updated_at = now()
  where id = content_row.id;

  for item in select value from jsonb_array_elements(coalesce(snapshot -> 'pending_reviews', '[]'::jsonb))
  loop
    revision_id := nullif(item ->> 'revision_id', '')::uuid;
    review_stage := nullif(item ->> 'stage', '')::public.promotion_review_stage;
    requested_by := nullif(item ->> 'requested_by_profile_id', '')::uuid;
    if revision_id is not null and review_stage is not null and requested_by is not null then
      insert into public.promotion_review_requests(revision_id, stage, requested_by_profile_id)
      select revision_id, review_stage, requested_by
      where exists (select 1 from public.promotion_content_revisions revision where revision.id = revision_id)
        and not exists (
          select 1 from public.promotion_review_requests review
          where review.revision_id = revision_id and review.stage = review_stage and review.decision = 'pending'
        );
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(snapshot -> 'queued_publications', '[]'::jsonb))
  loop
    revision_id := nullif(item ->> 'revision_id', '')::uuid;
    scheduled_for := nullif(item ->> 'scheduled_for', '')::timestamptz;
    queued_by := nullif(item ->> 'queued_by_profile_id', '')::uuid;
    if revision_id is not null and queued_by is not null then
      update public.promotion_publication_queue
      set status = 'queued', scheduled_for = scheduled_for, updated_at = now()
      where revision_id = revision_id;
      if not found then
        insert into public.promotion_publication_queue(revision_id, queued_by_profile_id, scheduled_for, status)
        values (revision_id, queued_by, scheduled_for, 'queued');
      end if;
    end if;
  end loop;

  perform public.private_append_audit(
    actor_id,
    'promotion_content_restored',
    'promotion_content',
    content_row.id::text,
    'success',
    left(reason, 300),
    jsonb_build_object('restored_lifecycle', previous_lifecycle, 'revision_id', content_row.current_revision_id)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PROMOTION_CONTENT_RESTORED',
    'lifecycle', previous_lifecycle
  );
end;
$$;

create or replace function public.get_promotion_archive_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'PROMOTION_ARCHIVE_READ_FORBIDDEN';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'content_id', content.id,
      'title', revision.title,
      'content_type', content.content_type::text,
      'published_at', content.published_at,
      'previous_lifecycle', content.archive_snapshot ->> 'previous_lifecycle',
      'archive_kind', content.archive_snapshot ->> 'archive_kind',
      'updated_at', content.updated_at
    ) order by content.updated_at desc)
    from public.promotion_contents content
    left join public.promotion_content_revisions revision on revision.id = content.current_revision_id
    where content.lifecycle = 'archived'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_promotion_publication_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_lead boolean;
  actor_is_operations boolean;
  items jsonb := '[]'::jsonb;
  requests jsonb := '[]'::jsonb;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'PROMOTION_PUBLICATION_ADMIN_FORBIDDEN';
  end if;

  actor_is_lead := public.current_user_is_promotion_lead();
  actor_is_operations := public.current_user_has_role('operations_manager');
  if not actor_is_lead and not actor_is_operations then
    raise exception using errcode = '42501', message = 'PROMOTION_PUBLICATION_ADMIN_FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'content_id', content.id,
    'title', revision.title,
    'content_type', content.content_type::text,
    'lifecycle', content.lifecycle::text,
    'published_at', content.published_at,
    'hero_image_url', revision.hero_image_url,
    'external_url', revision.external_url,
    'pending_delete_request', exists (
      select 1 from public.promotion_deletion_requests request
      where request.content_id = content.id and request.status = 'pending'
    ),
    'delete_request_eligible_at', case when content.published_at is null then null else content.published_at + interval '24 hours' end,
    'can_request_delete', content.published_at is not null and content.published_at <= now() - interval '24 hours'
  ) order by content.published_at desc nulls last, content.updated_at desc), '[]'::jsonb)
  into items
  from public.promotion_contents content
  join public.promotion_content_revisions revision on revision.id = content.current_revision_id
  where content.lifecycle in ('published', 'hidden');

  select coalesce(jsonb_agg(jsonb_build_object(
    'request_id', request.id,
    'content_id', request.content_id,
    'content_title', request.content_title,
    'reason', request.reason,
    'status', request.status,
    'created_at', request.created_at,
    'decision_comment', request.decision_comment
  ) order by request.created_at desc), '[]'::jsonb)
  into requests
  from public.promotion_deletion_requests request
  where (actor_is_operations and request.status = 'pending')
     or (actor_is_lead and request.requested_by_profile_id = actor_id and request.status in ('pending', 'rejected'));

  return jsonb_build_object(
    'role', case when actor_is_operations then 'operations_manager' else 'promotion_lead' end,
    'items', items,
    'deletion_requests', requests
  );
end;
$$;

-- Permissions.
revoke all on function public.private_insert_employee(text, date, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.create_employee(text, date, uuid, uuid, boolean) from public, anon;
revoke all on function public.update_employee_core(uuid, text, date, uuid, uuid, text, date, boolean, text) from public, anon;
revoke all on function public.get_employee_management_context() from public, anon;
revoke all on function public.get_signup_employee_options() from public, anon;
revoke all on function public.approve_signup_request_with_employee(uuid, uuid, text, text) from public, anon;
revoke all on function public.archive_employee(uuid, text) from public, anon;
revoke all on function public.restore_employee(uuid, text) from public, anon;
revoke all on function public.get_archived_employee_management() from public, anon;
revoke all on function public.get_operations_account_management() from public, anon;
revoke all on function public.link_employee_account(uuid, uuid, text) from public, anon;
revoke all on function public.unlink_employee_account(uuid, text) from public, anon;
revoke all on function public.change_account_status(uuid, public.account_status, text) from public, anon;
revoke all on function public.assign_profile_organization(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.set_profile_roles(uuid, text[], text) from public, anon;
revoke all on function public.set_role_simulation_mode(text) from public, anon;
revoke all on function public.get_my_access_context() from public, anon;
revoke all on function public.archive_unpublished_promotion_content(uuid, text) from public, anon;
revoke all on function public.delete_promotion_content(uuid, text, text) from public, anon;
revoke all on function public.restore_promotion_content(uuid, text) from public, anon;
revoke all on function public.get_promotion_archive_admin() from public, anon;
revoke all on function public.get_promotion_publication_admin() from public, anon;

grant execute on function public.create_employee(text, date, uuid, uuid, boolean) to authenticated;
grant execute on function public.update_employee_core(uuid, text, date, uuid, uuid, text, date, boolean, text) to authenticated;
grant execute on function public.get_employee_management_context() to authenticated;
grant execute on function public.get_signup_employee_options() to authenticated;
grant execute on function public.approve_signup_request_with_employee(uuid, uuid, text, text) to authenticated;
grant execute on function public.archive_employee(uuid, text) to authenticated;
grant execute on function public.restore_employee(uuid, text) to authenticated;
grant execute on function public.get_archived_employee_management() to authenticated;
grant execute on function public.get_operations_account_management() to authenticated;
grant execute on function public.link_employee_account(uuid, uuid, text) to authenticated;
grant execute on function public.unlink_employee_account(uuid, text) to authenticated;
grant execute on function public.change_account_status(uuid, public.account_status, text) to authenticated;
grant execute on function public.assign_profile_organization(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.set_profile_roles(uuid, text[], text) to authenticated;
grant execute on function public.set_role_simulation_mode(text) to authenticated;
grant execute on function public.get_my_access_context() to authenticated;
grant execute on function public.archive_unpublished_promotion_content(uuid, text) to authenticated;
grant execute on function public.delete_promotion_content(uuid, text, text) to authenticated;
grant execute on function public.restore_promotion_content(uuid, text) to authenticated;
grant execute on function public.get_promotion_archive_admin() to authenticated;
grant execute on function public.get_promotion_publication_admin() to authenticated;

commit;
