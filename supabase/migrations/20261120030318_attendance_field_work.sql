begin;

create table private.attendance_field_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_uuid uuid not null references public.employees(id),
  work_date date not null,
  site text not null check (char_length(trim(site)) between 1 and 100),
  starts_at time not null,
  ends_at time not null check (ends_at > starts_at),
  field_clock_in boolean not null,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  unique (employee_uuid, work_date)
);
alter table private.attendance_field_assignments enable row level security;
revoke all on private.attendance_field_assignments from public, anon, authenticated;
alter table public.attendance_events add column field_assignment_id uuid references private.attendance_field_assignments(id);
create index attendance_field_assignments_date_idx on private.attendance_field_assignments(work_date);
create index attendance_events_field_assignment_idx on public.attendance_events(field_assignment_id)
  where field_assignment_id is not null;

create function private.field_attendance_window(p_assignment private.attendance_field_assignments, p_event text, p_now timestamptz)
returns boolean language sql immutable set search_path='' as $$
  select (p_now at time zone 'Asia/Seoul')::date = p_assignment.work_date
    and case p_event
      when 'clock_in' then p_assignment.field_clock_in and (p_now at time zone 'Asia/Seoul')
        between p_assignment.work_date + p_assignment.starts_at - interval '30 minutes'
        and p_assignment.work_date + p_assignment.ends_at
      when 'clock_out' then (p_now at time zone 'Asia/Seoul')
        between p_assignment.work_date + p_assignment.ends_at - interval '1 hour'
        and p_assignment.work_date + p_assignment.ends_at + interval '1 hour'
      else false end
$$;

create function private.field_attendance_workday(p_employee uuid,p_day date)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.employees where id=p_employee and archived_at is null and employment_status='active')
    and coalesce((public.private_employee_schedule(p_employee,p_day)->>'is_workday')::boolean, true)
    and not exists (select 1 from public.employee_days_off
      where work_date=p_day and revoked_at is null and (employee_uuid=p_employee or employee_uuid is null))
    and not exists (select 1 from public.employee_leave_requests
      where work_date=p_day and employee_uuid=p_employee and status='approved')
$$;

create function public.get_attendance_field_work(p_work_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if public.private_menu_denied('attendance.view') or not coalesce(public.private_actor_can('attendance.correct'),false) then
    raise exception using errcode='42501', message='FORBIDDEN';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object(
    'clock_in', cin.event_at, 'clock_out', cout.event_at,
    'late', cin.event_at is not null and (cin.event_at at time zone 'Asia/Seoul')::time > a.starts_at,
    'early_leave', cout.event_at is not null and (cout.event_at at time zone 'Asia/Seoul')::time < a.ends_at
  ) order by a.site,a.employee_uuid)
  from private.attendance_field_assignments a
  left join public.attendance_events cin on cin.field_assignment_id=a.id and cin.event_type='clock_in'
  left join public.attendance_events cout on cout.field_assignment_id=a.id and cout.event_type='clock_out'
  where a.work_date=p_work_date),'[]'::jsonb);
end $$;

