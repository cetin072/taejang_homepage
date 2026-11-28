begin;

-- Keep the staff-facing rollout scoped to clock-in. The existing enabled
-- switch remains the master control and is never changed by this migration.
alter table public.employee_reminder_policy
 add column clock_out_enabled boolean not null default false;

create or replace function public.private_attendance_reminder_due(
 p_employee uuid,p_day date,p_event_type text default 'attendance.clock_in_missing',p_now timestamptz default now()
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare
 s jsonb; ev jsonb; clock_in jsonb; delay_minutes integer;
 shift_start timestamptz; shift_end timestamptz; field_shift private.attendance_field_assignments;
begin
 if p_event_type is null or p_event_type not in ('attendance.clock_in_missing','attendance.clock_out_missing')
  or p_now is null or p_day is distinct from (p_now at time zone 'Asia/Seoul')::date then return false; end if;
 select p.delay_minutes into delay_minutes from public.employee_reminder_policy p
  where p.singleton and p.enabled and (p_event_type='attendance.clock_in_missing' or p.clock_out_enabled);
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

-- Replacing the predicate preserves its existing restricted grants and the
-- existing claim/validation paths continue to use the same eligibility rule.
commit;
