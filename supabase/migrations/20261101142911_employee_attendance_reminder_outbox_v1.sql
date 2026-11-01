-- PR #572. Reuse existing device/delivery/ticket/receipt infrastructure.
-- Existing notice canary and its dispatcher are unchanged. No scheduler is activated.
begin;
alter table public.notification_events alter column notice_id drop not null;
alter table public.notification_events alter column notice_version drop not null;
alter table public.notification_events drop constraint notification_events_event_type_check;
alter table public.notification_events add column employee_uuid uuid references public.employees(id);
alter table public.notification_events add column work_date date;
alter table public.notification_events add constraint notification_events_event_type_check check(event_type in ('notice.published','attendance.clock_in_missing'));
alter table public.notification_events add constraint notification_events_subject_check check(
 (event_type='notice.published' and notice_id is not null and notice_version is not null and employee_uuid is null and work_date is null)
 or (event_type='attendance.clock_in_missing' and notice_id is null and notice_version is null and employee_uuid is not null and work_date is not null));
create unique index attendance_reminder_one_event on public.notification_events(employee_uuid,work_date) where event_type='attendance.clock_in_missing';

create function public.private_attendance_reminder_due(p_employee uuid,p_day date) returns boolean language plpgsql stable security definer set search_path='' as $$
declare s jsonb; policy public.employee_reminder_policy; ev jsonb; begin
 select * into policy from public.employee_reminder_policy where singleton;
 if not policy.enabled or policy.delay_minutes is null or p_day is distinct from (now() at time zone 'Asia/Seoul')::date then return false; end if;
 if not exists(select 1 from public.employees where id=p_employee and archived_at is null and employment_status='active' and attendance_required) then return false; end if;
 s:=public.private_employee_schedule(p_employee,p_day);
 if not coalesce((s->>'is_workday')::boolean,false) or now()<(s->>'starts_at')::timestamptz+make_interval(mins=>policy.delay_minutes) or now()>=(s->>'ends_at')::timestamptz then return false; end if;
 if public.private_attendance_effective_status(p_employee,p_day)->>'status' is distinct from 'work' then return false; end if;
 ev:=public.private_attendance_effective_event(p_employee,p_day,'clock_in');
 -- Pending/rejected exceptions also suppress reminders; no fatigue-inducing repeat requests.
 return ev->>'event_at' is null and ev->>'status' is null;
end $$;
create function public.private_claim_attendance_reminders(p_claim uuid,p_limit integer default 50) returns jsonb language plpgsql security definer set search_path='' as $$
declare emp_row record; target_event_id uuid; result jsonb; day date:=(now() at time zone 'Asia/Seoul')::date; begin
 if p_claim is null or p_limit is null or p_limit not between 1 and 100 then raise exception 'INVALID_CLAIM'; end if;
 if not exists(select 1 from public.employee_reminder_policy where singleton and enabled and delay_minutes is not null) then return '[]'::jsonb; end if;
 for emp_row in select id from public.employees where archived_at is null and employment_status='active' and attendance_required order by id loop
  if public.private_attendance_reminder_due(emp_row.id,day) then
   insert into public.notification_events(event_key,event_type,employee_uuid,work_date,available_at,status,expanded_at)
    values('attendance:'||emp_row.id||':'||day,'attendance.clock_in_missing',emp_row.id,day,now(),'expanded',now())
    on conflict(event_key) do nothing;
   select id into target_event_id from public.notification_events where event_key='attendance:'||emp_row.id||':'||day and status='expanded';
   if target_event_id is not null then
    insert into public.notification_deliveries(event_id,device_id,profile_id)
    select target_event_id,d.id,d.profile_id from public.notification_devices d join public.profiles p on p.id=d.profile_id
     join public.account_person_links l on l.profile_id=d.profile_id and l.revoked_at is null
     join public.employees emp on emp.person_id=l.person_id and emp.id=emp_row.id
    where d.active and p.account_status='active' on conflict(event_id,device_id) do nothing;
   end if;
  end if;
 end loop;
 update public.notification_deliveries d set status='cancelled',last_error_code='ATTENDANCE_NO_LONGER_DUE',updated_at=now()
 from public.notification_events e where d.event_id=e.id and e.event_type='attendance.clock_in_missing'
 and d.status in ('queued','retry') and not public.private_attendance_reminder_due(e.employee_uuid,e.work_date);
 with candidates as (
  select d.id from public.notification_deliveries d join public.notification_events e on e.id=d.event_id
  join public.notification_devices dev on dev.id=d.device_id join public.profiles p on p.id=d.profile_id
  join public.account_person_links l on l.profile_id=p.id and l.revoked_at is null
  join public.employees emp on emp.person_id=l.person_id and emp.id=e.employee_uuid
  where e.event_type='attendance.clock_in_missing' and e.status='expanded' and dev.active and p.account_status='active'
  and d.status in ('queued','retry') and d.next_attempt_at<=now() and public.private_attendance_reminder_due(e.employee_uuid,e.work_date)
  order by d.created_at for update of d skip locked limit p_limit
 ), claimed as (
  update public.notification_deliveries d set status='sending',claim_token=p_claim,claimed_at=now(),attempt_count=attempt_count+1,updated_at=now()
  from candidates c where c.id=d.id returning d.*
 ) select coalesce(jsonb_agg(jsonb_build_object('delivery_id',d.id,'expo_push_token',dev.push_token,
  'title','태장 출근 안내','body','출근 기록이 없습니다. 앱에서 출근 버튼을 눌러주세요.','data',jsonb_build_object('target','attendance'))),'[]'::jsonb)
 into result from claimed d join public.notification_devices dev on dev.id=d.device_id;
 return result;
