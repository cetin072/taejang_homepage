-- Issue #274: native mobile onboarding, simple home support, and per-employee holiday work designation.
-- Forward-only. No production data is mutated by this migration.
begin;

alter table public.profiles
  add column if not exists signup_phone text,
  add column if not exists signup_hired_on date;

alter table public.profiles
  drop constraint if exists profiles_signup_phone_format;
alter table public.profiles
  add constraint profiles_signup_phone_format
  check (
    signup_phone is null
    or (
      char_length(btrim(signup_phone)) between 8 and 30
      and btrim(signup_phone) ~ '^[0-9+(). -]+$'
    )
  );

comment on column public.profiles.signup_phone is
  'Applicant-entered contact number used only for onboarding review; never an identity key.';
comment on column public.profiles.signup_hired_on is
  'Applicant-entered expected hire date. Approver confirms it before Employee creation.';

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_display_name text;
  signup_channel text;
  requested_phone text;
  requested_hired_on date;
begin
  safe_display_name := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');
  if safe_display_name is null then
    safe_display_name := '가입자';
  end if;

  signup_channel := nullif(btrim(new.raw_user_meta_data ->> 'signup_channel'), '');
  requested_phone := nullif(btrim(new.raw_user_meta_data ->> 'phone'), '');

  if nullif(btrim(new.raw_user_meta_data ->> 'hired_on'), '') is not null then
    begin
      requested_hired_on := (new.raw_user_meta_data ->> 'hired_on')::date;
    exception when others then
      raise exception using errcode = '22023', message = 'INVALID_HIRED_ON';
    end;
  end if;

  if signup_channel = 'native_employee' then
    if requested_phone is null
       or char_length(requested_phone) not between 8 and 30
       or requested_phone !~ '^[0-9+(). -]+$' then
      raise exception using errcode = '22023', message = 'INVALID_PHONE';
    end if;
    if requested_hired_on is null then
      raise exception using errcode = '22023', message = 'HIRED_ON_REQUIRED';
    end if;
  end if;

  insert into public.profiles (
    id, display_name, work_email, account_status, signup_phone, signup_hired_on
  ) values (
    new.id,
    left(safe_display_name, 80),
    new.email,
    'pending',
    requested_phone,
    requested_hired_on
  );

  insert into public.account_status_history (
    profile_id, previous_status, new_status, reason, changed_by
  ) values (
    new.id, null, 'pending', '회원가입', null
  );

  perform public.private_append_audit(
    new.id,
    'account_signed_up',
    'profile',
    new.id::text,
    'success',
    '회원가입 후 승인 대기 상태 생성',
    jsonb_build_object(
      'signup_channel', coalesce(signup_channel, 'legacy'),
      'hired_on_provided', requested_hired_on is not null,
      'phone_provided', requested_phone is not null
    )
  );

  return new;
end;
$$;

alter function public.handle_new_auth_user() owner to postgres;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

insert into public.platform_capabilities(
  code, capability_kind, operations_manager_auto_grant, description
)
values (
  'employee.onboard',
  'operational',
  true,
  '신입 가입요청 검토 및 Employee 생성·계정연결 승인'
)
on conflict (code) do update
set capability_kind = excluded.capability_kind,
    operations_manager_auto_grant = excluded.operations_manager_auto_grant,
    description = excluded.description,
    active = true,
    updated_at = now();

insert into public.role_capability_grants(role_id, capability_code)
select role.id, 'employee.onboard'
from public.roles role
where role.code = 'promotion_lead'
  and role.active
on conflict (role_id, capability_code) do nothing;

