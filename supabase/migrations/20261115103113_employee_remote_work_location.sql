-- A self-reported address becomes a GPS worksite only after operations approval.
create table public.employee_remote_work_locations (
  employee_uuid uuid primary key references public.employees(id),
  address text not null check (char_length(address) between 5 and 200),
  location_id uuid unique references public.attendance_locations(id),
  revision uuid not null default gen_random_uuid()
);
alter table public.employee_remote_work_locations enable row level security;
revoke all on public.employee_remote_work_locations from public, anon, authenticated;

create function public.get_my_employee_remote_work_location()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare employee uuid := public.private_leave_employee();
begin
  if employee is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_build_object('address', remote.address, 'approved', location.active is true)
    from public.employee_remote_work_locations remote
    left join public.attendance_locations location on location.id = remote.location_id
    where remote.employee_uuid = employee
  ), jsonb_build_object('address', '', 'approved', false));
end;
$$;

create function public.save_my_employee_remote_work_address(p_address text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  employee uuid := public.private_leave_employee();
  address_text text := btrim(p_address);
  previous public.employee_remote_work_locations;
begin
  if employee is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if address_text is null or char_length(address_text) not between 5 and 200 then
    raise exception 'INVALID_ADDRESS' using errcode = '22023';
  end if;
  perform 1 from public.employees where id = employee for update;
  select * into previous from public.employee_remote_work_locations where employee_uuid = employee;
  if previous.address is not distinct from address_text then
    return public.get_my_employee_remote_work_location();
  end if;
  update public.attendance_locations set active = false, updated_at = now() where id = previous.location_id;
  insert into public.employee_remote_work_locations(employee_uuid, address)
  values (employee, address_text)
  on conflict (employee_uuid) do update set address = excluded.address, location_id = null, revision = gen_random_uuid();
  perform public.private_append_audit(auth.uid(), 'employee_remote_address_submitted', 'employee', employee::text, 'success',
    '직원이 재택근무 주소를 등록했습니다.', '{}'::jsonb);
  return jsonb_build_object('address', address_text, 'approved', false);
end;
$$;

create function public.get_employee_remote_work_location(p_employee_uuid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.current_user_has_role('operations_manager') and public.private_actor_can('employee.work_terms_manage')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_build_object('address', remote.address, 'revision', remote.revision,
      'approved', location.active is true)
    from public.employee_remote_work_locations remote
    left join public.attendance_locations location on location.id = remote.location_id
    join public.employees employee on employee.id = remote.employee_uuid and employee.archived_at is null
    where remote.employee_uuid = p_employee_uuid
  ), jsonb_build_object('address', '', 'approved', false));
end;
$$;

