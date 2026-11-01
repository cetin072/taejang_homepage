-- PR #572. Additive, isolated-first. No hosted writes or scheduler activation.
begin;
insert into public.platform_capabilities(code,capability_kind,operations_manager_auto_grant,description)
values ('employee.work_terms_manage','operational',true,'직원 근무조건과 최초 연차 입력'),
       ('leave.manage','operational',true,'연차·휴무 조회 및 신청 승인')
on conflict(code) do nothing;
insert into public.role_capability_grants(role_id,capability_code)
select id,'leave.manage' from public.roles where code='promotion_lead'
on conflict do nothing;

create table public.employee_work_terms (
 id uuid primary key default gen_random_uuid(),
 employee_uuid uuid not null references public.employees(id),
 effective_from date not null,
 weekdays integer[] not null check(cardinality(weekdays) between 1 and 7 and weekdays <@ array[1,2,3,4,5,6,7]),
 starts_at time not null, ends_at time not null,
 break_starts_at time, break_ends_at time,
 location_id uuid not null references public.attendance_locations(id),
 reason text not null check(length(btrim(reason)) between 2 and 300),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 unique(employee_uuid,effective_from),
 check(ends_at>starts_at),
 check((break_starts_at is null and break_ends_at is null) or
  (break_starts_at is not null and break_ends_at is not null and break_starts_at>=starts_at and break_ends_at<=ends_at and break_ends_at>break_starts_at and break_ends_at-break_starts_at<ends_at-starts_at))
);
create table public.employee_leave_accounts (
 employee_uuid uuid primary key references public.employees(id),
 baseline_on date not null, initial_accrued numeric(8,2) not null check(initial_accrued>=0),
 initial_remaining numeric(8,2) not null check(initial_remaining>=0),
 monthly_enabled boolean not null default false,
 -- Explicit enrollment. Employment lifecycle history is not inferred.
 enrolled_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table public.employee_leave_requests (
 id uuid primary key, employee_uuid uuid not null references public.employees(id),
 work_date date not null, portion text not null check(portion in ('full','first_half','second_half')),
 units numeric(3,2) not null check(units in (0.5,1)),
 term_id uuid not null references public.employee_work_terms(id),
 leave_minutes numeric(8,2) not null check(leave_minutes>0),
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 submitted_by uuid not null references public.profiles(id), submitted_at timestamptz not null default now(),
 decided_by uuid references public.profiles(id), decided_at timestamptz,
 decision_note text check(length(decision_note)<=300),
 request_payload jsonb,
 attendance_change_id uuid references public.attendance_day_status_changes(id),
 check((portion='full' and units=1) or (portion<>'full' and units=0.5))
);
create unique index employee_leave_one_active_day on public.employee_leave_requests(employee_uuid,work_date)
 where status in ('pending','approved');
create table public.employee_leave_ledger (
 id uuid primary key default gen_random_uuid(), employee_uuid uuid not null references public.employee_leave_accounts(employee_uuid),
 kind text not null check(kind in ('monthly','monthly_hold','use','restore','adjustment')),
 entry_key text not null, delta numeric(8,2) not null,
 accrued_delta numeric(8,2) not null default 0,
 request_id uuid references public.employee_leave_requests(id),
 note text not null check(length(note) between 2 and 300),
 actor_id uuid references public.profiles(id), created_at timestamptz not null default now(),
 unique(employee_uuid,entry_key)
);
create table public.employee_days_off (
 id uuid primary key default gen_random_uuid(), employee_uuid uuid references public.employees(id),
 work_date date not null, reason text not null check(length(btrim(reason)) between 2 and 120),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 revoked_at timestamptz, revoked_by uuid references public.profiles(id)
);
create unique index employee_days_off_active on public.employee_days_off(coalesce(employee_uuid,'00000000-0000-0000-0000-000000000000'::uuid),work_date) where revoked_at is null;
-- No implicit +5min/one-reminder policy. Both gates must be explicitly enabled later.
create table public.employee_reminder_policy (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 delay_minutes integer check(delay_minutes between 0 and 120)
);
insert into public.employee_reminder_policy(singleton) values(true);

create function public.private_leave_manager() returns boolean language sql stable security definer set search_path='' as $$
 select public.current_profile_is_active() and public.private_actor_can('leave.manage')
 and (public.current_user_has_role('operations_manager') or public.current_user_has_role('promotion_lead'))
$$;
create function public.private_leave_employee() returns uuid language sql stable security definer set search_path='' as $$
 select e.id from public.account_person_links l join public.employees e on e.person_id=l.person_id
 where l.profile_id=auth.uid() and l.revoked_at is null and e.archived_at is null
 and e.employment_status='active' and public.current_profile_is_active()
 limit 1
$$;
create function public.private_work_terms(p_employee uuid,p_day date) returns public.employee_work_terms
 language sql stable security definer set search_path='' as $$
 select t from public.employee_work_terms t where t.employee_uuid=p_employee and t.effective_from<=p_day
 order by t.effective_from desc limit 1
$$;
-- Single schedule projection, used by submission, UI, reminders and attendance.
create function public.private_employee_schedule(p_employee uuid,p_day date) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare t public.employee_work_terms; r public.employee_leave_requests; total numeric; half numeric;
 start_min numeric; end_min numeric; bs numeric; be numeric; split_min numeric; workday boolean;
begin
 t:=public.private_work_terms(p_employee,p_day);
 if t.id is null then return jsonb_build_object('configured',false); end if;
 workday:=extract(isodow from p_day)::int=any(t.weekdays)
 and coalesce((select is_workday from public.attendance_calendar_overrides where work_date=p_day),extract(isodow from p_day)::int not in (6,7));
 if exists(select 1 from public.attendance_holiday_work_assignments where employee_uuid=p_employee and work_date=p_day and revoked_at is null) then workday:=true; end if;
 if not public.private_employee_is_attendance_subject_on(p_employee,p_day) then workday:=false; end if;
 if exists(select 1 from public.employee_days_off where work_date=p_day and revoked_at is null and (employee_uuid is null or employee_uuid=p_employee)) then workday:=false; end if;
 start_min:=extract(epoch from t.starts_at)/60; end_min:=extract(epoch from t.ends_at)/60;
 bs:=extract(epoch from t.break_starts_at)/60; be:=extract(epoch from t.break_ends_at)/60;
 total:=end_min-start_min-coalesce(be-bs,0); half:=total/2;
 -- Split by working minutes, excluding the break. Exact seconds are preserved.
 split_min:=start_min+half;
 if bs is not null and split_min>=bs then split_min:=split_min+(be-bs); end if;
 select * into r from public.employee_leave_requests where employee_uuid=p_employee and work_date=p_day and status='approved';
 if r.portion='full' then workday:=false;
 elsif r.portion='first_half' then start_min:=split_min;
 elsif r.portion='second_half' then end_min:=case when bs is not null and start_min+half=bs then bs else split_min end;
 end if;
 return jsonb_build_object('configured',true,'term_id',t.id,'work_date',p_day,'is_workday',workday,
 'starts_at',(p_day::timestamp+make_interval(secs=>(start_min*60)::double precision)) at time zone 'Asia/Seoul',
 'ends_at',(p_day::timestamp+make_interval(secs=>(end_min*60)::double precision)) at time zone 'Asia/Seoul',
 'scheduled_minutes',total,'working_minutes',case when r.portion='full' then 0 when r.id is not null then half else total end,
 'leave_minutes',coalesce(r.leave_minutes,0),'leave_portion',r.portion,'location_id',t.location_id);
end $$;
create function public.private_accrue_employee_leave(p_employee uuid) returns void
 language plpgsql security definer set search_path='' as $$
declare a public.employee_leave_accounts; d date; today date:=(now() at time zone 'Asia/Seoul')::date; eligible boolean;
begin
 select * into a from public.employee_leave_accounts where employee_uuid=p_employee for update;
 if not found or not a.monthly_enabled then return; end if;
 -- Baseline includes its entire date, including a first-of-month date.
 d:=(date_trunc('month',a.baseline_on)+interval '1 month')::date;
 while d<=today loop
  select e.employment_status='active' and e.archived_at is null and e.hired_on<=d
   and (e.updated_at at time zone 'Asia/Seoul')::date<=d
   and (e.departed_on is null or e.departed_on>=d) into eligible from public.employees e where e.id=p_employee;
  insert into public.employee_leave_ledger(employee_uuid,kind,entry_key,delta,accrued_delta,note)
  values(p_employee,case when eligible then 'monthly' else 'monthly_hold' end,'month:'||d,
   case when eligible then 1 else 0 end,case when eligible then 1 else 0 end,
   case when eligible then '매월 1일 발생' else '재직 상태 확인 필요: 자동 부여 보류' end)
  on conflict(employee_uuid,entry_key) do nothing;
  d:=(d+interval '1 month')::date;
 end loop;
end $$;
create function public.private_employee_leave_balance(p_employee uuid) returns jsonb
 language sql stable security definer set search_path='' as $$
 select jsonb_build_object('configured',true,'baseline_on',a.baseline_on,
 'accrued',a.initial_accrued+coalesce((select sum(accrued_delta) from public.employee_leave_ledger where employee_uuid=p_employee),0),
 'remaining',a.initial_remaining+coalesce((select sum(delta) from public.employee_leave_ledger where employee_uuid=p_employee),0),
 'reserved',coalesce((select sum(units) from public.employee_leave_requests where employee_uuid=p_employee and status='pending'),0),
 'available',a.initial_remaining+coalesce((select sum(delta) from public.employee_leave_ledger where employee_uuid=p_employee),0)
 -coalesce((select sum(units) from public.employee_leave_requests where employee_uuid=p_employee and status='pending'),0))
 from public.employee_leave_accounts a where a.employee_uuid=p_employee
$$;

create function public.save_employee_work_terms(p_employee_uuid uuid,p_values jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare t public.employee_work_terms; d date; begin
 if auth.uid() is null or not public.private_actor_can('employee.work_terms_manage') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.employees where id=p_employee_uuid and archived_at is null for update;
 if not found then raise exception 'EMPLOYEE_NOT_FOUND'; end if;
 d:=(p_values->>'effective_from')::date;
 if d is null or d<(now() at time zone 'Asia/Seoul')::date then raise exception 'FUTURE_OR_TODAY_REQUIRED'; end if;
 if exists(select 1 from public.employee_leave_requests where employee_uuid=p_employee_uuid and status in ('pending','approved') and work_date>=d) then raise exception 'LEAVE_SCHEDULE_CONFLICT'; end if;
 if exists(select 1 from public.employee_work_terms where employee_uuid=p_employee_uuid and effective_from>=d) then raise exception 'APPEND_NEW_EFFECTIVE_DATE_REQUIRED'; end if;
 if not exists(select 1 from public.attendance_locations where id=(p_values->>'location_id')::uuid and active) then raise exception 'LOCATION_REQUIRED'; end if;
 insert into public.employee_work_terms(employee_uuid,effective_from,weekdays,starts_at,ends_at,break_starts_at,break_ends_at,location_id,reason,created_by)
 values(p_employee_uuid,d,array(select jsonb_array_elements_text(p_values->'weekdays')::int),
 (p_values->>'starts_at')::time,(p_values->>'ends_at')::time,nullif(p_values->>'break_starts_at','')::time,nullif(p_values->>'break_ends_at','')::time,
 (p_values->>'location_id')::uuid,p_values->>'reason',auth.uid()) returning * into t;
 perform public.private_append_audit(auth.uid(),'employee_work_terms_saved','employee',p_employee_uuid::text,'success',t.reason,jsonb_build_object('term_id',t.id,'effective_from',d));
 return jsonb_build_object('ok',true,'id',t.id);
end $$;
create function public.initialize_employee_leave(p_employee_uuid uuid,p_baseline_on date,p_accrued numeric,p_remaining numeric,p_monthly_enabled boolean,p_reason text) returns jsonb
 language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.private_actor_can('employee.work_terms_manage') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_baseline_on is null or p_baseline_on<>(now() at time zone 'Asia/Seoul')::date then raise exception 'BASELINE_MUST_BE_TODAY'; end if;
 if p_accrued is null or p_remaining is null or p_monthly_enabled is null or length(btrim(coalesce(p_reason,''))) not between 2 and 300 then raise exception 'INVALID_BASELINE'; end if;
 perform 1 from public.employees where id=p_employee_uuid and archived_at is null and employment_status='active' for update;
 if not found then raise exception 'EMPLOYEE_NOT_ACTIVE'; end if;
 insert into public.employee_leave_accounts values(p_employee_uuid,p_baseline_on,p_accrued,p_remaining,p_monthly_enabled,auth.uid(),now());
 perform public.private_append_audit(auth.uid(),'employee_leave_initialized','employee',p_employee_uuid::text,'success',p_reason,
 jsonb_build_object('baseline_on',p_baseline_on,'accrued',p_accrued,'remaining',p_remaining,'monthly_enabled',p_monthly_enabled));
 return jsonb_build_object('ok',true);
end $$;
create function public.get_my_leave_context() returns jsonb language plpgsql security definer set search_path='' as $$
declare e uuid:=public.private_leave_employee(); b jsonb; begin
 if e is null then raise exception 'EMPLOYEE_LINK_REQUIRED' using errcode='42501'; end if;
 perform public.private_accrue_employee_leave(e); b:=public.private_employee_leave_balance(e);
 return jsonb_build_object('configured',b is not null,'remaining',b->'available',
 'server_today',(now() at time zone 'Asia/Seoul')::date,'earliest_date',(now() at time zone 'Asia/Seoul')::date+3,
 'requests',coalesce((select jsonb_agg(jsonb_build_object('id',id,'work_date',work_date,'portion',portion,'units',units,'status',status) order by work_date desc)
 from (select * from public.employee_leave_requests where employee_uuid=e order by work_date desc limit 100) r),'[]'::jsonb));
end $$;
create function public.submit_my_leave_request(p_id uuid,p_days jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare e uuid:=public.private_leave_employee(); item jsonb; d date; portion text; units numeric; total numeric:=0; s jsonb; b jsonb; old public.employee_leave_requests;
begin
 if e is null then raise exception 'EMPLOYEE_LINK_REQUIRED' using errcode='42501'; end if;
 if p_id is null or p_days is null or jsonb_typeof(p_days)<>'array' or jsonb_array_length(p_days) not between 1 and 31 then raise exception 'INVALID_REQUEST'; end if;
 -- A batch UUID is used for its first day; additional dates derive stable UUIDs from it.
 perform 1 from public.employees where id=e for update;
 perform 1 from public.employee_leave_accounts where employee_uuid=e for update;
 if not found then raise exception 'LEAVE_NOT_CONFIGURED'; end if;
 select * into old from public.employee_leave_requests where id=p_id;
 if found then
  if old.employee_uuid<>e or old.request_payload is distinct from p_days then raise exception 'REQUEST_ID_CONFLICT'; end if;
  return jsonb_build_object('ok',true,'already_submitted',true);
 end if;
 perform public.private_accrue_employee_leave(e);
 for item in select value from jsonb_array_elements(p_days) loop
  d:=(item->>'date')::date; portion:=item->>'portion';
  perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:'||d::text,0));
  if d is null or d<(now() at time zone 'Asia/Seoul')::date+3 then raise exception 'LEAVE_THREE_DAYS_REQUIRED'; end if;
  if portion is null or portion not in ('full','first_half','second_half') then raise exception 'INVALID_PORTION'; end if;
  s:=public.private_employee_schedule(e,d);
  if not coalesce((s->>'is_workday')::boolean,false) then raise exception 'NOT_SCHEDULED_WORKDAY'; end if;
  if public.private_attendance_day_is_confirmed(d) then raise exception 'DAY_CONFIRMED_REOPEN_REQUIRED'; end if;
  if public.private_attendance_effective_status(e,d)->>'status'<>'work' then raise exception 'ATTENDANCE_CONFLICT'; end if;
  units:=case when portion='full' then 1 else .5 end; total:=total+units;
 end loop;
 b:=public.private_employee_leave_balance(e);
 if (b->>'available')::numeric<total then raise exception 'INSUFFICIENT_LEAVE'; end if;
 for item in select value from jsonb_array_elements(p_days) loop
  d:=(item->>'date')::date; portion:=item->>'portion'; s:=public.private_employee_schedule(e,d); units:=case when portion='full' then 1 else .5 end;
  insert into public.employee_leave_requests(id,employee_uuid,work_date,portion,units,term_id,leave_minutes,submitted_by,request_payload)
  values(case when item=p_days->0 then p_id else md5(p_id::text||':'||d::text)::uuid end,e,d,portion,units,(s->>'term_id')::uuid,(s->>'scheduled_minutes')::numeric*units,auth.uid(),case when item=p_days->0 then p_days else null end);
 end loop;
 perform public.private_append_audit(auth.uid(),'employee_leave_submitted','employee',e::text,'success','직원앱 연차 신청',jsonb_build_object('batch_id',p_id,'units',total));
 return jsonb_build_object('ok',true,'id',p_id);
end $$;
create function public.review_employee_leave(p_request_id uuid,p_decision text,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.employee_leave_requests; b jsonb; change_id uuid; begin
 if not public.private_leave_manager() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into r from public.employee_leave_requests where id=p_request_id;
 if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
 perform 1 from public.employees where id=r.employee_uuid for update;
 perform 1 from public.employee_leave_accounts where employee_uuid=r.employee_uuid for update;
 perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:'||r.work_date::text,0));
 select * into r from public.employee_leave_requests where id=p_request_id for update;
 if r.status<>'pending' then return jsonb_build_object('ok',true,'status',r.status); end if;
 if r.submitted_by=auth.uid() or r.employee_uuid=public.private_leave_employee() then raise exception 'SELF_APPROVAL_FORBIDDEN'; end if;
 if p_decision is null or p_decision not in ('approved','rejected') or length(btrim(coalesce(p_note,''))) not between 2 and 300 then raise exception 'DECISION_REQUIRED'; end if;
 if public.current_user_has_role('promotion_lead') and not public.current_user_has_role('operations_manager') and public.private_employee_is_protected(r.employee_uuid) then raise exception 'PROTECTED_EMPLOYEE_REVIEW_REQUIRED'; end if;
 if p_decision='approved' then
  if r.work_date<(now() at time zone 'Asia/Seoul')::date then raise exception 'PAST_LEAVE_REVIEW_REQUIRED'; end if;
  if public.private_attendance_day_is_confirmed(r.work_date) then raise exception 'DAY_CONFIRMED_REOPEN_REQUIRED'; end if;
  if public.private_attendance_effective_status(r.employee_uuid,r.work_date)->>'status'<>'work'
   or public.private_attendance_effective_event(r.employee_uuid,r.work_date,'clock_in')->>'event_at' is not null then raise exception 'ATTENDANCE_CONFLICT'; end if;
  b:=public.private_employee_leave_balance(r.employee_uuid);
  if (b->>'remaining')::numeric<r.units then raise exception 'INSUFFICIENT_LEAVE'; end if;
  if r.portion='full' then
   insert into public.attendance_day_status_changes(employee_uuid,work_date,attendance_status,note,reason,changed_by)
   values(r.employee_uuid,r.work_date,'paid_leave','승인 연차','연차 신청 승인',auth.uid()) returning id into change_id;
  end if;
  insert into public.employee_leave_ledger(employee_uuid,kind,entry_key,delta,request_id,note,actor_id)
   values(r.employee_uuid,'use','use:'||r.id,-r.units,r.id,'승인 연차 사용',auth.uid());
 end if;
 update public.employee_leave_requests set status=p_decision,decided_by=auth.uid(),decided_at=now(),decision_note=p_note,attendance_change_id=change_id where id=r.id;
 perform public.private_append_audit(auth.uid(),'employee_leave_reviewed','employee',r.employee_uuid::text,'success',p_note,jsonb_build_object('request_id',r.id,'decision',p_decision));
 return jsonb_build_object('ok',true,'status',p_decision);
end $$;
-- Only pending self-cancellation is enabled. Approved cancellation needs a separate policy decision.
create function public.cancel_my_leave_request(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e uuid:=public.private_leave_employee(); r public.employee_leave_requests; begin
 if e is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.employee_leave_accounts where employee_uuid=e for update;
 select * into r from public.employee_leave_requests where id=p_request_id and employee_uuid=e for update;
 if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
 if r.status='cancelled' then return jsonb_build_object('ok',true); end if;
 if r.status<>'pending' then raise exception 'APPROVED_CANCELLATION_POLICY_REQUIRED'; end if;
 update public.employee_leave_requests set status='cancelled',decided_at=now(),decided_by=auth.uid() where id=r.id;
 perform public.private_append_audit(auth.uid(),'employee_leave_cancelled','employee',e::text,'success','대기 연차 신청 취소',jsonb_build_object('request_id',r.id));
 return jsonb_build_object('ok',true);
end $$;
create function public.adjust_employee_leave(p_employee_uuid uuid,p_id uuid,p_delta numeric,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; begin
 if not public.private_actor_can('employee.work_terms_manage') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_delta is null or p_delta=0 or abs(p_delta)>100 or length(btrim(coalesce(p_reason,''))) not between 2 and 300 then raise exception 'INVALID_ADJUSTMENT'; end if;
 perform 1 from public.employee_leave_accounts where employee_uuid=p_employee_uuid for update;
 if not found then raise exception 'LEAVE_NOT_CONFIGURED'; end if;
 if exists(select 1 from public.employee_leave_ledger where employee_uuid=p_employee_uuid and entry_key='adjust:'||p_id) then return jsonb_build_object('ok',true); end if;
 perform public.private_accrue_employee_leave(p_employee_uuid); b:=public.private_employee_leave_balance(p_employee_uuid);
 if (b->>'available')::numeric+p_delta<0 then raise exception 'INSUFFICIENT_LEAVE'; end if;
 insert into public.employee_leave_ledger(employee_uuid,kind,entry_key,delta,note,actor_id)
 values(p_employee_uuid,'adjustment','adjust:'||p_id,p_delta,p_reason,auth.uid());
 perform public.private_append_audit(auth.uid(),'employee_leave_adjusted','employee',p_employee_uuid::text,'success',p_reason,jsonb_build_object('adjustment_id',p_id,'delta',p_delta));
 return jsonb_build_object('ok',true);
end $$;
create function public.get_employee_leave_admin_context(p_employee_uuid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r record; begin
 if not public.private_leave_manager() and not public.private_actor_can('employee.work_terms_manage') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 for r in select employee_uuid from public.employee_leave_accounts where p_employee_uuid is null or employee_uuid=p_employee_uuid order by employee_uuid loop perform public.private_accrue_employee_leave(r.employee_uuid); end loop;
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
 'locations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.attendance_locations where active),'[]'::jsonb));
end $$;
create function public.save_employee_day_off(p_employee_uuid uuid,p_work_date date,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare e record; begin
 if not public.private_leave_manager() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_work_date is null or p_work_date<(now() at time zone 'Asia/Seoul')::date or length(btrim(coalesce(p_reason,''))) not between 2 and 120 then raise exception 'INVALID_DAY_OFF'; end if;
 perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:'||p_work_date::text,0));
 if public.private_attendance_day_is_confirmed(p_work_date) then raise exception 'DAY_CONFIRMED_REOPEN_REQUIRED'; end if;
 if exists(select 1 from public.employee_leave_requests where work_date=p_work_date and status in ('pending','approved') and (p_employee_uuid is null or employee_uuid=p_employee_uuid)) then raise exception 'LEAVE_SCHEDULE_CONFLICT'; end if;
 for e in select id from public.employees where archived_at is null and (p_employee_uuid is null or id=p_employee_uuid) order by id loop
  if public.private_attendance_effective_event(e.id,p_work_date,'clock_in')->>'event_at' is not null then raise exception 'ATTENDANCE_CONFLICT'; end if;
 end loop;
 insert into public.employee_days_off(employee_uuid,work_date,reason,created_by) values(p_employee_uuid,p_work_date,p_reason,auth.uid());
 perform public.private_append_audit(auth.uid(),'employee_day_off_saved','employee',coalesce(p_employee_uuid::text,'company'),'success',p_reason,jsonb_build_object('work_date',p_work_date));
 return jsonb_build_object('ok',true);
end $$;
-- Add a schedule projection without replacing existing location, 06:00 or QA rules.
alter function public.get_my_attendance_today() rename to private_get_my_attendance_today_pre572;
create function public.get_my_attendance_today() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b jsonb; e uuid; s jsonb; begin
 b:=public.private_get_my_attendance_today_pre572(); e:=public.private_leave_employee();
 if e is not null then
  s:=public.private_employee_schedule(e,(now() at time zone 'Asia/Seoul')::date);
  b:=b||jsonb_build_object('work_schedule',s);
  if (s->>'configured')::boolean and not (s->>'is_workday')::boolean then b:=b||jsonb_build_object('is_workday',false,'clock_in_available',false,'day_reason','승인 휴가 또는 지정 휴무'); end if;
 end if; return b;
end $$;
alter function public.record_attendance_event(text,double precision,double precision,double precision) rename to private_record_attendance_event_pre572;
create function public.record_attendance_event(p_event_type text,p_latitude double precision,p_longitude double precision,p_accuracy_m double precision) returns jsonb language plpgsql security definer set search_path='' as $$
declare e uuid:=public.private_leave_employee(); s jsonb; begin
 if e is not null then
  s:=public.private_employee_schedule(e,(now() at time zone 'Asia/Seoul')::date);
  if (s->>'configured')::boolean and not (s->>'is_workday')::boolean then return jsonb_build_object('ok',false,'code','NOT_WORKDAY'); end if;
 end if;
 return public.private_record_attendance_event_pre572(p_event_type,p_latitude,p_longitude,p_accuracy_m);
end $$;
-- Preserve half-day semantics in the canonical admin record. No full-day paid_leave coercion.
alter function public.private_attendance_effective_status(uuid,date) rename to private_attendance_effective_status_pre572;
create function public.private_attendance_effective_status(p_employee_uuid uuid,p_work_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b jsonb; r public.employee_leave_requests; begin
 b:=public.private_attendance_effective_status_pre572(p_employee_uuid,p_work_date);
 select * into r from public.employee_leave_requests where employee_uuid=p_employee_uuid and work_date=p_work_date and status='approved' and portion<>'full';
 if found then return b||jsonb_build_object('leave_portion',r.portion,'leave_minutes',r.leave_minutes,'note','승인 반차 · 근무시간 절반'); end if;
 return b;
end $$;
-- Existing payroll has no mixed paid-leave/work input. Fail closed instead of silently underpaying.
alter function public.private_attendance_confirmation_blockers(date) rename to private_attendance_confirmation_blockers_pre572;
create function public.private_attendance_confirmation_blockers(p_work_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b jsonb; extra jsonb; begin
 b:=public.private_attendance_confirmation_blockers_pre572(p_work_date);
 select coalesce(jsonb_agg(jsonb_build_object('type','half_day_payroll_review','key',r.id,'employee_uuid',r.employee_uuid,'display_name',p.full_name,
 'message','반차 유급시간과 실제 근무시간을 급여 담당자가 확인해야 합니다.')),'[]'::jsonb) into extra
 from public.employee_leave_requests r join public.employees e on e.id=r.employee_uuid join public.people p on p.id=e.person_id
 where r.work_date=p_work_date and r.status='approved' and r.portion<>'full';
 return b||extra;
end $$;
-- Monthly reconciliation is callable only by the internal worker; also reconciled on guarded reads.
create function public.private_reconcile_leave_monthly() returns jsonb language plpgsql security definer set search_path='' as $$
declare r record; n int:=0; begin
 for r in select employee_uuid from public.employee_leave_accounts where monthly_enabled order by employee_uuid loop
  perform public.private_accrue_employee_leave(r.employee_uuid); n:=n+1;
 end loop; return jsonb_build_object('ok',true,'accounts',n);
end $$;

-- Explicit ACL for every new table and function. Private helpers are not Data API endpoints.
do $acl$ declare n text; signature regprocedure; begin
 foreach n in array array['employee_work_terms','employee_leave_accounts','employee_leave_requests','employee_leave_ledger','employee_days_off','employee_reminder_policy'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
 end loop;
 for signature in select p.oid::regprocedure from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname in
 ('private_leave_manager','private_leave_employee','private_work_terms','private_employee_schedule','private_accrue_employee_leave','private_employee_leave_balance',
 'save_employee_work_terms','initialize_employee_leave','get_my_leave_context','submit_my_leave_request','review_employee_leave','cancel_my_leave_request',
 'adjust_employee_leave','get_employee_leave_admin_context','save_employee_day_off','private_reconcile_leave_monthly',
 'private_get_my_attendance_today_pre572','private_record_attendance_event_pre572','private_attendance_effective_status_pre572','private_attendance_confirmation_blockers_pre572',
 'get_my_attendance_today','record_attendance_event','private_attendance_effective_status','private_attendance_confirmation_blockers') loop
  execute format('revoke all on function %s from public,anon,authenticated',signature);
 end loop;
end $acl$;
grant execute on function public.save_employee_work_terms(uuid,jsonb), public.initialize_employee_leave(uuid,date,numeric,numeric,boolean,text),
 public.get_my_leave_context(),public.submit_my_leave_request(uuid,jsonb),public.review_employee_leave(uuid,text,text),
 public.cancel_my_leave_request(uuid),public.adjust_employee_leave(uuid,uuid,numeric,text),
 public.get_employee_leave_admin_context(uuid),public.save_employee_day_off(uuid,date,text),public.get_my_attendance_today(),
 public.record_attendance_event(text,double precision,double precision,double precision) to authenticated;
grant execute on function public.private_reconcile_leave_monthly() to service_role;
commit;
