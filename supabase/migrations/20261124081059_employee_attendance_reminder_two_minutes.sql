-- Employee-only push. The separate five-minute manager dashboard is unchanged.
-- Keep the existing database enable flag and Edge enable flag as-is. No cron or send.
begin;

update public.employee_reminder_policy set delay_minutes=2 where singleton;

create or replace function public.private_attendance_reminder_due(
 p_employee uuid,p_day date,p_event_type text default 'attendance.clock_in_missing',p_now timestamptz default now()
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare
 s jsonb; ev jsonb; clock_in jsonb; delay_minutes integer;
 shift_start timestamptz; shift_end timestamptz; field_shift private.attendance_field_assignments;
begin
 if p_event_type is null or p_event_type not in ('attendance.clock_in_missing','attendance.clock_out_missing')
  or p_now is null or p_day is distinct from (p_now at time zone 'Asia/Seoul')::date then return false; end if;
 select p.delay_minutes into delay_minutes from public.employee_reminder_policy p where p.singleton and p.enabled;
 if delay_minutes is null then return false; end if;
 if not exists(select 1 from public.employees where id=p_employee and archived_at is null and employment_status='active' and attendance_required)
  or not coalesce(public.private_employee_is_attendance_subject_on(p_employee,p_day),false)
  or public.private_attendance_day_is_confirmed(p_day) then return false; end if;
 s:=public.private_employee_schedule(p_employee,p_day);
 if not coalesce((s->>'configured')::boolean,false) or not coalesce((s->>'is_workday')::boolean,false) then return false; end if;
 if public.private_attendance_effective_status(p_employee,p_day)->>'status' is distinct from 'work' then return false; end if;
 shift_start:=(s->>'starts_at')::timestamptz;
 shift_end:=(s->>'ends_at')::timestamptz;
 if shift_start is null or shift_end is null or shift_end<=shift_start then return false; end if;
 select * into field_shift from private.attendance_field_assignments
  where employee_uuid=p_employee and work_date=p_day;
 if found then
  -- Match the app: field clock-in can be disabled while field clock-out is assigned.
  if not public.private_attendance_is_workday(p_day) or not private.field_attendance_workday(p_employee,p_day) then return false; end if;
  if field_shift.field_clock_in then shift_start:=(p_day+field_shift.starts_at) at time zone 'Asia/Seoul'; end if;
  if p_event_type='attendance.clock_out_missing' or field_shift.field_clock_in then
   shift_end:=(p_day+field_shift.ends_at) at time zone 'Asia/Seoul';
  end if;
 end if;
 if p_event_type='attendance.clock_out_missing' then
  if p_now<shift_end+make_interval(mins=>delay_minutes) then return false; end if;
  if field_shift.id is not null and not private.field_attendance_window(field_shift,'clock_out',p_now) then return false; end if;
  clock_in:=public.private_attendance_effective_event(p_employee,p_day,'clock_in');
  -- A worker cannot use clock-out without an actual effective clock-in.
  if clock_in->>'event_at' is null or coalesce(clock_in->>'status','') not in ('recorded','corrected','exception_approved') then return false; end if;
  ev:=public.private_attendance_effective_event(p_employee,p_day,'clock_out');
 else
  if p_now<shift_start+make_interval(mins=>delay_minutes) or p_now>=shift_end then return false; end if;
  ev:=public.private_attendance_effective_event(p_employee,p_day,'clock_in');
 end if;
 -- Any stored clock or pending attendance exception suppresses the push.
 return ev->>'event_at' is null and ev->>'status' is null;
end $$;

create or replace function public.private_claim_attendance_reminders(p_claim uuid,p_limit integer default 50) returns jsonb language plpgsql security definer set search_path='' as $$
declare emp_row record; target_event_id uuid; result jsonb; day date:=(now() at time zone 'Asia/Seoul')::date; begin
 if p_claim is null or p_limit is null or p_limit not between 1 and 100 then raise exception 'INVALID_CLAIM'; end if;
 if not exists(select 1 from public.employee_reminder_policy where singleton and enabled and delay_minutes is not null) then return '[]'::jsonb; end if;
 update public.notification_deliveries d set status='failed',last_error_code='SEND_CLAIM_EXPIRED_UNKNOWN',updated_at=now()
 from public.notification_events e where d.event_id=e.id and e.event_type in ('attendance.clock_in_missing','attendance.clock_out_missing') and d.status='sending' and d.claimed_at<now()-interval '5 minutes';
 for emp_row in select emp.id,k.event_type from public.employees emp cross join (values('attendance.clock_in_missing'),('attendance.clock_out_missing')) as k(event_type) where emp.archived_at is null and emp.employment_status='active' and emp.attendance_required order by emp.id,k.event_type loop
  if public.private_attendance_reminder_due(emp_row.id,day,emp_row.event_type) then
   insert into public.notification_events(event_key,event_type,employee_uuid,work_date,available_at,status,expanded_at)
    values('attendance:'||emp_row.event_type||':'||emp_row.id||':'||day,emp_row.event_type,emp_row.id,day,now(),'expanded',now())
    on conflict(event_key) do nothing;
   select id into target_event_id from public.notification_events where event_key='attendance:'||emp_row.event_type||':'||emp_row.id||':'||day and status='expanded' for update;
   -- Keep one delivery across concurrently running dispatchers and device changes.
   -- A past attempt on any device is not a reason to fan out to a second device.
   if target_event_id is not null and not exists(select 1 from public.notification_deliveries where event_id=target_event_id) then
    insert into public.notification_deliveries(event_id,device_id,profile_id)
    select target_event_id,d.id,d.profile_id from public.notification_devices d join public.profiles p on p.id=d.profile_id
     join public.account_person_links l on l.profile_id=d.profile_id and l.revoked_at is null
     join public.employees emp on emp.person_id=l.person_id and emp.id=emp_row.id
    where d.active and p.account_status='active'
    order by d.last_seen_at desc,d.id limit 1
    on conflict(event_id,device_id) do nothing;
   end if;
  end if;
 end loop;
 update public.notification_deliveries d set status='cancelled',last_error_code='ATTENDANCE_NO_LONGER_DUE',updated_at=now()
 from public.notification_events e where d.event_id=e.id and e.event_type in ('attendance.clock_in_missing','attendance.clock_out_missing')
 and d.status in ('queued','retry') and not public.private_attendance_reminder_due(e.employee_uuid,e.work_date,e.event_type);
 with candidates as (
  select d.id from public.notification_deliveries d join public.notification_events e on e.id=d.event_id
  join public.notification_devices dev on dev.id=d.device_id and dev.profile_id=d.profile_id join public.profiles p on p.id=d.profile_id
  join public.account_person_links l on l.profile_id=p.id and l.revoked_at is null
  join public.employees emp on emp.person_id=l.person_id and emp.id=e.employee_uuid
  where e.event_type in ('attendance.clock_in_missing','attendance.clock_out_missing') and e.status='expanded' and dev.active and p.account_status='active'
  and d.status in ('queued','retry') and d.next_attempt_at<=now() and public.private_attendance_reminder_due(e.employee_uuid,e.work_date,e.event_type)
  order by d.created_at for update of d skip locked limit p_limit
 ), claimed as (
  update public.notification_deliveries d set status='sending',claim_token=p_claim,claimed_at=now(),attempt_count=attempt_count+1,updated_at=now()
  from candidates c where c.id=d.id returning d.*
 ) select coalesce(jsonb_agg(jsonb_build_object('delivery_id',d.id,'expo_push_token',dev.push_token,
  'title',case when e.event_type='attendance.clock_out_missing' then '태장 퇴근 안내' else '태장 출근 안내' end,'body',case when e.event_type='attendance.clock_out_missing' then '퇴근을 눌러주세요.' else '출근을 눌러주세요.' end,'data',jsonb_build_object('target','attendance'))),'[]'::jsonb)
 into result from claimed d join public.notification_devices dev on dev.id=d.device_id join public.notification_events e on e.id=d.event_id;
 return result;
end $$;
create or replace function public.private_validate_attendance_reminder(p_id uuid,p_claim uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare valid boolean; begin
 select public.private_attendance_reminder_due(e.employee_uuid,e.work_date,e.event_type) and p.account_status='active' and dev.active and exists(
 select 1 from public.account_person_links l join public.employees emp on emp.person_id=l.person_id where l.profile_id=p.id and l.revoked_at is null and emp.id=e.employee_uuid)
 into valid from public.notification_deliveries d join public.notification_events e on e.id=d.event_id
 join public.profiles p on p.id=d.profile_id join public.notification_devices dev on dev.id=d.device_id and dev.profile_id=d.profile_id
 where d.id=p_id and d.claim_token=p_claim and d.status='sending' and e.event_type in ('attendance.clock_in_missing','attendance.clock_out_missing');
 if not coalesce(valid,false) then update public.notification_deliveries set status='cancelled',claim_token=null,claimed_at=null,last_error_code='ATTENDANCE_NO_LONGER_DUE' where id=p_id and claim_token=p_claim; end if;
 return coalesce(valid,false);
end $$;
-- CREATE OR REPLACE preserves the existing service-role-only RPC grants.
commit;
