-- Approved policy: explicitly enabled remote staff may clock in/out without GPS.
-- Address remains private HR data; blank clears the address and disables remote work.
alter table public.employee_remote_work_locations add column remote_enabled boolean not null default false;
alter table public.employee_remote_work_locations drop constraint employee_remote_work_locations_address_check;
alter table public.employee_remote_work_locations add constraint employee_remote_work_locations_address_check
 check (address = '' or char_length(address) between 5 and 200);
alter table public.attendance_events add column remote_work boolean not null default false;

create function public.private_remote_attendance_enabled(p_profile_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.employee_remote_work_locations r
 join public.employees e on e.id=r.employee_uuid
 where r.employee_uuid=public.private_attendance_employee_uuid_for_profile(p_profile_id)
 and r.remote_enabled and e.archived_at is null and e.employment_status='active'
 and public.private_employee_is_attendance_subject(e.id));
$$;
revoke all on function public.private_remote_attendance_enabled(uuid) from public,anon,authenticated;
create or replace function public.get_my_employee_remote_work_location()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare employee uuid := public.private_leave_employee();
begin
  if employee is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_build_object('address', remote.address, 'remote_work', remote.remote_enabled, 'approved', (remote.remote_enabled or location.active is true))
    from public.employee_remote_work_locations remote
    left join public.attendance_locations location on location.id = remote.location_id
    where remote.employee_uuid = employee
  ), jsonb_build_object('address', '', 'approved', false));
end;
$$;

create or replace function public.get_employee_remote_work_location(p_employee_uuid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.current_user_has_role('operations_manager') and public.private_actor_can('employee.work_terms_manage')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_build_object('address', remote.address, 'revision', remote.revision,
      'remote_work', remote.remote_enabled, 'approved', (remote.remote_enabled or location.active is true))
    from public.employee_remote_work_locations remote
    left join public.attendance_locations location on location.id = remote.location_id
    join public.employees employee on employee.id = remote.employee_uuid and employee.archived_at is null
    where remote.employee_uuid = p_employee_uuid
  ), jsonb_build_object('address', '', 'approved', false));
end;
$$;

create or replace function public.save_my_employee_remote_work_address(p_address text)
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
  on conflict (employee_uuid) do update set address = excluded.address, location_id = null, remote_enabled = false, revision = gen_random_uuid();
  perform public.private_append_audit(auth.uid(), 'employee_remote_address_submitted', 'employee', employee::text, 'success',
    '직원이 재택근무 주소를 등록했습니다.', '{}'::jsonb);
  return jsonb_build_object('address', address_text, 'approved', false);
end;
$$;