end $$;
create function public.private_validate_attendance_reminder(p_id uuid,p_claim uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare valid boolean; begin
 select public.private_attendance_reminder_due(e.employee_uuid,e.work_date) and p.account_status='active' and dev.active and exists(
 select 1 from public.account_person_links l join public.employees emp on emp.person_id=l.person_id where l.profile_id=p.id and l.revoked_at is null and emp.id=e.employee_uuid)
 into valid from public.notification_deliveries d join public.notification_events e on e.id=d.event_id
 join public.profiles p on p.id=d.profile_id join public.notification_devices dev on dev.id=d.device_id
 where d.id=p_id and d.claim_token=p_claim and d.status='sending' and e.event_type='attendance.clock_in_missing';
 if not coalesce(valid,false) then update public.notification_deliveries set status='cancelled',claim_token=null,claimed_at=null,last_error_code='ATTENDANCE_NO_LONGER_DUE' where id=p_id and claim_token=p_claim; end if;
 return coalesce(valid,false);
end $$;
create function public.private_claim_attendance_receipts(p_claim uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
 if p_claim is null then raise exception 'INVALID_CLAIM'; end if;
 with candidates as (
 select d.id from public.notification_deliveries d join public.notification_events e on e.id=d.event_id
 where e.event_type='attendance.clock_in_missing' and d.status='accepted' and d.expo_ticket_id is not null
 and d.accepted_at<=now()-interval '15 minutes' and (d.receipt_checked_at is null or d.receipt_checked_at<=now()-interval '10 minutes')
 order by d.accepted_at for update of d skip locked limit 100
 ), claimed as (
 update public.notification_deliveries d set status='receipt_checking',claim_token=p_claim,claimed_at=now(),receipt_checked_at=now(),updated_at=now()
 from candidates c where d.id=c.id returning d.id,d.expo_ticket_id)
 select coalesce(jsonb_agg(jsonb_build_object('delivery_id',id,'ticket_id',expo_ticket_id)),'[]'::jsonb) into result from claimed;
 return result;
end $$;
revoke all on function public.private_attendance_reminder_due(uuid,date),public.private_claim_attendance_reminders(uuid,integer),public.private_validate_attendance_reminder(uuid,uuid),public.private_claim_attendance_receipts(uuid) from public,anon,authenticated;
grant execute on function public.private_claim_attendance_reminders(uuid,integer),public.private_validate_attendance_reminder(uuid,uuid),public.private_claim_attendance_receipts(uuid) to service_role;
commit;