create or replace function public.list_employee_signup_requests()
returns table (
  id uuid,
  display_name text,
  work_email text,
  phone text,
  hired_on date,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('employee.onboard') then
    raise exception using errcode = '42501', message = 'SIGNUP_REVIEW_FORBIDDEN';
  end if;

  return query
  select
    profile.id,
    profile.display_name,
    profile.work_email,
    profile.signup_phone,
    profile.signup_hired_on,
    profile.created_at
  from public.profiles profile
  where profile.account_status = 'pending'
    and profile.signup_phone is not null
    and profile.signup_hired_on is not null
  order by profile.created_at;
end;
$$;

create or replace function public.get_employee_signup_approval_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actual_roles text[] := public.private_actual_role_codes();
  can_assign_lead boolean := 'operations_manager' = any(actual_roles);
begin
  if not public.private_actor_can('employee.onboard') then
    raise exception using errcode = '42501', message = 'SIGNUP_REVIEW_FORBIDDEN';
  end if;

  return jsonb_build_object(
    'departments', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', department.id, 'code', department.code, 'name', department.name)
        order by department.sort_order, department.name
      )
      from public.departments department
      where department.active
    ), '[]'::jsonb),
    'positions', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', position.id, 'code', position.code, 'name', position.name)
        order by case when position.code = 'general_worker' then 0 else 1 end,
                 position.sort_order,
                 position.name
      )
      from public.positions position
      where position.active
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', role.id, 'code', role.code, 'name', role.name)
        order by case role.code
          when 'general_worker' then 0
          when 'promotion_staff' then 1
          when 'promotion_lead' then 2
          else 9
        end
      )
      from public.roles role
      where role.active
        and (
          role.code in ('general_worker', 'promotion_staff')
          or (can_assign_lead and role.code = 'promotion_lead')
        )
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.approve_employee_signup_request(
  p_target_profile_id uuid,
  p_department_id uuid,
  p_position_id uuid,
  p_role_code text,
  p_attendance_required boolean default true,
  p_reason_summary text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actual_roles text[] := public.private_actual_role_codes();
  target public.profiles%rowtype;
  employee_row public.employees%rowtype;
  target_role_id uuid;
  normalized_role text := nullif(btrim(p_role_code), '');
  reason text := left(
    coalesce(nullif(btrim(p_reason_summary), ''), '신입 가입요청 확인 후 직원 생성 및 계정 승인'),
    300
  );
begin
  if actor_id is null or not public.private_actor_can('employee.onboard') then
    return jsonb_build_object('ok', false, 'code', 'SIGNUP_APPROVAL_FORBIDDEN');
  end if;

  if normalized_role not in ('general_worker', 'promotion_staff', 'promotion_lead') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ROLE');
  end if;

  if normalized_role = 'promotion_lead'
     and not ('operations_manager' = any(actual_roles)) then
    return jsonb_build_object('ok', false, 'code', 'ROLE_NOT_ASSIGNABLE');
  end if;

  if p_department_id is null
     or not exists (
       select 1 from public.departments department
       where department.id = p_department_id and department.active
     ) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DEPARTMENT');
  end if;

  if p_position_id is null
     or not exists (
       select 1 from public.positions position
       where position.id = p_position_id and position.active
     ) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_POSITION');
  end if;

  select * into target
  from public.profiles profile
  where profile.id = p_target_profile_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;
  if target.account_status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_PENDING');
  end if;
  if target.signup_phone is null or target.signup_hired_on is null then
    return jsonb_build_object('ok', false, 'code', 'SIGNUP_DETAILS_INCOMPLETE');
  end if;

  if exists (
    select 1
    from public.account_person_links link
    where link.profile_id = p_target_profile_id
      and link.revoked_at is null
  ) then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_ALREADY_LINKED');
  end if;

  select role.id into target_role_id
  from public.roles role
  where role.code = normalized_role and role.active;

  if target_role_id is null then
    return jsonb_build_object('ok', false, 'code', 'ROLE_NOT_AVAILABLE');
  end if;

  employee_row := public.private_insert_employee(
    target.display_name,
    target.signup_hired_on,
    p_department_id,
    p_position_id,
    coalesce(p_attendance_required, true)
  );

  insert into public.account_person_links(
    profile_id, person_id, linked_by, reason
  ) values (
    p_target_profile_id,
    employee_row.person_id,
    actor_id,
    reason
  );

  update public.profiles
  set account_status = 'active',
      department_id = p_department_id,
      position_id = p_position_id,
      approved_at = now(),
      approved_by = actor_id,
      status_changed_at = now(),
      status_changed_by = actor_id,
      status_reason = reason,
      updated_at = now()
  where id = p_target_profile_id;

  insert into public.account_status_history(
    profile_id, previous_status, new_status, reason, changed_by
  ) values (
    p_target_profile_id, 'pending', 'active', reason, actor_id
  );

  insert into public.profile_roles(profile_id, role_id, granted_by)
  values (p_target_profile_id, target_role_id, actor_id);

  perform public.private_append_audit(
    actor_id,
    'employee_signup_approved',
    'employee',
    employee_row.id::text,
    'success',
    reason,
    jsonb_build_object(
      'employee_id', employee_row.employee_id,
      'profile_id', p_target_profile_id,
      'role_code', normalized_role,
      'department_id', p_department_id,
      'position_id', p_position_id,
      'attendance_required', coalesce(p_attendance_required, true)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'EMPLOYEE_SIGNUP_APPROVED',
    'employee_uuid', employee_row.id,
    'employee_id', employee_row.employee_id,
    'role_code', normalized_role
  );
end;
$$;

create or replace function public.reject_employee_signup_request(
  p_target_profile_id uuid,
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
  reason text := nullif(btrim(p_reason_summary), '');
begin
  if actor_id is null or not public.private_actor_can('employee.onboard') then
    return jsonb_build_object('ok', false, 'code', 'SIGNUP_REVIEW_FORBIDDEN');
  end if;
  if reason is null then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into target
  from public.profiles
  where id = p_target_profile_id
  for update;

  if not found or target.account_status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_PENDING');
  end if;

  update public.profiles
  set account_status = 'deleted',
      status_changed_at = now(),
      status_changed_by = actor_id,
      status_reason = left(reason, 300),
      updated_at = now()
  where id = p_target_profile_id;

  insert into public.account_status_history(
    profile_id, previous_status, new_status, reason, changed_by
  ) values (
    p_target_profile_id, 'pending', 'deleted', left(reason, 300), actor_id
  );

  perform public.private_append_audit(
    actor_id,
    'employee_signup_rejected',
    'profile',
    p_target_profile_id::text,
    'success',
    left(reason, 300)
  );

  return jsonb_build_object('ok', true, 'code', 'REJECTED', 'account_status', 'deleted');
end;
$$;

alter function public.list_employee_signup_requests() owner to postgres;
alter function public.get_employee_signup_approval_options() owner to postgres;
alter function public.approve_employee_signup_request(uuid,uuid,uuid,text,boolean,text) owner to postgres;
alter function public.reject_employee_signup_request(uuid,text) owner to postgres;

revoke all on function public.list_employee_signup_requests() from public, anon;
revoke all on function public.get_employee_signup_approval_options() from public, anon;
revoke all on function public.approve_employee_signup_request(uuid,uuid,uuid,text,boolean,text) from public, anon;
revoke all on function public.reject_employee_signup_request(uuid,text) from public, anon;

grant execute on function public.list_employee_signup_requests() to authenticated;
grant execute on function public.get_employee_signup_approval_options() to authenticated;
grant execute on function public.approve_employee_signup_request(uuid,uuid,uuid,text,boolean,text) to authenticated;
grant execute on function public.reject_employee_signup_request(uuid,text) to authenticated;

create table if not exists public.attendance_holiday_work_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  work_date date not null,
  reason text not null check (char_length(btrim(reason)) between 2 and 300),
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id) on delete restrict,
  revoked_at timestamptz
);

create unique index if not exists attendance_holiday_work_one_active
  on public.attendance_holiday_work_assignments(employee_uuid, work_date)
  where revoked_at is null;

create index if not exists attendance_holiday_work_date_idx
  on public.attendance_holiday_work_assignments(work_date, employee_uuid)
  where revoked_at is null;

alter table public.attendance_holiday_work_assignments enable row level security;
revoke all on table public.attendance_holiday_work_assignments
  from public, anon, authenticated, service_role;

comment on table public.attendance_holiday_work_assignments is
  'Explicit per-employee holiday attendance authorization. Revocation preserves history.';

create or replace function public.private_attendance_holiday_assignment_for_profile(
  p_profile_id uuid,
  p_work_date date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.account_person_links link
    join public.employees employee on employee.person_id = link.person_id
    join public.attendance_holiday_work_assignments assignment
      on assignment.employee_uuid = employee.id
     and assignment.work_date = p_work_date
     and assignment.revoked_at is null
    where link.profile_id = p_profile_id
      and link.revoked_at is null
      and public.private_employee_is_attendance_subject(employee.id)
  )
$$;

create or replace function public.private_attendance_is_workday(p_work_date date)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  override_value boolean;
  global_workday boolean;
begin
  select calendar.is_workday into override_value
  from public.attendance_calendar_overrides calendar
  where calendar.work_date = p_work_date;

  if found then
    global_workday := override_value;
  else
    global_workday := extract(isodow from p_work_date)::integer not in (6, 7);
  end if;

  if global_workday then
    return true;
  end if;

  return coalesce(
    public.private_attendance_holiday_assignment_for_profile(auth.uid(), p_work_date),
    false
  );
end;
$$;

create or replace function public.set_attendance_holiday_work_assignment(
  p_employee_uuid uuid,
  p_work_date date,
  p_enabled boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  reason text := nullif(btrim(p_reason), '');
  global_workday boolean;
  active_assignment public.attendance_holiday_work_assignments%rowtype;
begin
  if actor_id is null or not public.private_actor_can('attendance.correct') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_work_date is null or p_employee_uuid is null or reason is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if not public.private_employee_is_attendance_subject(p_employee_uuid) then
    return jsonb_build_object('ok', false, 'code', 'ATTENDANCE_NOT_REQUIRED');
  end if;

  select coalesce(
    (select override_row.is_workday
     from public.attendance_calendar_overrides override_row
     where override_row.work_date = p_work_date),
    extract(isodow from p_work_date)::integer not in (6, 7)
  ) into global_workday;

  if global_workday then
    return jsonb_build_object('ok', false, 'code', 'NOT_HOLIDAY');
  end if;

  select * into active_assignment
  from public.attendance_holiday_work_assignments assignment
  where assignment.employee_uuid = p_employee_uuid
    and assignment.work_date = p_work_date
    and assignment.revoked_at is null
  for update;

  if p_enabled then
    if active_assignment.id is not null then
      return jsonb_build_object('ok', true, 'code', 'NO_CHANGE', 'enabled', true);
    end if;

    insert into public.attendance_holiday_work_assignments(
      employee_uuid, work_date, reason, assigned_by
    ) values (
      p_employee_uuid, p_work_date, reason, actor_id
    );

    perform public.private_append_audit(
      actor_id,
      'attendance_holiday_work_assigned',
      'employee',
      p_employee_uuid::text,
      'success',
      left(reason, 300),
      jsonb_build_object('work_date', p_work_date)
    );

    return jsonb_build_object('ok', true, 'code', 'HOLIDAY_WORK_ASSIGNED', 'enabled', true);
  end if;

  if active_assignment.id is null then
    return jsonb_build_object('ok', true, 'code', 'NO_CHANGE', 'enabled', false);
  end if;

  update public.attendance_holiday_work_assignments
  set revoked_at = now(),
      revoked_by = actor_id
  where id = active_assignment.id;

  perform public.private_append_audit(
    actor_id,
    'attendance_holiday_work_revoked',
    'employee',
    p_employee_uuid::text,
    'success',
    left(reason, 300),
    jsonb_build_object('work_date', p_work_date, 'assignment_id', active_assignment.id)
  );

  return jsonb_build_object('ok', true, 'code', 'HOLIDAY_WORK_REVOKED', 'enabled', false);
end;
$$;

create or replace function public.get_attendance_holiday_work_assignments(
  p_work_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('attendance.admin_view') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'work_date', p_work_date,
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', assignment.id,
          'employee_uuid', assignment.employee_uuid,
          'reason', assignment.reason,
          'assigned_by', assignment.assigned_by,
          'assigned_at', assignment.assigned_at
        )
        order by assignment.assigned_at
      )
      from public.attendance_holiday_work_assignments assignment
      where assignment.work_date = p_work_date
        and assignment.revoked_at is null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_my_attendance_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  work_day date := (now() at time zone 'Asia/Seoul')::date;
  day_status jsonb;
  employee_uuid uuid;
  holiday_assigned boolean := false;
  effective_workday boolean := false;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  employee_uuid := public.private_attendance_employee_uuid_for_profile(actor_id);
  day_status := public.get_attendance_workday_status(work_day);

  if employee_uuid is null then
    return jsonb_build_object(
      'work_date', work_day,
      'attendance_required', false,
      'is_workday', day_status -> 'is_workday',
      'holiday_work_assigned', false,
      'day_reason', '근태 기록 대상 아님',
      'clock_in', null,
      'clock_out', null
    );
  end if;

  holiday_assigned := public.private_attendance_holiday_assignment_for_profile(actor_id, work_day);
  effective_workday := coalesce((day_status ->> 'is_workday')::boolean, false) or holiday_assigned;

  return jsonb_build_object(
    'work_date', work_day,
    'employee_uuid', employee_uuid,
    'attendance_required', true,
    'is_workday', effective_workday,
    'holiday_work_assigned', holiday_assigned,
    'day_reason', case
      when holiday_assigned and not coalesce((day_status ->> 'is_workday')::boolean, false)
        then '휴일근무 지정'
      else day_status ->> 'reason'
    end,
    'clock_in', public.private_attendance_effective_event(employee_uuid, work_day, 'clock_in'),
    'clock_out', public.private_attendance_effective_event(employee_uuid, work_day, 'clock_out')
  );
end;
$$;

alter function public.private_attendance_holiday_assignment_for_profile(uuid,date) owner to postgres;
alter function public.private_attendance_is_workday(date) owner to postgres;
alter function public.set_attendance_holiday_work_assignment(uuid,date,boolean,text) owner to postgres;
alter function public.get_attendance_holiday_work_assignments(date) owner to postgres;
alter function public.get_my_attendance_today() owner to postgres;

revoke all on function public.private_attendance_holiday_assignment_for_profile(uuid,date)
  from public, anon, authenticated;
revoke all on function public.private_attendance_is_workday(date)
  from public, anon, authenticated;
revoke all on function public.set_attendance_holiday_work_assignment(uuid,date,boolean,text)
  from public, anon;
revoke all on function public.get_attendance_holiday_work_assignments(date)
  from public, anon;
revoke all on function public.get_my_attendance_today()
  from public, anon;

grant execute on function public.set_attendance_holiday_work_assignment(uuid,date,boolean,text)
  to authenticated;
grant execute on function public.get_attendance_holiday_work_assignments(date)
  to authenticated;
grant execute on function public.get_my_attendance_today()
  to authenticated;

commit;