create or replace function public.save_employee_basic_remote_address(
 p_employee_uuid uuid,p_revision uuid,p_address text,p_enabled boolean,
 p_latitude double precision default null,p_longitude double precision default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.employee_remote_work_locations; address_text text:=btrim(coalesce(p_address,''));
begin
 if not (public.current_user_has_role('operations_manager') and public.private_actor_can('employee.work_terms_manage')) then
  raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if (address_text<>'' and char_length(address_text) not between 5 and 200) or p_enabled is null then
  raise exception 'INVALID_ADDRESS' using errcode='22023'; end if;
 if p_enabled and address_text='' then raise exception 'REMOTE_ADDRESS_REQUIRED'; end if;
 perform 1 from public.employees where id=p_employee_uuid and archived_at is null for update;
 if not found then raise exception 'EMPLOYEE_NOT_FOUND'; end if;
 select * into previous from public.employee_remote_work_locations where employee_uuid=p_employee_uuid;
 if previous.revision is distinct from p_revision then
  if previous.address=address_text and previous.remote_enabled=p_enabled then return public.get_employee_remote_work_location(p_employee_uuid); end if;
  raise exception 'REMOTE_ADDRESS_CHANGED'; end if;
 if p_enabled and not public.private_employee_is_attendance_subject(p_employee_uuid) then raise exception 'INVALID_REMOTE_LOCATION'; end if;
 update public.attendance_locations set active=false,updated_at=now() where id=previous.location_id;
 insert into public.employee_remote_work_locations(employee_uuid,address,remote_enabled)
 values(p_employee_uuid,address_text,p_enabled)
 on conflict(employee_uuid) do update set address=excluded.address,remote_enabled=excluded.remote_enabled,location_id=null,revision=gen_random_uuid();
 perform public.private_append_audit(auth.uid(),'employee_remote_work_changed','employee',p_employee_uuid::text,'success',
  '기본 인사정보 주소와 재택근무 여부 변경',jsonb_build_object('enabled',p_enabled,'location_check_required',not p_enabled));
 return public.get_employee_remote_work_location(p_employee_uuid);
end $$;

create function public.update_employee_basic_with_remote(
 p_employee_uuid uuid,p_values jsonb,p_revision uuid,p_address text,p_enabled boolean,
 p_update_remote boolean default true,p_role_context jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; remote_result jsonb;
begin
 if not (public.current_user_has_role('operations_manager') and public.private_actor_can('employee.update'))
    or (p_update_remote and not public.private_actor_can('employee.work_terms_manage')) then
  raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_role_context is null then
  result:=public.update_employee_core(p_employee_uuid,p_values->>'full_name',(p_values->>'hired_on')::date,
   (p_values->>'department_id')::uuid,(p_values->>'position_id')::uuid,p_values->>'employment_status',
   nullif(p_values->>'departed_on','')::date,(p_values->>'attendance_required')::boolean,'직원 기본 인사정보 수정');
 else
  result:=public.update_employee_core_with_role(
   p_employee_uuid,(p_role_context->>'expected_updated_at')::timestamptz,
   (p_role_context->>'expected_profile_id')::uuid,(p_role_context->>'expected_profile_updated_at')::timestamptz,
   array(select jsonb_array_elements_text(p_role_context->'expected_role_codes')),
   p_values->>'full_name',(p_values->>'hired_on')::date,(p_values->>'department_id')::uuid,
   (p_values->>'position_id')::uuid,p_values->>'employment_status',nullif(p_values->>'departed_on','')::date,
   (p_values->>'attendance_required')::boolean,'직원 기본정보에서 직책·추천 역할 확인 후 저장',true);
 end if;
 if result->>'ok' is distinct from 'true' then
  raise exception using errcode='P0001',message=coalesce(result->>'code','EMPLOYEE_UPDATE_FAILED');
 end if;
 if p_update_remote then
  remote_result:=public.save_employee_basic_remote_address(p_employee_uuid,p_revision,p_address,p_enabled);
  return result||remote_result;
 end if;
 return result;
end $$;
revoke all on function public.update_employee_basic_with_remote(uuid,jsonb,uuid,text,boolean,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.update_employee_basic_with_remote(uuid,jsonb,uuid,text,boolean,boolean,jsonb) to authenticated;
CREATE OR REPLACE FUNCTION public.private_record_attendance_event_pre149(p_event_type text, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  remote_allowed boolean := public.private_remote_attendance_enabled(auth.uid());
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
  if not remote_allowed and (p_latitude is null or p_latitude not between -90 and 90
     or p_longitude is null or p_longitude not between -180 and 180
     or p_accuracy_m is null or p_accuracy_m < 0 or p_accuracy_m > 5000) then
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

  if not remote_allowed then
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

  else
    p_latitude:=null; p_longitude:=null; p_accuracy_m:=null;
  end if;

  if reuse_rejected then
    update public.attendance_events
    set status = 'recorded', remote_work = remote_allowed,
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
      latitude, longitude, accuracy_m, distance_m, location_id, remote_work
    ) values (
      actor_id, work_day, p_event_type, 'recorded', now(), now(),
      p_latitude, p_longitude, p_accuracy_m, distance_value, office.id, remote_allowed
    ) returning * into created;
  end if;

  perform public.private_append_audit(
    actor_id, 'attendance_recorded', 'attendance_event', created.id::text, 'success',
    case p_event_type when 'clock_in' then 'GPS 출근 기록' else 'GPS 퇴근 기록' end,
    jsonb_build_object('event_type', p_event_type, 'work_date', work_day, 'after_rejected_exception', reuse_rejected, 'remote_work', remote_allowed)
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
CREATE OR REPLACE FUNCTION public.private_validate_attendance_attempt(p_event_type text, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision, p_virtual_clock_in boolean DEFAULT false, p_allow_non_workday boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  remote_allowed boolean := public.private_remote_attendance_enabled(auth.uid());
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

  if not remote_allowed and (p_latitude is null or p_latitude not between -90 and 90
     or p_longitude is null or p_longitude not between -180 and 180
     or p_accuracy_m is null or p_accuracy_m < 0 or p_accuracy_m > 5000) then
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

  if not remote_allowed then
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

  else
    p_latitude:=null; p_longitude:=null; p_accuracy_m:=null;
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
create or replace function public.get_my_attendance_today() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b jsonb; e uuid; s jsonb; begin
 b:=public.private_get_my_attendance_today_pre572(); e:=public.private_leave_employee();
 if e is not null then
  s:=public.private_employee_schedule(e,(now() at time zone 'Asia/Seoul')::date);
  b:=b||jsonb_build_object('work_schedule',s);
  if (s->>'configured')::boolean and not (s->>'is_workday')::boolean then b:=b||jsonb_build_object('is_workday',false,'clock_in_available',false,'day_reason','승인 휴가 또는 지정 휴무'); end if;
 end if; return b||jsonb_build_object('remote_work',public.private_remote_attendance_enabled(auth.uid()));
end $$;
