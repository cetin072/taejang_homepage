-- Goal #329 follow-up: operations-manager attendance QA must remain usable on
-- non-workdays while still reporting the real workday decision. Real attendance
-- continues to fail closed on non-workdays. Forward-only patch because the base
-- Goal #329 migration has already been applied to staging.

begin;

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
  is_workday boolean;
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

  is_workday := public.private_attendance_is_workday(work_day);
  if not is_workday and not coalesce(p_allow_non_workday, false) then
    return jsonb_build_object(
      'ok', false,
      'code', 'NON_WORKDAY',
      'work_date', work_day,
      'is_workday', false
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
      'is_workday', is_workday,
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
      'is_workday', is_workday,
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
      'is_workday', is_workday,
      'accuracy_m', p_accuracy_m,
      'distance_m', distance_value
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'ATTENDANCE_VALIDATED',
    'work_date', work_day,
    'event_type', p_event_type,
    'is_workday', is_workday,
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
  text,double precision,double precision,double precision,boolean
) owner to postgres;
revoke all on function public.qa_validate_attendance_event(
  text,double precision,double precision,double precision,boolean
) from public, anon;
grant execute on function public.qa_validate_attendance_event(
  text,double precision,double precision,double precision,boolean
) to authenticated;

comment on function public.private_validate_attendance_attempt(
  text,double precision,double precision,double precision,boolean,boolean
) is
  'Goal #329 shared attendance validation. Real recording fails on non-workdays; operations QA may continue while receiving the actual is_workday result.';

comment on function public.qa_validate_attendance_event(
  text,double precision,double precision,double precision,boolean
) is
  'Operations-manager employee-app QA. Runs GPS/workday/geofence/server validation on any day and never writes attendance, corrections, confirmations, or payroll state.';

drop function if exists public.private_validate_attendance_attempt(
  text,double precision,double precision,double precision,boolean
);

commit;
