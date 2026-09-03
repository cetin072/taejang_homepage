-- Taejang general-worker mobile attendance V1.
-- Staging-first. GPS is checked only when clock-in/out is requested.
-- Normal geofence: 60m around the Taejang office building.

begin;

create table public.attendance_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_m integer not null check (radius_m between 20 and 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.attendance_locations (code, name, latitude, longitude, radius_m)
values ('taejang_main', '태장 본사', 35.2476581, 128.61418, 60)
on conflict (code) do update
set name = excluded.name,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    radius_m = excluded.radius_m,
    active = true,
    updated_at = now();

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  work_date date not null,
  event_type text not null check (event_type in ('clock_in', 'clock_out')),
  status text not null check (status in ('recorded', 'exception_pending', 'exception_approved', 'exception_rejected')),
  event_at timestamptz,
  requested_at timestamptz not null default now(),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  accuracy_m double precision check (accuracy_m is null or accuracy_m between 0 and 5000),
  distance_m double precision check (distance_m is null or distance_m >= 0),
  location_id uuid references public.attendance_locations(id) on delete restrict,
  failure_code text,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, work_date, event_type)
);

create index attendance_events_date_status_idx
  on public.attendance_events (work_date, status, event_type);

alter table public.attendance_locations enable row level security;
alter table public.attendance_events enable row level security;
revoke all on public.attendance_locations from public, anon, authenticated;
revoke all on public.attendance_events from public, anon, authenticated;

create or replace function public.private_attendance_distance_m(
  p_lat1 double precision,
  p_lon1 double precision,
  p_lat2 double precision,
  p_lon2 double precision
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 6371000.0 * acos(
    least(1.0, greatest(-1.0,
      sin(radians(p_lat1)) * sin(radians(p_lat2))
      + cos(radians(p_lat1)) * cos(radians(p_lat2))
      * cos(radians(p_lon2 - p_lon1))
    ))
  );
$$;

create or replace function public.private_attendance_existing_result(
  p_event public.attendance_events
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', p_event.status in ('recorded', 'exception_approved'),
    'code', case p_event.status
      when 'recorded' then 'ALREADY_RECORDED'
      when 'exception_pending' then 'EXCEPTION_PENDING'
      when 'exception_approved' then 'EXCEPTION_APPROVED'
      else 'EXCEPTION_REJECTED'
    end,
    'status', p_event.status,
    'event_type', p_event.event_type,
    'event_at', p_event.event_at,
    'requested_at', p_event.requested_at
  );
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
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'work_date', work_day,
    'clock_in', (
      select jsonb_build_object(
        'id', e.id,
        'status', e.status,
        'event_at', e.event_at,
        'requested_at', e.requested_at
      ) from public.attendance_events e
      where e.profile_id = actor_id and e.work_date = work_day and e.event_type = 'clock_in'
    ),
    'clock_out', (
      select jsonb_build_object(
        'id', e.id,
        'status', e.status,
        'event_at', e.event_at,
        'requested_at', e.requested_at
      ) from public.attendance_events e
      where e.profile_id = actor_id and e.work_date = work_day and e.event_type = 'clock_out'
    )
  );
