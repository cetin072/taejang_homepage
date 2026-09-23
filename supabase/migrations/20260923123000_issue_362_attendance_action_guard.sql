-- Issue #362: keep the single attendance action simple while enforcing
-- the real employee clock-in opening time on the server. Clock-out remains
-- unrestricted by time so early leave can be recorded. Operations QA keeps
-- using the no-write validator without this real-recording time guard.

begin;

create or replace function public.private_attendance_clock_in_available(
  p_at timestamptz default now()
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone 'Asia/Seoul')::time >= time '06:00:00'
$$;

create or replace function public.private_attendance_clock_in_available_at(
  p_at timestamptz default now()
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (
    ((p_at at time zone 'Asia/Seoul')::date::timestamp + time '06:00:00')
    at time zone 'Asia/Seoul'
  )
$$;

alter function public.private_attendance_clock_in_available(timestamptz) owner to postgres;
alter function public.private_attendance_clock_in_available_at(timestamptz) owner to postgres;
revoke all on function public.private_attendance_clock_in_available(timestamptz)
  from public, anon, authenticated;
revoke all on function public.private_attendance_clock_in_available_at(timestamptz)
  from public, anon, authenticated;

create or replace function public.get_my_attendance_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  server_now timestamptz := now();
  work_day date := (server_now at time zone 'Asia/Seoul')::date;
  day_status jsonb;
  employee_uuid uuid;
  holiday_assigned boolean := false;
  effective_workday boolean := false;
  clock_in_available boolean := public.private_attendance_clock_in_available(server_now);
  clock_in_available_at timestamptz := public.private_attendance_clock_in_available_at(server_now);
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
      'server_time', server_now,
      'clock_in_available', clock_in_available,
      'clock_in_available_at', clock_in_available_at,
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
    'server_time', server_now,
    'clock_in_available', clock_in_available,
    'clock_in_available_at', clock_in_available_at,
    'clock_in', public.private_attendance_effective_event(employee_uuid, work_day, 'clock_in'),
    'clock_out', public.private_attendance_effective_event(employee_uuid, work_day, 'clock_out')
  );
end;
$$;

alter function public.get_my_attendance_today() owner to postgres;
revoke all on function public.get_my_attendance_today() from public, anon;
grant execute on function public.get_my_attendance_today() to authenticated;

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
  server_now timestamptz := now();
  work_day date := (server_now at time zone 'Asia/Seoul')::date;
  validation jsonb;
begin
  if actor_id is null or not public.current_profile_is_active() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if public.private_attendance_employee_uuid_for_profile(actor_id) is null then
    return jsonb_build_object('ok', false, 'code', 'ATTENDANCE_NOT_REQUIRED');
  end if;

  -- Preserve the existing idempotent result even if an older/historical record
  -- exists before the newly introduced opening time.
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

  -- A non-workday still reports NON_WORKDAY through the existing validator.
  -- Explicit holiday-work assignment makes private_attendance_is_workday true.
  if p_event_type = 'clock_in'
     and public.private_attendance_is_workday(work_day)
     and not public.private_attendance_clock_in_available(server_now) then
    return jsonb_build_object(
      'ok', false,
      'code', 'CLOCK_IN_TOO_EARLY',
      'work_date', work_day,
      'server_time', server_now,
      'clock_in_available_at', public.private_attendance_clock_in_available_at(server_now)
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

create or replace function public.request_attendance_exception(
  p_event_type text,
  p_failure_code text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_m double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  server_now timestamptz := now();
  work_day date := (server_now at time zone 'Asia/Seoul')::date;
begin
  if actor_id is null or not public.current_profile_is_active() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if public.private_attendance_employee_uuid_for_profile(actor_id) is null then
    return jsonb_build_object('ok', false, 'code', 'ATTENDANCE_NOT_REQUIRED');
  end if;

  if exists (
    select 1
    from public.attendance_events event
    where event.profile_id = actor_id
      and event.work_date = work_day
      and event.event_type = p_event_type
  ) then
    return public.private_request_attendance_exception_pre149(
      p_event_type, p_failure_code, p_latitude, p_longitude, p_accuracy_m
    );
  end if;

  if p_event_type = 'clock_in'
     and public.private_attendance_is_workday(work_day)
     and not public.private_attendance_clock_in_available(server_now) then
    return jsonb_build_object(
      'ok', false,
      'code', 'CLOCK_IN_TOO_EARLY',
      'work_date', work_day,
      'server_time', server_now,
      'clock_in_available_at', public.private_attendance_clock_in_available_at(server_now)
    );
  end if;

  return public.private_request_attendance_exception_pre149(
    p_event_type, p_failure_code, p_latitude, p_longitude, p_accuracy_m
  );
end;
$$;

alter function public.request_attendance_exception(
  text,text,double precision,double precision,double precision
) owner to postgres;
revoke all on function public.request_attendance_exception(
  text,text,double precision,double precision,double precision
) from public, anon;
grant execute on function public.request_attendance_exception(
  text,text,double precision,double precision,double precision
) to authenticated;

comment on function public.private_attendance_clock_in_available(timestamptz) is
  'Issue #362 server-authoritative employee clock-in opening rule: Asia/Seoul 06:00 or later.';
comment on function public.private_attendance_clock_in_available_at(timestamptz) is
  'Issue #362 returns the current Korean work date 06:00 boundary as timestamptz.';

commit;
