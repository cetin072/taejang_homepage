-- If a manager rejects an exception request, the worker still needs to be able to
-- clock in/out later with a valid GPS position on the same workday.

begin;

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
  actor_id uuid := (select auth.uid());
  work_day date := (now() at time zone 'Asia/Seoul')::date;
  office public.attendance_locations%rowtype;
  existing public.attendance_events%rowtype;
  distance_value double precision;
  created public.attendance_events%rowtype;
  reuse_rejected boolean := false;
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
  if p_latitude is null or p_latitude not between -90 and 90
     or p_longitude is null or p_longitude not between -180 and 180
     or p_accuracy_m is null or p_accuracy_m < 0 or p_accuracy_m > 5000 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_LOCATION');
  end if;

  select * into existing
  from public.attendance_events e
  where e.profile_id = actor_id and e.work_date = work_day and e.event_type = p_event_type;
  if found then
    if existing.status <> 'exception_rejected' then
      return public.private_attendance_existing_result(existing);
    end if;
    reuse_rejected := true;
  end if;

  if p_event_type = 'clock_out' and not exists (
    select 1 from public.attendance_events e
    where e.profile_id = actor_id
      and e.work_date = work_day
      and e.event_type = 'clock_in'
      and e.status in ('recorded', 'exception_approved')
  ) then
    return jsonb_build_object('ok', false, 'code', 'CLOCK_IN_REQUIRED');
  end if;

  select * into office
  from public.attendance_locations l
  where l.code = 'taejang_main' and l.active
  limit 1;
  if office.id is null then
    return jsonb_build_object('ok', false, 'code', 'ATTENDANCE_LOCATION_UNAVAILABLE');
  end if;

  distance_value := public.private_attendance_distance_m(
    p_latitude, p_longitude, office.latitude, office.longitude
  );
  if p_accuracy_m > 80 then
    return jsonb_build_object('ok', false, 'code', 'LOCATION_UNCERTAIN', 'can_request_exception', true);
  end if;
  if distance_value > office.radius_m then
    return jsonb_build_object('ok', false, 'code', 'OUTSIDE_GEOFENCE', 'can_request_exception', false);
  end if;

  if reuse_rejected then
    update public.attendance_events
    set status = 'recorded',
        event_at = now(),
        requested_at = now(),
        latitude = p_latitude,
        longitude = p_longitude,
        accuracy_m = p_accuracy_m,
        distance_m = distance_value,
        location_id = office.id,
        failure_code = null,
        reviewed_by = null,
        reviewed_at = null,
        updated_at = now()
    where id = existing.id
    returning * into created;
  else
    insert into public.attendance_events (
      profile_id, work_date, event_type, status, event_at, requested_at,
      latitude, longitude, accuracy_m, distance_m, location_id
    ) values (
      actor_id, work_day, p_event_type, 'recorded', now(), now(),
      p_latitude, p_longitude, p_accuracy_m, distance_value, office.id
    ) returning * into created;
  end if;

  perform public.private_append_audit(
    actor_id, 'attendance_recorded', 'attendance_event', created.id::text, 'success',
    case p_event_type when 'clock_in' then 'GPS 출근 기록' else 'GPS 퇴근 기록' end,
    jsonb_build_object('event_type', p_event_type, 'work_date', work_day, 'after_rejected_exception', reuse_rejected)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'ATTENDANCE_RECORDED',
    'event_type', p_event_type,
    'status', created.status,
    'event_at', created.event_at
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
