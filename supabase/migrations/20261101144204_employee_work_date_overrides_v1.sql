-- Date-specific exceptions reuse the validated work-term shape and common projection.
begin;
create table public.employee_work_overrides (like public.employee_work_terms including defaults including constraints);
alter table public.employee_work_overrides add primary key(id);
alter table public.employee_work_overrides add foreign key(employee_uuid) references public.employees(id);
alter table public.employee_work_overrides add foreign key(location_id) references public.attendance_locations(id);
alter table public.employee_work_overrides add foreign key(created_by) references public.profiles(id);
alter table public.employee_work_overrides add column revoked_at timestamptz;
alter table public.employee_work_overrides add column revoked_by uuid references public.profiles(id);
create unique index employee_work_override_active_date on public.employee_work_overrides(employee_uuid,effective_from) where revoked_at is null;
alter table public.employee_work_overrides enable row level security;
revoke all on public.employee_work_overrides from public,anon,authenticated,service_role;

create function public.save_employee_work_override(p_employee_uuid uuid,p_values jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if not exists(select 1 from public.attendance_locations where id=(p_values->>'location_id')::uuid and active) then raise exception 'LOCATION_REQUIRED'; end if;
 insert into public.employee_work_overrides(employee_uuid,effective_from,weekdays,starts_at,ends_at,break_starts_at,break_ends_at,location_id,reason,created_by)
 values(p_employee_uuid,d,array[extract(isodow from d)::int],(p_values->>'starts_at')::time,(p_values->>'ends_at')::time,
 nullif(p_values->>'break_starts_at','')::time,nullif(p_values->>'break_ends_at','')::time,(p_values->>'location_id')::uuid,p_values->>'reason',auth.uid()) returning id into saved;
 perform public.private_append_audit(auth.uid(),'employee_work_override_saved','employee',p_employee_uuid::text,'success',p_values->>'reason',jsonb_build_object('override_id',saved,'work_date',d));
 return jsonb_build_object('ok',true,'id',saved);
end $$;
create function public.revoke_employee_work_override(p_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.employee_work_overrides; begin
 if not public.private_actor_can('employee.work_terms_manage') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into r from public.employee_work_overrides where id=p_id;
 if not found then raise exception 'OVERRIDE_NOT_FOUND'; end if;
 perform 1 from public.employees where id=r.employee_uuid for update;
 perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:'||r.effective_from::text,0));
 if public.private_attendance_day_is_confirmed(r.effective_from) then raise exception 'DAY_CONFIRMED_REOPEN_REQUIRED'; end if;
 if r.effective_from<(now() at time zone 'Asia/Seoul')::date then raise exception 'PAST_OVERRIDE_READ_ONLY'; end if;
 if length(btrim(coalesce(p_reason,''))) not between 2 and 300 then raise exception 'REASON_REQUIRED'; end if;
 if exists(select 1 from public.employee_leave_requests where employee_uuid=r.employee_uuid and work_date=r.effective_from and status in ('pending','approved')) then raise exception 'LEAVE_SCHEDULE_CONFLICT'; end if;
 if public.private_attendance_effective_event(r.employee_uuid,r.effective_from,'clock_in')->>'event_at' is not null then raise exception 'ATTENDANCE_CONFLICT'; end if;
 update public.employee_work_overrides set revoked_at=now(),revoked_by=auth.uid() where id=p_id and revoked_at is null;
 perform public.private_append_audit(auth.uid(),'employee_work_override_revoked','employee',r.employee_uuid::text,'success',p_reason,jsonb_build_object('override_id',p_id));
 return jsonb_build_object('ok',true);
end $$;
create function public.revoke_employee_day_off(p_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.employee_days_off; begin
 if not public.private_leave_manager() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into r from public.employee_days_off where id=p_id for update;
 if not found then raise exception 'DAY_OFF_NOT_FOUND'; end if;
 perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:'||r.work_date::text,0));
 if public.private_attendance_day_is_confirmed(r.work_date) then raise exception 'DAY_CONFIRMED_REOPEN_REQUIRED'; end if;
 if r.work_date<(now() at time zone 'Asia/Seoul')::date then raise exception 'PAST_DAY_OFF_READ_ONLY'; end if;
 if length(btrim(coalesce(p_reason,''))) not between 2 and 300 then raise exception 'REASON_REQUIRED'; end if;
 update public.employee_days_off set revoked_at=now(),revoked_by=auth.uid() where id=p_id and revoked_at is null;
 perform public.private_append_audit(auth.uid(),'employee_day_off_revoked','employee',coalesce(r.employee_uuid::text,'company'),'success',p_reason,jsonb_build_object('day_off_id',p_id));
 return jsonb_build_object('ok',true);
end $$;
-- Effective base remains the request FK; date exception retains its own immutable record.
alter function public.private_work_terms(uuid,date) rename to private_work_terms_base572;
create function public.private_work_terms(p_employee uuid,p_day date) returns public.employee_work_terms language plpgsql stable security definer set search_path='' as $$
declare t public.employee_work_terms; o public.employee_work_overrides; begin
 t:=public.private_work_terms_base572(p_employee,p_day);
 if t.id is null then return t; end if;
 select * into o from public.employee_work_overrides where employee_uuid=p_employee and effective_from=p_day and revoked_at is null;
 if found then
  t.starts_at:=o.starts_at;t.ends_at:=o.ends_at;t.break_starts_at:=o.break_starts_at;t.break_ends_at:=o.break_ends_at;t.location_id:=o.location_id;
 end if;return t;
end $$;
alter function public.get_employee_leave_admin_context(uuid) rename to private_get_employee_leave_admin_context_pre_overrides572;
create function public.get_employee_leave_admin_context(p_employee_uuid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; begin
 b:=public.private_get_employee_leave_admin_context_pre_overrides572(p_employee_uuid);
 return b||jsonb_build_object('overrides',coalesce((select jsonb_agg(to_jsonb(o) order by o.effective_from desc)
 from public.employee_work_overrides o where (p_employee_uuid is null or o.employee_uuid=p_employee_uuid) and o.revoked_at is null),'[]'::jsonb));
end $$;
-- Approved leave remains the source of the daily status until a permitted cancellation.
alter function public.set_attendance_day_status(uuid,date,text,text,text) rename to private_set_attendance_day_status_pre572;
create function public.set_attendance_day_status(p_employee_uuid uuid,p_work_date date,p_attendance_status text,p_reason text,p_note text default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.private_actor_can('attendance.correct') then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:'||p_work_date::text,0));
 if exists(select 1 from public.employee_leave_requests where employee_uuid=p_employee_uuid and work_date=p_work_date and status='approved') then return jsonb_build_object('ok',false,'code','LEAVE_SOURCE_MANAGED'); end if;
 return public.private_set_attendance_day_status_pre572(p_employee_uuid,p_work_date,p_attendance_status,p_reason,p_note);
end $$;
revoke all on function public.private_set_attendance_day_status_pre572(uuid,date,text,text,text),public.set_attendance_day_status(uuid,date,text,text,text) from public,anon,authenticated;
grant execute on function public.set_attendance_day_status(uuid,date,text,text,text) to authenticated;
revoke all on function public.save_employee_work_override(uuid,jsonb),public.revoke_employee_work_override(uuid,text),public.revoke_employee_day_off(uuid,text),public.private_work_terms_base572(uuid,date),public.private_work_terms(uuid,date),public.private_get_employee_leave_admin_context_pre_overrides572(uuid),public.get_employee_leave_admin_context(uuid) from public,anon,authenticated;
grant execute on function public.save_employee_work_override(uuid,jsonb),public.revoke_employee_work_override(uuid,text),public.revoke_employee_day_off(uuid,text),public.get_employee_leave_admin_context(uuid) to authenticated;
commit;
