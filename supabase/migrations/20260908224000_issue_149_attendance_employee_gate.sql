-- Issue #149 attendance integrity, phase 1.
-- Keep the established GPS/server-time/non-workday behavior while making
-- Employee.attendance_required the source of truth for attendance subjects.

begin;

create or replace function public.private_attendance_employee_uuid_for_profile(
  p_profile_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.account_person_links apl
  join public.employees e on e.person_id = apl.person_id
  where apl.profile_id = p_profile_id
    and apl.revoked_at is null
    and e.archived_at is null
    and e.employment_status = 'active'
    and e.attendance_required
  order by apl.linked_at desc
  limit 1
$$;

revoke all on function public.private_attendance_employee_uuid_for_profile(uuid)
  from public, anon, authenticated;

-- Preserve the latest accumulated attendance behavior (60m geofence, server time,
-- non-workday guard, exception-fatigue guard, rejected-request retry) behind a
-- private implementation name. The public wrapper below only adds Employee gating.
alter function public.record_attendance_event(text,double precision,double precision,double precision)
  rename to private_record_attendance_event_pre149;
alter function public.request_attendance_exception(text,text,double precision,double precision,double precision)
  rename to private_request_attendance_exception_pre149;

revoke all on function public.private_record_attendance_event_pre149(text,double precision,double precision,double precision)
  from public, anon, authenticated;
revoke all on function public.private_request_attendance_exception_pre149(text,text,double precision,double precision,double precision)
  from public, anon, authenticated;

create function public.record_attendance_event(
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
begin
  if actor_id is null or not public.current_profile_is_active() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if public.private_attendance_employee_uuid_for_profile(actor_id) is null then
    return jsonb_build_object('ok', false, 'code', 'ATTENDANCE_NOT_REQUIRED');
  end if;

  return public.private_record_attendance_event_pre149(
    p_event_type, p_latitude, p_longitude, p_accuracy_m
  );
end;
$$;

create function public.request_attendance_exception(
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
begin
  if actor_id is null or not public.current_profile_is_active() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if public.private_attendance_employee_uuid_for_profile(actor_id) is null then
    return jsonb_build_object('ok', false, 'code', 'ATTENDANCE_NOT_REQUIRED');
  end if;

  return public.private_request_attendance_exception_pre149(
    p_event_type, p_failure_code, p_latitude, p_longitude, p_accuracy_m
  );
end;
$$;

revoke all on function public.record_attendance_event(text,double precision,double precision,double precision)
  from public, anon;
revoke all on function public.request_attendance_exception(text,text,double precision,double precision,double precision)
  from public, anon;
grant execute on function public.record_attendance_event(text,double precision,double precision,double precision)
  to authenticated;
grant execute on function public.request_attendance_exception(text,text,double precision,double precision,double precision)
  to authenticated;

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
  employee_uuid uuid;
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
      'day_reason', '근태 기록 대상 아님',
      'clock_in', null,
      'clock_out', null
    );
  end if;

  return jsonb_build_object(
    'work_date', work_day,
    'employee_uuid', employee_uuid,
    'attendance_required', true,
    'is_workday', day_status -> 'is_workday',
    'day_reason', day_status ->> 'reason',
    'clock_in', (
      select jsonb_build_object(
        'id', e.id, 'status', e.status, 'event_at', e.event_at,
        'requested_at', e.requested_at
      )
      from public.attendance_events e
      where e.profile_id = actor_id
        and e.work_date = work_day
        and e.event_type = 'clock_in'
    ),
    'clock_out', (
      select jsonb_build_object(
        'id', e.id, 'status', e.status, 'event_at', e.event_at,
        'requested_at', e.requested_at
      )
      from public.attendance_events e
      where e.profile_id = actor_id
        and e.work_date = work_day
        and e.event_type = 'clock_out'
    )
  );
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
        'employee_uuid', e.id,
        'employee_id', e.employee_id,
        'profile_id', p.id,
        'display_name', person.full_name,
        'account_linked', apl.profile_id is not null,
        'account_active', coalesce(p.account_status = 'active', false),
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
      ) order by person.full_name, e.employee_id)
      from public.employees e
      join public.people person on person.id = e.person_id
      left join public.account_person_links apl
        on apl.person_id = e.person_id
       and apl.revoked_at is null
      left join public.profiles p on p.id = apl.profile_id
      left join public.attendance_events cin
        on cin.profile_id = p.id
       and cin.work_date = target_day
       and cin.event_type = 'clock_in'
      left join public.attendance_events cout
        on cout.profile_id = p.id
       and cout.work_date = target_day
       and cout.event_type = 'clock_out'
      where e.archived_at is null
        and e.employment_status = 'active'
        and e.attendance_required
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

  if target.profile_id = actor_id then
    perform public.private_append_audit(
      actor_id,
      'attendance_exception_self_review_denied',
      'attendance_event',
      p_event_id::text,
      'denied',
      '본인 출퇴근 예외는 본인이 승인하거나 반려할 수 없음',
      jsonb_build_object('approved', p_approve, 'event_type', target.event_type, 'work_date', target.work_date)
    );
    return jsonb_build_object('ok', false, 'code', 'SELF_REVIEW_FORBIDDEN');
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

  return jsonb_build_object(
    'ok', true,
    'code', case when p_approve then 'APPROVED' else 'REJECTED' end
  );
end;
$$;

revoke all on function public.get_my_attendance_today() from public, anon;
revoke all on function public.get_attendance_admin_today(date) from public, anon;
revoke all on function public.review_attendance_exception(uuid,boolean) from public, anon;
grant execute on function public.get_my_attendance_today() to authenticated;
grant execute on function public.get_attendance_admin_today(date) to authenticated;
grant execute on function public.review_attendance_exception(uuid,boolean) to authenticated;

commit;