create function public.manage_attendance_field_work(
  p_work_date date, p_employee_uuids uuid[], p_action text,
  p_site text default null, p_starts_at time default null, p_ends_at time default null,
  p_field_clock_in boolean default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if public.private_menu_denied('attendance.view') or not coalesce(public.private_actor_can('attendance.correct'),false) then
    raise exception using errcode='42501', message='FORBIDDEN';
  end if;
  if p_work_date is null or not isfinite(p_work_date)
    or coalesce(cardinality(p_employee_uuids),0) not between 1 and 500
    or array_position(p_employee_uuids,null) is not null
    or p_action is null or p_action not in ('save','remove','review') then
    raise exception 'FIELD_WORK_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:'||p_work_date::text,0));
  if public.private_attendance_day_is_confirmed(p_work_date) then raise exception 'DAY_ALREADY_CONFIRMED'; end if;
  if p_action='save' then
    if p_work_date < (now() at time zone 'Asia/Seoul')::date
      or coalesce(char_length(trim(p_site)),0) not between 1 and 100
      or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
      or p_field_clock_in is null then raise exception 'FIELD_WORK_INVALID'; end if;
    if exists(select 1 from unnest(p_employee_uuids) as target(id)
      where not coalesce(public.private_employee_is_attendance_subject_on(target.id,p_work_date),false)
        or not private.field_attendance_workday(target.id,p_work_date)) then
      raise exception 'FIELD_WORK_INELIGIBLE';
    end if;
  end if;
  if p_action in ('save','remove') then
    if exists(select 1 from private.attendance_field_assignments a
      join public.attendance_events e on e.field_assignment_id=a.id
      where a.work_date=p_work_date and a.employee_uuid=any(p_employee_uuids)) then
      raise exception 'FIELD_WORK_ALREADY_RECORDED';
    end if;
    if p_action='save' then
      insert into private.attendance_field_assignments(employee_uuid,work_date,site,starts_at,ends_at,field_clock_in)
      select distinct target,p_work_date,trim(p_site),p_starts_at,p_ends_at,p_field_clock_in
      from unnest(p_employee_uuids) target
      on conflict (employee_uuid,work_date) do update set
        site=excluded.site,starts_at=excluded.starts_at,ends_at=excluded.ends_at,field_clock_in=excluded.field_clock_in;
    else
      delete from private.attendance_field_assignments
        where work_date=p_work_date and employee_uuid=any(p_employee_uuids);
    end if;
  else
    if public.private_leave_employee()=any(p_employee_uuids) then raise exception 'SELF_APPROVAL_FORBIDDEN'; end if;
    if exists(select 1 from unnest(p_employee_uuids) as target(id)
      where not exists(select 1 from private.attendance_field_assignments a
        join public.attendance_events e on e.field_assignment_id=a.id
        where a.work_date=p_work_date and a.employee_uuid=target.id)
      or (public.private_attendance_effective_event(target.id,p_work_date,'clock_out')->>'event_at') is null
    ) then raise exception 'FIELD_WORK_INCOMPLETE'; end if;
    update private.attendance_field_assignments set reviewed_at=now(),reviewed_by=auth.uid()
      where work_date=p_work_date and employee_uuid=any(p_employee_uuids) and reviewed_at is null;
  end if;
  perform public.private_append_audit(auth.uid(),'attendance_field_'||p_action,'attendance_field_work',
    p_work_date::text,'success',null,jsonb_build_object('employee_uuids',p_employee_uuids));
end $$;

alter function public.get_my_attendance_today() rename to private_get_attendance_today_pre_field;
create function public.get_my_attendance_today()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  result jsonb := public.private_get_attendance_today_pre_field();
  assignment private.attendance_field_assignments;
begin
  if coalesce((result->>'attendance_required')::boolean,false) and coalesce((result->>'is_workday')::boolean,false) then
    select * into assignment from private.attendance_field_assignments
      where employee_uuid=public.private_attendance_employee_uuid_for_profile(auth.uid())
        and work_date=(now() at time zone 'Asia/Seoul')::date;
    if found
      and private.field_attendance_workday(assignment.employee_uuid,assignment.work_date) then
      result := result || jsonb_build_object('field_work',jsonb_build_object(
        'site',assignment.site,'clock_in',assignment.field_clock_in,'clock_out',true,
        'clock_out_opens_at',(assignment.work_date+assignment.ends_at-interval '1 hour') at time zone 'Asia/Seoul'));
      if assignment.field_clock_in then
        result := result || jsonb_build_object(
          'clock_in_available_at',(assignment.work_date+assignment.starts_at-interval '30 minutes') at time zone 'Asia/Seoul',
          'clock_in_available',(now() at time zone 'Asia/Seoul') >= assignment.work_date+assignment.starts_at-interval '30 minutes');
      end if;
    end if;
  end if;
  return result;
end $$;

alter function public.record_attendance_event(text,double precision,double precision,double precision)
  rename to private_record_attendance_pre_field;
