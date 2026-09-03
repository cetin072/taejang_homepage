-- Attendance V1 non-workday guard.
-- Weekends are blocked by default. Company/public holidays are explicit overrides.
-- A non-workday cannot create normal GPS attendance or an exception request.

begin;

create table public.attendance_calendar_overrides (
  work_date date primary key,
  is_workday boolean not null,
  reason text not null check (char_length(reason) between 1 and 120),
  updated_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);

alter table public.attendance_calendar_overrides enable row level security;
revoke all on public.attendance_calendar_overrides from public, anon, authenticated;

-- Remaining official Korean public holidays in 2026 relevant after the V1 launch.
-- Weekend dates are blocked by the default weekend rule even when not listed here.
insert into public.attendance_calendar_overrides (work_date, is_workday, reason)
values
  ('2026-09-24', false, '추석 연휴'),
  ('2026-09-25', false, '추석'),
  ('2026-10-05', false, '개천절 대체공휴일'),
  ('2026-10-09', false, '한글날'),
  ('2026-12-25', false, '기독탄신일')
on conflict (work_date) do update
set is_workday = excluded.is_workday,
    reason = excluded.reason,
    updated_at = now();

create or replace function public.get_attendance_workday_status(p_work_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_day date := coalesce(p_work_date, (now() at time zone 'Asia/Seoul')::date);
  override_row public.attendance_calendar_overrides%rowtype;
  weekday_no integer := extract(isodow from target_day)::integer;
begin
  if not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select * into override_row
  from public.attendance_calendar_overrides c
  where c.work_date = target_day;

  if found then
    return jsonb_build_object(
      'work_date', target_day,
      'is_workday', override_row.is_workday,
      'reason', override_row.reason,
      'source', 'override'
    );
  end if;

  if weekday_no in (6, 7) then
    return jsonb_build_object(
      'work_date', target_day,
      'is_workday', false,
      'reason', case weekday_no when 6 then '토요일' else '일요일' end,
      'source', 'weekend'
    );
  end if;

  return jsonb_build_object(
    'work_date', target_day,
    'is_workday', true,
    'reason', '근무일',
    'source', 'default_weekday'
  );
end;
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
begin
  select c.is_workday into override_value
  from public.attendance_calendar_overrides c
  where c.work_date = p_work_date;

  if found then return override_value; end if;
  return extract(isodow from p_work_date)::integer not in (6, 7);
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
  actor_id uuid := (select auth.uid());
  work_day date := (now() at time zone 'Asia/Seoul')::date;
  day_status jsonb;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  day_status := public.get_attendance_workday_status(work_day);
  return jsonb_build_object(
    'work_date', work_day,
    'is_workday', day_status -> 'is_workday',
    'day_reason', day_status ->> 'reason',
    'clock_in', (
      select jsonb_build_object('id', e.id, 'status', e.status, 'event_at', e.event_at, 'requested_at', e.requested_at)
      from public.attendance_events e
      where e.profile_id = actor_id and e.work_date = work_day and e.event_type = 'clock_in'
    ),
    'clock_out', (
      select jsonb_build_object('id', e.id, 'status', e.status, 'event_at', e.event_at, 'requested_at', e.requested_at)
      from public.attendance_events e
      where e.profile_id = actor_id and e.work_date = work_day and e.event_type = 'clock_out'
    )
  );
end;
$$;

-- Wrap the attendance entry points so non-workdays are rejected before GPS or exception handling.
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

  select * into existing from public.attendance_events e
  where e.profile_id = actor_id and e.work_date = work_day and e.event_type = p_event_type;
  if found then return public.private_attendance_existing_result(existing); end if;

  if p_event_type = 'clock_out' and not exists (
    select 1 from public.attendance_events e
    where e.profile_id = actor_id and e.work_date = work_day and e.event_type = 'clock_in'
      and e.status in ('recorded', 'exception_approved')
  ) then
    return jsonb_build_object('ok', false, 'code', 'CLOCK_IN_REQUIRED');
  end if;

  select * into office from public.attendance_locations l
  where l.code = 'taejang_main' and l.active limit 1;
  if office.id is null then return jsonb_build_object('ok', false, 'code', 'ATTENDANCE_LOCATION_UNAVAILABLE'); end if;

  distance_value := public.private_attendance_distance_m(p_latitude, p_longitude, office.latitude, office.longitude);

  if p_accuracy_m > 80 then
    return jsonb_build_object('ok', false, 'code', 'LOCATION_UNCERTAIN', 'can_request_exception', true);
  end if;
  if distance_value > office.radius_m then
    return jsonb_build_object('ok', false, 'code', 'OUTSIDE_GEOFENCE', 'can_request_exception', false);
  end if;

  insert into public.attendance_events (
    profile_id, work_date, event_type, status, event_at, requested_at,
    latitude, longitude, accuracy_m, distance_m, location_id
  ) values (
    actor_id, work_day, p_event_type, 'recorded', now(), now(),
    p_latitude, p_longitude, p_accuracy_m, distance_value, office.id
  ) returning * into created;

  perform public.private_append_audit(
    actor_id, 'attendance_recorded', 'attendance_event', created.id::text, 'success',
    case p_event_type when 'clock_in' then 'GPS 출근 기록' else 'GPS 퇴근 기록' end,
    jsonb_build_object('event_type', p_event_type, 'work_date', work_day)
  );

  return jsonb_build_object('ok', true, 'code', 'ATTENDANCE_RECORDED', 'event_type', p_event_type, 'status', created.status, 'event_at', created.event_at);
exception
  when unique_violation then
    select * into existing from public.attendance_events e
    where e.profile_id = actor_id and e.work_date = work_day and e.event_type = p_event_type;
    return public.private_attendance_existing_result(existing);
end;
$$;

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
  if normalized_failure not in ('PERMISSION_DENIED', 'POSITION_UNAVAILABLE', 'TIMEOUT', 'LOCATION_UNCERTAIN') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_FAILURE_CODE');
  end if;

  select * into existing from public.attendance_events e
  where e.profile_id = actor_id and e.work_date = work_day and e.event_type = p_event_type;
  if found then return public.private_attendance_existing_result(existing); end if;

  if p_event_type = 'clock_out' and not exists (
    select 1 from public.attendance_events e
    where e.profile_id = actor_id and e.work_date = work_day and e.event_type = 'clock_in'
      and e.status in ('recorded', 'exception_approved')
  ) then
    return jsonb_build_object('ok', false, 'code', 'CLOCK_IN_REQUIRED');
  end if;

  select * into office from public.attendance_locations l
  where l.code = 'taejang_main' and l.active limit 1;

  if p_latitude is not null and p_longitude is not null and office.id is not null then
    if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
      return jsonb_build_object('ok', false, 'code', 'INVALID_LOCATION');
    end if;
    distance_value := public.private_attendance_distance_m(p_latitude, p_longitude, office.latitude, office.longitude);
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

  return jsonb_build_object('ok', true, 'code', 'EXCEPTION_REQUESTED', 'status', 'exception_pending', 'requested_at', created.requested_at);
exception
  when unique_violation then
    select * into existing from public.attendance_events e
    where e.profile_id = actor_id and e.work_date = work_day and e.event_type = p_event_type;
    return public.private_attendance_existing_result(existing);
end;
$$;

-- Future special-workday control. Intentionally operations-manager only; the attendance
-- lead can review attendance exceptions but cannot silently open a company holiday.
create or replace function public.set_attendance_workday_override(
  p_work_date date,
  p_is_workday boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_reason text := nullif(trim(p_reason), '');
begin
  if actor_id is null or not public.current_user_has_role('operations_manager') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_work_date is null or normalized_reason is null or char_length(normalized_reason) > 120 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  insert into public.attendance_calendar_overrides (work_date, is_workday, reason, updated_by, updated_at)
  values (p_work_date, p_is_workday, normalized_reason, actor_id, now())
  on conflict (work_date) do update
  set is_workday = excluded.is_workday,
      reason = excluded.reason,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

  perform public.private_append_audit(
    actor_id, 'attendance_calendar_override', 'attendance_date', p_work_date::text, 'success',
    normalized_reason, jsonb_build_object('is_workday', p_is_workday)
  );
  return jsonb_build_object('ok', true, 'code', 'CALENDAR_UPDATED');
end;
$$;

revoke all on function public.private_attendance_is_workday(date) from public, anon, authenticated;
revoke all on function public.get_attendance_workday_status(date) from public, anon;
revoke all on function public.set_attendance_workday_override(date,boolean,text) from public, anon;
grant execute on function public.get_attendance_workday_status(date) to authenticated;
grant execute on function public.set_attendance_workday_override(date,boolean,text) to authenticated;

commit;