create function public.set_employee_remote_work_location(
  p_employee_uuid uuid, p_revision uuid, p_enabled boolean,
  p_latitude double precision default null, p_longitude double precision default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  previous public.employee_remote_work_locations;
  new_location uuid;
  default_radius integer;
begin
  if not (public.current_user_has_role('operations_manager') and public.private_actor_can('employee.work_terms_manage')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  perform 1 from public.employees where id = p_employee_uuid and archived_at is null for update;
  if not found then raise exception 'EMPLOYEE_NOT_FOUND'; end if;
  select * into previous from public.employee_remote_work_locations where employee_uuid = p_employee_uuid;
  if p_revision is null or previous.revision is distinct from p_revision then
    raise exception 'REMOTE_ADDRESS_CHANGED';
  end if;
  if p_enabled is null then raise exception 'INVALID_REMOTE_LOCATION'; end if;
  if p_enabled then
    if not public.private_employee_is_attendance_subject(p_employee_uuid)
       or p_latitude is null or p_latitude not between -90 and 90
       or p_longitude is null or p_longitude not between -180 and 180 then
      raise exception 'INVALID_REMOTE_LOCATION';
    end if;
    select radius_m into default_radius from public.attendance_locations where code = 'taejang_main' and active;
    if default_radius is null then raise exception 'ATTENDANCE_LOCATION_UNAVAILABLE'; end if;
    insert into public.attendance_locations(code, name, latitude, longitude, radius_m)
    values ('remote_work_' || replace(gen_random_uuid()::text, '-', ''), '재택근무', p_latitude, p_longitude, default_radius)
    returning id into new_location;
  end if;
  update public.attendance_locations set active = false, updated_at = now() where id = previous.location_id;
  update public.employee_remote_work_locations set location_id = new_location, revision = gen_random_uuid()
  where employee_uuid = p_employee_uuid;
  perform public.private_append_audit(auth.uid(), 'employee_remote_work_changed', 'employee', p_employee_uuid::text, 'success',
    '운영총괄이 재택 GPS 사용 여부를 변경했습니다.', jsonb_build_object('enabled', p_enabled, 'location_id', new_location));
  return public.get_employee_remote_work_location(p_employee_uuid);
end;
$$;

revoke all on function public.get_my_employee_remote_work_location(),
  public.save_my_employee_remote_work_address(text), public.get_employee_remote_work_location(uuid),
  public.set_employee_remote_work_location(uuid, uuid, boolean, double precision, double precision)
from public, anon, authenticated;
grant execute on function public.get_my_employee_remote_work_location(),
  public.save_my_employee_remote_work_address(text), public.get_employee_remote_work_location(uuid),
  public.set_employee_remote_work_location(uuid, uuid, boolean, double precision, double precision)
to authenticated;

create function public.private_attendance_location_for_attempt(
  p_profile_id uuid, p_latitude double precision, p_longitude double precision
)
returns public.attendance_locations language sql stable set search_path = '' as $$
  select location.*
  from public.attendance_locations location
  where location.active and (
    location.code = 'taejang_main'
    or (
      p_latitude is not null and p_longitude is not null
      and location.id = (
        select remote.location_id from public.employee_remote_work_locations remote
        where remote.employee_uuid = public.private_attendance_employee_uuid_for_profile(p_profile_id)
      )
      and public.private_attendance_distance_m(
        p_latitude, p_longitude, location.latitude, location.longitude
      ) <= location.radius_m
    )
  )
  order by (location.code = 'taejang_main' and coalesce(public.private_attendance_distance_m(
    p_latitude, p_longitude, location.latitude, location.longitude
  ) <= location.radius_m, false)) desc, (location.code = 'taejang_main')
  limit 1
$$;
revoke all on function public.private_attendance_location_for_attempt(uuid, double precision, double precision)
from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.private_record_attendance_event_pre149(p_event_type text, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  office := public.private_attendance_location_for_attempt(actor_id, p_latitude, p_longitude);
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
$function$;

CREATE OR REPLACE FUNCTION public.private_request_attendance_exception_pre149(p_event_type text, p_failure_code text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_accuracy_m double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  office := public.private_attendance_location_for_attempt(actor_id, p_latitude, p_longitude);

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
$function$;

CREATE OR REPLACE FUNCTION public.private_validate_attendance_attempt(p_event_type text, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision, p_virtual_clock_in boolean DEFAULT false, p_allow_non_workday boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  office := public.private_attendance_location_for_attempt(actor_id, p_latitude, p_longitude);

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
$function$;

CREATE OR REPLACE FUNCTION public.private_get_employee_leave_admin_context_pre_overrides572(p_employee_uuid uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare account_row record; begin
 if not public.private_leave_manager() and not public.private_actor_can('employee.work_terms_manage') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 for account_row in select employee_uuid from public.employee_leave_accounts where p_employee_uuid is null or employee_uuid=p_employee_uuid order by employee_uuid loop perform public.private_accrue_employee_leave(account_row.employee_uuid); end loop;
 return jsonb_build_object('server_today',(now() at time zone 'Asia/Seoul')::date,
 'can_initialize',public.private_actor_can('employee.work_terms_manage'),'can_review',public.private_leave_manager(),
 'employees',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'employee_id',e.employee_id,'name',p.full_name,
 'balance',public.private_employee_leave_balance(e.id),'monthly_enabled',a.monthly_enabled,
 'terms',coalesce((select jsonb_agg(to_jsonb(t) order by t.effective_from desc) from public.employee_work_terms t where t.employee_uuid=e.id),'[]'::jsonb)) order by e.employee_id)
 from public.employees e join public.people p on p.id=e.person_id left join public.employee_leave_accounts a on a.employee_uuid=e.id
 where e.archived_at is null and (p_employee_uuid is null or e.id=p_employee_uuid)),'[]'::jsonb),
 'requests',coalesce((select jsonb_agg(to_jsonb(q) order by q.work_date desc) from
 (select r.*,p.full_name as employee_name from public.employee_leave_requests r join public.employees e on e.id=r.employee_uuid join public.people p on p.id=e.person_id
 where p_employee_uuid is null or r.employee_uuid=p_employee_uuid order by r.work_date desc limit 300) q),'[]'::jsonb),
 'ledger',case when p_employee_uuid is not null then coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from
 (select * from public.employee_leave_ledger where employee_uuid=p_employee_uuid order by created_at desc limit 100) q),'[]'::jsonb) else '[]'::jsonb end,
 'days_off',coalesce((select jsonb_agg(to_jsonb(o) order by o.work_date desc) from public.employee_days_off o where revoked_at is null and work_date>=(now() at time zone 'Asia/Seoul')::date and (p_employee_uuid is null or o.employee_uuid is null or o.employee_uuid=p_employee_uuid)),'[]'::jsonb),
 'locations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.attendance_locations where active and not starts_with(code, 'remote_work_')),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.save_employee_work_override(p_employee_uuid uuid, p_values jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d date:=(p_values->>'effective_from')::date; saved uuid; begin
 if not public.private_actor_can('employee.work_terms_manage') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.employees where id=p_employee_uuid and archived_at is null for update;
 if not found then raise exception 'EMPLOYEE_NOT_FOUND'; end if;
 if d is null or d<(now() at time zone 'Asia/Seoul')::date then raise exception 'FUTURE_OR_TODAY_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:'||d::text,0));
 if public.private_attendance_day_is_confirmed(d) then raise exception 'DAY_CONFIRMED_REOPEN_REQUIRED'; end if;
 if (public.private_work_terms(p_employee_uuid,d)).id is null then raise exception 'BASE_WORK_TERMS_REQUIRED'; end if;
 if exists(select 1 from public.employee_leave_requests where employee_uuid=p_employee_uuid and work_date=d and status in ('pending','approved')) then raise exception 'LEAVE_SCHEDULE_CONFLICT'; end if;
 if public.private_attendance_effective_event(p_employee_uuid,d,'clock_in')->>'event_at' is not null then raise exception 'ATTENDANCE_CONFLICT'; end if;
 if not exists(select 1 from public.attendance_locations where id=(p_values->>'location_id')::uuid and active and not starts_with(code, 'remote_work_')) then raise exception 'LOCATION_REQUIRED'; end if;
 insert into public.employee_work_overrides(employee_uuid,effective_from,weekdays,starts_at,ends_at,break_starts_at,break_ends_at,location_id,reason,created_by)
 values(p_employee_uuid,d,array[extract(isodow from d)::int],(p_values->>'starts_at')::time,(p_values->>'ends_at')::time,
 nullif(p_values->>'break_starts_at','')::time,nullif(p_values->>'break_ends_at','')::time,(p_values->>'location_id')::uuid,p_values->>'reason',auth.uid()) returning id into saved;
 perform public.private_append_audit(auth.uid(),'employee_work_override_saved','employee',p_employee_uuid::text,'success',p_values->>'reason',jsonb_build_object('override_id',saved,'work_date',d));
 return jsonb_build_object('ok',true,'id',saved);