end;
$$;

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
    return public.private_attendance_existing_result(existing);
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

  -- High reported uncertainty never becomes an automatic attendance record.
  if p_accuracy_m > 80 then
    return jsonb_build_object(
      'ok', false,
      'code', 'LOCATION_UNCERTAIN',
      'can_request_exception', true
    );
  end if;

  -- Accurate GPS outside the 60m office geofence is a hard failure. This stops
  -- early clock-in from a nearby road, cafe, parking approach, or home.
  if distance_value > office.radius_m then
    return jsonb_build_object(
      'ok', false,
      'code', 'OUTSIDE_GEOFENCE',
      'can_request_exception', false
    );
  end if;

  insert into public.attendance_events (
    profile_id, work_date, event_type, status, event_at, requested_at,
    latitude, longitude, accuracy_m, distance_m, location_id
  ) values (
    actor_id, work_day, p_event_type, 'recorded', now(), now(),
    p_latitude, p_longitude, p_accuracy_m, distance_value, office.id
  ) returning * into created;

  perform public.private_append_audit(
    actor_id,
    'attendance_recorded',
    'attendance_event',
    created.id::text,
    'success',
    case p_event_type when 'clock_in' then 'GPS 출근 기록' else 'GPS 퇴근 기록' end,
    jsonb_build_object('event_type', p_event_type, 'work_date', work_day)
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
  if p_event_type not in ('clock_in', 'clock_out') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_EVENT_TYPE');
  end if;
  if normalized_failure not in ('PERMISSION_DENIED', 'POSITION_UNAVAILABLE', 'TIMEOUT', 'LOCATION_UNCERTAIN') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_FAILURE_CODE');
  end if;

  select * into existing
  from public.attendance_events e
  where e.profile_id = actor_id and e.work_date = work_day and e.event_type = p_event_type;
  if found then
    return public.private_attendance_existing_result(existing);
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

  select * into office from public.attendance_locations l
  where l.code = 'taejang_main' and l.active limit 1;

  if p_latitude is not null and p_longitude is not null and office.id is not null then
    if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
      return jsonb_build_object('ok', false, 'code', 'INVALID_LOCATION');
    end if;
    distance_value := public.private_attendance_distance_m(
      p_latitude, p_longitude, office.latitude, office.longitude
    );
    -- Accurate GPS proving the user is outside the office cannot be converted
    -- into an exception request. Only genuinely uncertain/unavailable GPS can.
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
    actor_id,
    'attendance_exception_requested',
    'attendance_event',
    created.id::text,
    'success',
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

create or replace function public.get_attendance_admin_today(
  p_work_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_day date := coalesce(p_work_date, (now() at time zone 'Asia/Seoul')::date);
begin
  if not public.current_profile_is_active()
     or not (
       public.current_user_has_role('promotion_lead')
       or public.current_user_has_role('operations_manager')
     ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'work_date', target_day,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile_id', p.id,
        'display_name', p.display_name,
        'clock_in', case when cin.id is null then null else jsonb_build_object(
          'id', cin.id, 'status', cin.status, 'event_at', cin.event_at,
          'requested_at', cin.requested_at, 'accuracy_m', cin.accuracy_m,
          'distance_m', cin.distance_m, 'failure_code', cin.failure_code
        ) end,
        'clock_out', case when cout.id is null then null else jsonb_build_object(
          'id', cout.id, 'status', cout.status, 'event_at', cout.event_at,
          'requested_at', cout.requested_at, 'accuracy_m', cout.accuracy_m,
          'distance_m', cout.distance_m, 'failure_code', cout.failure_code
        ) end
      ) order by p.display_name)
      from public.profiles p
      join public.profile_roles pr on pr.profile_id = p.id
      join public.roles r on r.id = pr.role_id and r.code = 'general_worker' and r.active
      left join public.attendance_events cin
        on cin.profile_id = p.id and cin.work_date = target_day and cin.event_type = 'clock_in'
      left join public.attendance_events cout
        on cout.profile_id = p.id and cout.work_date = target_day and cout.event_type = 'clock_out'
      where p.account_status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.review_attendance_exception(
  p_event_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target public.attendance_events%rowtype;
  new_status text;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (
       public.current_user_has_role('promotion_lead')
       or public.current_user_has_role('operations_manager')
     ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into target
  from public.attendance_events e
  where e.id = p_event_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if target.status <> 'exception_pending' then
    return jsonb_build_object('ok', false, 'code', 'NOT_PENDING');
  end if;

  new_status := case when p_approve then 'exception_approved' else 'exception_rejected' end;
  update public.attendance_events
  set status = new_status,
      event_at = case when p_approve then requested_at else null end,
      reviewed_by = actor_id,
      reviewed_at = now(),
      updated_at = now()
  where id = p_event_id;

  perform public.private_append_audit(
    actor_id,
    'attendance_exception_reviewed',
    'attendance_event',
    p_event_id::text,
    'success',
    case when p_approve then '출퇴근 예외 승인' else '출퇴근 예외 반려' end,
    jsonb_build_object('approved', p_approve, 'event_type', target.event_type, 'work_date', target.work_date)
  );

  return jsonb_build_object('ok', true, 'code', case when p_approve then 'APPROVED' else 'REJECTED' end);
end;
$$;

-- Allow operations-manager signup approval to create a true general-worker account.
create or replace function public.get_signup_approval_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'name', d.name) order by d.sort_order, d.name)
      from public.departments d where d.active
    ), '[]'::jsonb),
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name) order by p.sort_order, p.name)
      from public.positions p where p.active
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name) order by
        case r.code when 'general_worker' then 0 when 'promotion_staff' then 1 else 2 end)
      from public.roles r
      where r.active and r.code in ('general_worker', 'promotion_staff', 'promotion_lead')
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.approve_signup_request(
  p_target_profile_id uuid,
  p_department_id uuid,
  p_position_id uuid,
  p_role_code text,
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_profile public.profiles%rowtype;
  target_role_id uuid;
  normalized_role text := nullif(trim(p_role_code), '');
begin
  if actor_id is null or not public.current_user_has_role('operations_manager') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if normalized_role not in ('general_worker', 'promotion_staff', 'promotion_lead') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ROLE');
  end if;

  select * into target_profile from public.profiles
  where id = p_target_profile_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND'); end if;
  if target_profile.account_status <> 'pending' then return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_PENDING'); end if;
  if p_department_id is null or not exists (select 1 from public.departments where id = p_department_id and active) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DEPARTMENT');
  end if;
  if p_position_id is null or not exists (select 1 from public.positions where id = p_position_id and active) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_POSITION');
  end if;

  select role.id into target_role_id from public.roles role
  where role.code = normalized_role and role.active;
  if target_role_id is null then return jsonb_build_object('ok', false, 'code', 'ROLE_NOT_AVAILABLE'); end if;

  update public.profiles
  set account_status = 'active', department_id = p_department_id, position_id = p_position_id,
      approved_at = now(), approved_by = actor_id, status_changed_at = now(), status_changed_by = actor_id,
      status_reason = left(coalesce(nullif(trim(p_reason_summary), ''), '가입 승인'), 300), updated_at = now()
  where id = p_target_profile_id;

  insert into public.account_status_history (profile_id, previous_status, new_status, reason, changed_by)
  values (p_target_profile_id, 'pending', 'active', left(coalesce(nullif(trim(p_reason_summary), ''), '가입 승인'), 300), actor_id);

  insert into public.profile_roles (profile_id, role_id, granted_by)
  values (p_target_profile_id, target_role_id, actor_id);

  perform public.private_append_audit(
    actor_id, 'operations_manager_account_approved', 'profile', p_target_profile_id::text, 'success',
    left(coalesce(nullif(trim(p_reason_summary), ''), '가입 승인'), 300),
    jsonb_build_object('role_code', normalized_role, 'department_id', p_department_id, 'position_id', p_position_id)
  );

  return jsonb_build_object('ok', true, 'code', 'ACCOUNT_APPROVED', 'role_code', normalized_role);
end;
$$;

revoke all on function public.private_attendance_distance_m(double precision,double precision,double precision,double precision) from public, anon, authenticated;
revoke all on function public.private_attendance_existing_result(public.attendance_events) from public, anon, authenticated;
revoke all on function public.get_my_attendance_today() from public, anon;
revoke all on function public.record_attendance_event(text,double precision,double precision,double precision) from public, anon;
revoke all on function public.request_attendance_exception(text,text,double precision,double precision,double precision) from public, anon;
revoke all on function public.get_attendance_admin_today(date) from public, anon;
revoke all on function public.review_attendance_exception(uuid,boolean) from public, anon;

grant execute on function public.get_my_attendance_today() to authenticated;
grant execute on function public.record_attendance_event(text,double precision,double precision,double precision) to authenticated;
grant execute on function public.request_attendance_exception(text,text,double precision,double precision,double precision) to authenticated;
grant execute on function public.get_attendance_admin_today(date) to authenticated;
grant execute on function public.review_attendance_exception(uuid,boolean) to authenticated;

commit;