create function public.record_attendance_event(
  p_event_type text,p_latitude double precision,p_longitude double precision,p_accuracy_m double precision
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  employee uuid := public.private_attendance_employee_uuid_for_profile(actor);
  work_day date := (now() at time zone 'Asia/Seoul')::date;
  assignment private.attendance_field_assignments;
  event public.attendance_events;
begin
  if employee is null or not public.current_profile_is_active() or p_event_type is null
    or p_event_type not in ('clock_in','clock_out') then
    return public.private_record_attendance_pre_field(p_event_type,p_latitude,p_longitude,p_accuracy_m);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:'||work_day::text,0));
  select * into assignment from private.attendance_field_assignments
    where employee_uuid=employee and work_date=work_day;
  if not found or (p_event_type='clock_in' and not assignment.field_clock_in) then
    return public.private_record_attendance_pre_field(p_event_type,p_latitude,p_longitude,p_accuracy_m);
  end if;

  select * into event from public.attendance_events
    where profile_id=actor and work_date=work_day and event_type=p_event_type;
  if event.id is not null and event.status <> 'exception_rejected' then
    return public.private_attendance_existing_result(event);
  end if;
  if public.private_attendance_day_is_confirmed(work_day) then
    return jsonb_build_object('ok',false,'code','DAY_ALREADY_CONFIRMED');
  end if;
  if not public.private_attendance_is_workday(work_day) or not private.field_attendance_workday(employee,work_day)
    or coalesce(public.private_attendance_effective_status(employee,work_day)->>'status','work') <> 'work' then
    return jsonb_build_object('ok',false,'code','NON_WORKDAY');
  end if;
  if not private.field_attendance_window(assignment,p_event_type,now()) then
    return jsonb_build_object('ok',false,'code','FIELD_WORK_OUTSIDE_WINDOW');
  end if;
  if p_event_type='clock_out' and
      (public.private_attendance_effective_event(employee,work_day,'clock_in')->>'event_at') is null then
    return jsonb_build_object('ok',false,'code','CLOCK_IN_REQUIRED');
  end if;

  insert into public.attendance_events as events(profile_id,work_date,event_type,status,event_at,field_assignment_id)
    values(actor,work_day,p_event_type,'recorded',now(),assignment.id)
    on conflict(profile_id,work_date,event_type) do update set
      status='recorded',event_at=excluded.event_at,requested_at=excluded.requested_at,
      updated_at=now(),field_assignment_id=excluded.field_assignment_id,
      latitude=null,longitude=null,accuracy_m=null,distance_m=null,location_id=null,
      failure_code=null,reviewed_by=null,reviewed_at=null,remote_work=false
    where events.status='exception_rejected' returning * into event;
  if not found then
    select * into event from public.attendance_events
      where profile_id=actor and work_date=work_day and event_type=p_event_type;
    return public.private_attendance_existing_result(event);
  end if;
  perform public.private_append_audit(actor,'attendance_recorded','attendance_event',event.id::text,'success',
    '현장근무 기록',jsonb_build_object('event_type',p_event_type,'work_date',work_day,'field_assignment_id',assignment.id));
  return jsonb_build_object('ok',true,'code','ATTENDANCE_RECORDED','event_type',p_event_type,
    'status',event.status,'event_at',event.event_at);
end $$;

alter function public.private_attendance_confirmation_blockers(date) rename to private_attendance_blockers_pre_field;
create function public.private_attendance_confirmation_blockers(p_work_date date)
returns jsonb language sql stable security definer set search_path='' as $$
  select public.private_attendance_blockers_pre_field(p_work_date) || coalesce((
    select jsonb_agg(jsonb_build_object('type','field_work_review','key',a.id,
      'employee_uuid',a.employee_uuid,'display_name',p.full_name,'message','현장 출퇴근 기록을 확인해 주세요.'))
    from private.attendance_field_assignments a
    join public.employees e on e.id=a.employee_uuid join public.people p on p.id=e.person_id
    where a.work_date=p_work_date and a.reviewed_at is null
      and exists(select 1 from public.attendance_events event where event.field_assignment_id=a.id)
  ),'[]'::jsonb)
$$;

revoke all on function private.field_attendance_window(private.attendance_field_assignments,text,timestamptz),
  private.field_attendance_workday(uuid,date), public.private_get_attendance_today_pre_field(),
  public.private_record_attendance_pre_field(text,double precision,double precision,double precision),
  public.private_attendance_blockers_pre_field(date), public.private_attendance_confirmation_blockers(date),
  public.get_my_attendance_today(), public.record_attendance_event(text,double precision,double precision,double precision),
  public.get_attendance_field_work(date),
  public.manage_attendance_field_work(date,uuid[],text,text,time,time,boolean) from public,anon,authenticated;
grant execute on function public.get_my_attendance_today(),
  public.record_attendance_event(text,double precision,double precision,double precision),
  public.get_attendance_field_work(date),
  public.manage_attendance_field_work(date,uuid[],text,text,time,time,boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
