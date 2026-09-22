-- Goal #329: Taejang employee-app attendance eligibility and operations QA.
-- Attendance eligibility is employee-data driven; operations QA exercises the
-- live GPS/server validation path without writing attendance or payroll data.

begin;

insert into public.platform_capabilities(
  code, capability_kind, operations_manager_auto_grant, description
)
values (
  'attendance.qa_validate',
  'operational',
  true,
  '운영총괄 직원앱 출퇴근 무기록 QA 검증'
)
on conflict (code) do update
set capability_kind = excluded.capability_kind,
    operations_manager_auto_grant = excluded.operations_manager_auto_grant,
    description = excluded.description,
    active = true,
    updated_at = now();

create or replace function public.private_employee_is_attendance_subject(
  p_employee_uuid uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    where e.id = p_employee_uuid
      and e.archived_at is null
      and e.employment_status = 'active'
      and e.attendance_required
  );
$$;

alter function public.private_employee_is_attendance_subject(uuid) owner to postgres;
revoke all on function public.private_employee_is_attendance_subject(uuid)
  from public, anon, authenticated;

comment on function public.private_employee_is_attendance_subject(uuid) is
  'Goal #329: personal attendance eligibility is driven by the active Employee attendance_required flag, not role or position labels.';

create or replace function public.private_validate_attendance_attempt(
  p_event_type text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_virtual_clock_in boolean default false,
  p_allow_non_workday boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  work_day date := (now() at time zone 'Asia/Seoul')::date;
  office public.attendance_locations%rowtype;
  distance_value double precision;
begin
  if actor_id is null or not public.current_profile_is_active() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if p_event_type not in ('clock_in', 'clock_out') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_EVENT_TYPE');
  end if;

  if p_latitude is null or p_latitude not between -90 and 90
     or p_longitude is null or p_longitude not between -180 and 180
     or p_accuracy_m is null or p_accuracy_m < 0 or p_accuracy_m > 5000 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_LOCATION');
  end if;

  if not public.private_attendance_is_workday(work_day)
     and not coalesce(p_allow_non_workday, false) then
    return jsonb_build_object(
      'ok', false,
      'code', 'NON_WORKDAY',
      'work_date', work_day
    );
  end if;

  select * into office
  from public.attendance_locations location
  where location.code = 'taejang_main'
    and location.active
  limit 1;

  if office.id is null then
    return jsonb_build_object('ok', false, 'code', 'ATTENDANCE_LOCATION_UNAVAILABLE');
  end if;

  distance_value := public.private_attendance_distance_m(
    p_latitude,
    p_longitude,
    office.latitude,
    office.longitude
  );

  if p_accuracy_m > 80 then
    return jsonb_build_object(
      'ok', false,
      'code', 'LOCATION_UNCERTAIN',
      'can_request_exception', true,
      'work_date', work_day,
      'accuracy_m', p_accuracy_m,
      'distance_m', distance_value
    );
  end if;

  if distance_value > office.radius_m then
    return jsonb_build_object(
      'ok', false,
      'code', 'OUTSIDE_GEOFENCE',
      'can_request_exception', false,
      'work_date', work_day,
      'accuracy_m', p_accuracy_m,
      'distance_m', distance_value
    );
  end if;

  if p_event_type = 'clock_out'
     and not p_virtual_clock_in
     and not exists (
       select 1
       from public.attendance_events event
       where event.profile_id = actor_id
         and event.work_date = work_day
         and event.event_type = 'clock_in'
         and event.status in ('recorded', 'exception_approved')
     ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'CLOCK_IN_REQUIRED',
      'work_date', work_day,
      'accuracy_m', p_accuracy_m,
      'distance_m', distance_value
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'ATTENDANCE_VALIDATED',
    'work_date', work_day,
    'event_type', p_event_type,
    'is_workday', public.private_attendance_is_workday(work_day),
    'server_time', now(),
    'accuracy_m', p_accuracy_m,
    'distance_m', distance_value,
    'location_code', office.code
  );
end;
$$;

alter function public.private_validate_attendance_attempt(
  text,double precision,double precision,double precision,boolean,boolean
) owner to postgres;
revoke all on function public.private_validate_attendance_attempt(
  text,double precision,double precision,double precision,boolean,boolean
) from public, anon, authenticated;

comment on function public.private_validate_attendance_attempt(
  text,double precision,double precision,double precision,boolean,boolean
) is
  'Shared no-write validation for real employee attendance and operations-manager employee-app QA.';

create or replace function public.record_attendance_event(
  p_event_type text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  work_day date := (now() at time zone 'Asia/Seoul')::date;
  validation jsonb;
begin
  if actor_id is null or not public.current_profile_is_active() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if public.private_attendance_employee_uuid_for_profile(actor_id) is null then
    return jsonb_build_object('ok', false, 'code', 'ATTENDANCE_NOT_REQUIRED');
  end if;

  -- Preserve the established duplicate/idempotent response before preflight.
  if exists (
    select 1
    from public.attendance_events event
    where event.profile_id = actor_id
      and event.work_date = work_day
      and event.event_type = p_event_type
  ) then
    return public.private_record_attendance_event_pre149(
      p_event_type, p_latitude, p_longitude, p_accuracy_m
    );
  end if;

  validation := public.private_validate_attendance_attempt(
    p_event_type,
    p_latitude,
    p_longitude,
    p_accuracy_m,
    false,
    false
  );

  if not coalesce((validation ->> 'ok')::boolean, false) then
    return validation;
  end if;

  -- The pre-149 implementation remains the sole writer and repeats its existing
  -- server-side defenses before inserting the immutable raw attendance event.
  return public.private_record_attendance_event_pre149(
    p_event_type, p_latitude, p_longitude, p_accuracy_m
  );
end;
$$;

alter function public.record_attendance_event(
  text,double precision,double precision,double precision
) owner to postgres;
revoke all on function public.record_attendance_event(
  text,double precision,double precision,double precision
) from public, anon;
grant execute on function public.record_attendance_event(
  text,double precision,double precision,double precision
) to authenticated;

create or replace function public.qa_validate_attendance_event(
  p_event_type text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_has_qa_clock_in boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  validation jsonb;
begin
  if not public.private_actor_can('attendance.qa_validate') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  validation := public.private_validate_attendance_attempt(
    p_event_type,
    p_latitude,
    p_longitude,
    p_accuracy_m,
    coalesce(p_has_qa_clock_in, false),
    true
  );

  if not coalesce((validation ->> 'ok')::boolean, false) then
    return validation || jsonb_build_object('qa_mode', true, 'writes_attendance', false);
  end if;

  return validation || jsonb_build_object(
    'ok', true,
    'code', 'QA_ATTENDANCE_VALIDATED',
    'qa_mode', true,
    'writes_attendance', false
  );
end;
$$;

alter function public.qa_validate_attendance_event(
  text,double precision,double precision,double precision,boolean,boolean
) owner to postgres;
revoke all on function public.qa_validate_attendance_event(
  text,double precision,double precision,double precision,boolean,boolean
) from public, anon;
grant execute on function public.qa_validate_attendance_event(
  text,double precision,double precision,double precision,boolean,boolean
) to authenticated;

comment on function public.qa_validate_attendance_event(
  text,double precision,double precision,double precision,boolean,boolean
) is
  'Operations-manager employee-app QA: runs GPS/workday/geofence/server validation and returns only a result. It never writes attendance, corrections, confirmations, or payroll state.';

create or replace function public.private_create_attendance_correction_pre148(
  p_employee_uuid uuid,
  p_work_date date,
  p_event_type text,
  p_action text,
  p_corrected_event_at timestamptz default null,
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
  current_value jsonb;
  counterpart jsonb;
  previous_correction_id uuid;
  created public.attendance_corrections%rowtype;
  raw_event_id uuid;
  original_event_at timestamptz;
  missing_effective_time boolean := false;
  normalized_reason text;
begin
  if actor_id is null or not public.current_profile_is_active() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if p_work_date is null then
    return jsonb_build_object('ok', false, 'code', 'WORK_DATE_REQUIRED');
  end if;
  if p_event_type not in ('clock_in', 'clock_out') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_EVENT_TYPE');
  end if;
  if p_action not in ('set_time', 'invalidate') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CORRECTION_ACTION');
  end if;

  select * into employee_row
  from public.employees employee
  where employee.id = p_employee_uuid;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'EMPLOYEE_NOT_FOUND');
  end if;

  if not public.private_employee_is_attendance_subject(p_employee_uuid) then
    return jsonb_build_object('ok', false, 'code', 'ATTENDANCE_NOT_REQUIRED');
  end if;

  if p_work_date < employee_row.hired_on
     or (employee_row.departed_on is not null and p_work_date > employee_row.departed_on) then
    return jsonb_build_object('ok', false, 'code', 'OUTSIDE_EMPLOYMENT_PERIOD');
  end if;

  if p_action = 'set_time' then
    if p_corrected_event_at is null then
      return jsonb_build_object('ok', false, 'code', 'CORRECTED_TIME_REQUIRED');
    end if;
    if (p_corrected_event_at at time zone 'Asia/Seoul')::date <> p_work_date then
      return jsonb_build_object('ok', false, 'code', 'CORRECTED_TIME_DATE_MISMATCH');
    end if;
    if p_corrected_event_at > now() + interval '5 minutes' then
      return jsonb_build_object('ok', false, 'code', 'FUTURE_ATTENDANCE_TIME');
    end if;
  elsif p_corrected_event_at is not null then
    return jsonb_build_object('ok', false, 'code', 'INVALIDATED_TIME_MUST_BE_NULL');
  end if;

  current_value := public.private_attendance_effective_event(
    p_employee_uuid,
    p_work_date,
    p_event_type
  );
  missing_effective_time := current_value is null or current_value ->> 'event_at' is null;

  if p_action = 'set_time' and missing_effective_time then
    normalized_reason := coalesce(
      nullif(btrim(coalesce(p_reason, '')), ''),
      '누락 근태 수기 입력'
    );
  else
    normalized_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if normalized_reason is null
       or char_length(normalized_reason) < 5
       or char_length(normalized_reason) > 300 then
      return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
    end if;
  end if;

  if char_length(normalized_reason) < 5 or char_length(normalized_reason) > 300 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  if p_action = 'invalidate' and missing_effective_time then
    return jsonb_build_object('ok', false, 'code', 'NOTHING_TO_INVALIDATE');
  end if;

  if p_action = 'set_time' and p_event_type = 'clock_out' then
    counterpart := public.private_attendance_effective_event(p_employee_uuid, p_work_date, 'clock_in');
    if counterpart is null or counterpart ->> 'event_at' is null then
      return jsonb_build_object('ok', false, 'code', 'CLOCK_IN_REQUIRED');
    end if;
    if p_corrected_event_at < (counterpart ->> 'event_at')::timestamptz then
      return jsonb_build_object('ok', false, 'code', 'CLOCK_OUT_BEFORE_CLOCK_IN');
    end if;
  elsif p_action = 'set_time' and p_event_type = 'clock_in' then
    counterpart := public.private_attendance_effective_event(p_employee_uuid, p_work_date, 'clock_out');
    if counterpart is not null and counterpart ->> 'event_at' is not null
       and p_corrected_event_at > (counterpart ->> 'event_at')::timestamptz then
      return jsonb_build_object('ok', false, 'code', 'CLOCK_IN_AFTER_CLOCK_OUT');
    end if;
  elsif p_action = 'invalidate' and p_event_type = 'clock_in' then
    counterpart := public.private_attendance_effective_event(p_employee_uuid, p_work_date, 'clock_out');
    if counterpart is not null and counterpart ->> 'event_at' is not null then
      return jsonb_build_object('ok', false, 'code', 'CLOCK_OUT_EXISTS');
    end if;
  end if;

  select correction.id into previous_correction_id
  from public.attendance_corrections correction
  where correction.employee_uuid = p_employee_uuid
    and correction.work_date = p_work_date
    and correction.event_type = p_event_type
  order by correction.created_at desc, correction.id desc
  limit 1;

  if current_value ->> 'raw_event_id' is not null then
    raw_event_id := (current_value ->> 'raw_event_id')::uuid;
  end if;
  if current_value ->> 'event_at' is not null then
    original_event_at := (current_value ->> 'event_at')::timestamptz;
  end if;

  insert into public.attendance_corrections (
    employee_uuid,
    work_date,
    event_type,
    action,
    corrected_event_at,
    target_event_id,
    original_status,
    original_event_at,
    reason,
    supersedes_correction_id,
    created_by
  ) values (
    p_employee_uuid,
    p_work_date,
    p_event_type,
    p_action,
    case when p_action = 'set_time' then p_corrected_event_at else null end,
    raw_event_id,
    coalesce(current_value ->> 'status', 'missing'),
    original_event_at,
    normalized_reason,
    previous_correction_id,
    actor_id
  ) returning * into created;

  perform public.private_append_audit(
    actor_id,
    'attendance_correction_created',
    'attendance_correction',
    created.id::text,
    'success',
    case
      when p_action = 'set_time' and missing_effective_time then '누락 근태 수기 입력'
      else '근태 기록 보정'
    end,
    jsonb_build_object(
      'employee_uuid', p_employee_uuid,
      'work_date', p_work_date,
      'event_type', p_event_type,
      'action', p_action,
      'entry_mode', case
        when p_action = 'set_time' and missing_effective_time then 'manual_backfill'
        else 'correction'
      end,
      'target_event_id', raw_event_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'ATTENDANCE_CORRECTED',
    'mode', case
      when p_action = 'set_time' and missing_effective_time then 'manual_backfill'
      else 'correction'
    end,
    'correction_id', created.id,
    'effective', public.private_attendance_effective_event(p_employee_uuid, p_work_date, p_event_type)
  );
end;
$$;

alter function public.private_create_attendance_correction_pre148(
  uuid,date,text,text,timestamptz,text
) owner to postgres;
revoke all on function public.private_create_attendance_correction_pre148(
  uuid,date,text,text,timestamptz,text
) from public, anon, authenticated;

comment on function public.private_create_attendance_correction_pre148(
  uuid,date,text,text,timestamptz,text
) is
  'Goal #329: append-only attendance correction follows Employee.attendance_required eligibility without role/position exclusions.';

commit;
