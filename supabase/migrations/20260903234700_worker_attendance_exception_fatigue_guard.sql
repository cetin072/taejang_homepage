-- Reduce avoidable attendance-admin fatigue.
-- A worker cannot create an exception by intentionally denying location permission,
-- and accurate out-of-geofence locations can never become exception requests.

begin;

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
  actor_id uuid := (select auth.uid());
  work_day date := (now() at time zone 'Asia/Seoul')::date;
  office public.attendance_locations%rowtype;
  existing public.attendance_events%rowtype;
  distance_value double precision;
  created public.attendance_events%rowtype;
  normalized_failure text := upper(coalesce(nullif(trim(p_failure_code), ''), 'POSITION_UNAVAILABLE'));
begin
  if actor_id is null or not public.current_profile_is_active() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if not public.private_attendance_is_workday(work_day) then
    return jsonb_build_object('ok', false, 'code', 'NON_WORKDAY');
  end if;
  if p_event_type not in ('clock_in', 'clock_out') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_EVENT_TYPE');
  end if;
  if normalized_failure = 'PERMISSION_DENIED' then
    return jsonb_build_object('ok', false, 'code', 'LOCATION_PERMISSION_REQUIRED');
  end if;
  if normalized_failure not in ('POSITION_UNAVAILABLE', 'TIMEOUT', 'LOCATION_UNCERTAIN') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_FAILURE_CODE');
  end if;

  select * into existing
  from public.attendance_events e
  where e.profile_id = actor_id and e.work_date = work_day and e.event_type = p_event_type;
  if found then return public.private_attendance_existing_result(existing); end if;

  if p_event_type = 'clock_out' and not exists (
    select 1 from public.attendance_events e
    where e.profile_id = actor_id and e.work_date = work_day and e.event_type = 'clock_in'
      and e.status in ('recorded', 'exception_approved')
  ) then
    return jsonb_build_object('ok', false, 'code', 'CLOCK_IN_REQUIRED');
  end if;

  select * into office
  from public.attendance_locations l
  where l.code = 'taejang_main' and l.active
  limit 1;

  if p_latitude is not null and p_longitude is not null and office.id is not null then
    if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
      return jsonb_build_object('ok', false, 'code', 'INVALID_LOCATION');
    end if;
    distance_value := public.private_attendance_distance_m(
      p_latitude, p_longitude, office.latitude, office.longitude
    );
    if coalesce(p_accuracy_m, 0) <= 80 and distance_value > office.radius_m then
      return jsonb_build_object('ok', false, 'code', 'OUTSIDE_GEOFENCE_NO_EXCEPTION');
    end if;
  end if;

  insert into public.attendance_events (
    profile_id, work_date, event_type, status, requested_at,
    latitude, longitude, accuracy_m, distance_m, location_id, failure_code
  ) values (
    actor_id, work_day, p_event_type, 'exception_pending', now(),
    p_latitude, p_longitude, p_accuracy_m, distance_value, office.id, normalized_failure
  ) returning * into created;

  perform public.private_append_audit(
    actor_id, 'attendance_exception_requested', 'attendance_event', created.id::text, 'success',
    '출퇴근 GPS 예외 확인 요청',
    jsonb_build_object('event_type', p_event_type, 'work_date', work_day, 'failure_code', normalized_failure)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'EXCEPTION_REQUESTED',
    'status', 'exception_pending',
    'requested_at', created.requested_at
  );
exception
  when unique_violation then
    select * into existing
    from public.attendance_events e
    where e.profile_id = actor_id and e.work_date = work_day and e.event_type = p_event_type;
    return public.private_attendance_existing_result(existing);
end;
$$;

commit;