end $function$;

CREATE OR REPLACE FUNCTION public.save_employee_work_terms(p_employee_uuid uuid, p_values jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.employee_work_terms; d date; begin
 if auth.uid() is null or not public.private_actor_can('employee.work_terms_manage') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.employees where id=p_employee_uuid and archived_at is null for update;
 if not found then raise exception 'EMPLOYEE_NOT_FOUND'; end if;
 d:=(p_values->>'effective_from')::date;
 if d is null or d<(now() at time zone 'Asia/Seoul')::date then raise exception 'FUTURE_OR_TODAY_REQUIRED'; end if;
 if exists(select 1 from public.employee_leave_requests where employee_uuid=p_employee_uuid and status in ('pending','approved') and work_date>=d) then raise exception 'LEAVE_SCHEDULE_CONFLICT'; end if;
 if public.private_attendance_effective_event(p_employee_uuid,d,'clock_in')->>'event_at' is not null then raise exception 'ATTENDANCE_CONFLICT'; end if;
 if exists(select 1 from public.employee_work_terms where employee_uuid=p_employee_uuid and effective_from>=d) then raise exception 'APPEND_NEW_EFFECTIVE_DATE_REQUIRED'; end if;
 if not exists(select 1 from public.attendance_locations where id=(p_values->>'location_id')::uuid and active and not starts_with(code, 'remote_work_')) then raise exception 'LOCATION_REQUIRED'; end if;
 insert into public.employee_work_terms(employee_uuid,effective_from,weekdays,starts_at,ends_at,break_starts_at,break_ends_at,location_id,reason,created_by)
 values(p_employee_uuid,d,array(select jsonb_array_elements_text(p_values->'weekdays')::int),
 (p_values->>'starts_at')::time,(p_values->>'ends_at')::time,nullif(p_values->>'break_starts_at','')::time,nullif(p_values->>'break_ends_at','')::time,
 (p_values->>'location_id')::uuid,p_values->>'reason',auth.uid()) returning * into t;
 perform public.private_append_audit(auth.uid(),'employee_work_terms_saved','employee',p_employee_uuid::text,'success',t.reason,jsonb_build_object('term_id',t.id,'effective_from',d));
 return jsonb_build_object('ok',true,'id',t.id);
end $function$;
