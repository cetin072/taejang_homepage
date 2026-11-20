begin;

-- Count business days after the request date in the shared attendance calendar.
create function public.private_employee_leave_earliest_date(p_requested_on date)
returns date language plpgsql stable strict set search_path='' as $$
declare
 day date := p_requested_on;
 counted integer := 0;
begin
 while counted < 3 loop
  day := day + 1;
  if extract(isodow from day) between 1 and 5
    and not exists(select 1 from public.attendance_calendar_overrides
      where work_date=day and not is_workday)
    and not exists(select 1 from public.employee_days_off
      where work_date=day and employee_uuid is null and revoked_at is null) then
   counted := counted + 1;
  end if;
 end loop;
 return day;
end $$;

revoke all on function public.private_employee_leave_earliest_date(date) from public,anon,authenticated;

create or replace function public.private_submit_employee_leave(p_employee uuid,p_submitter uuid,p_id uuid,p_days jsonb,p_requested_on date,p_admin_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare e uuid:=p_employee; item jsonb; d date; portion text; units numeric; total numeric:=0; s jsonb; b jsonb; old public.employee_leave_requests;
 earliest date;
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
 -- A null request date is used only when approving an amendment already checked at intake.
 earliest:=public.private_employee_leave_earliest_date(p_requested_on);
 perform public.private_accrue_employee_leave(e);
 for item in select value from jsonb_array_elements(p_days) order by value->>'date' loop
  d:=(item->>'date')::date; portion:=item->>'portion';
  perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:'||d::text,0));
  if d is null or (p_admin_note is null and earliest is not null and d<earliest) then raise exception 'LEAVE_THREE_DAYS_REQUIRED'; end if;
  if portion is null or portion not in ('full','first_half','second_half') then raise exception 'INVALID_PORTION'; end if;
  s:=public.private_employee_schedule(e,d);
  if not coalesce((s->>'is_workday')::boolean,false) then raise exception 'NOT_SCHEDULED_WORKDAY'; end if;
  if public.private_attendance_day_is_confirmed(d) then raise exception 'DAY_CONFIRMED_REOPEN_REQUIRED'; end if;
  if exists(select 1 from public.employees where id=e and attendance_required) and public.private_attendance_effective_status(e,d)->>'status'<>'work' then raise exception 'ATTENDANCE_CONFLICT'; end if;
  units:=case when portion='full' then 1 else .5 end; total:=total+units;
 end loop;
 b:=public.private_employee_leave_balance(e);
 if (b->>'available')::numeric<total then raise exception 'INSUFFICIENT_LEAVE'; end if;
 for item in select value from jsonb_array_elements(p_days) order by value->>'date' loop
  d:=(item->>'date')::date; portion:=item->>'portion'; s:=public.private_employee_schedule(e,d); units:=case when portion='full' then 1 else .5 end;
  insert into public.employee_leave_requests(id,employee_uuid,work_date,portion,units,term_id,leave_minutes,submitted_by,request_payload,admin_registration_note)
  values(case when item=p_days->0 then p_id else md5(p_id::text||':'||d::text)::uuid end,e,d,portion,units,(s->>'term_id')::uuid,(s->>'scheduled_minutes')::numeric*units,p_submitter,case when item=p_days->0 then p_days else null end,p_admin_note);
 end loop;
 if p_admin_note is null then
  perform public.private_append_audit(auth.uid(),'employee_leave_submitted','employee',e::text,'success','직원앱 연차 신청',jsonb_build_object('batch_id',p_id,'units',total));
 end if;
 return jsonb_build_object('ok',true,'id',p_id);
end $$;

create or replace function public.request_my_leave_change(p_id uuid,p_request_id uuid,p_action text,p_new_work_date date,p_new_portion text,p_reason text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare e uuid:=public.private_leave_employee(); r public.employee_leave_requests; c public.employee_leave_change_requests; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 if e is null then raise exception 'EMPLOYEE_LINK_REQUIRED' using errcode='42501'; end if;
 if p_id is null then raise exception 'INVALID_REQUEST'; end if;
 perform 1 from public.employees where id=e for update;
 perform 1 from public.employee_leave_accounts where employee_uuid=e for update;
 select * into c from public.employee_leave_change_requests where id=p_id;
 if found then
  if c.employee_uuid<>e or c.request_id is distinct from p_request_id or c.action is distinct from p_action or c.new_work_date is distinct from p_new_work_date or c.new_portion is distinct from p_new_portion or c.manager_direct or c.reason is distinct from coalesce(p_reason,'') then raise exception 'REQUEST_ID_CONFLICT'; end if;
  return jsonb_build_object('ok',true,'already_submitted',true);
 end if;
 select * into r from public.employee_leave_requests where id=p_request_id and employee_uuid=e for update;
 if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
 if r.status<>'approved' then raise exception 'LEAVE_NOT_APPROVED'; end if;
 if r.work_date<=today then raise exception 'LEAVE_ALREADY_STARTED'; end if;
 if exists(select 1 from public.employee_leave_change_requests where request_id=r.id and status='pending') then raise exception 'LEAVE_CHANGE_PENDING'; end if;
 if p_action is null or p_action not in ('cancel','amend') or length(btrim(coalesce(p_reason,''))) > 300 then raise exception 'INVALID_REQUEST'; end if;
 if p_action='amend' then
  if (public.private_employee_leave_change_usage(e)->>'amend_remaining')::int=0 then raise exception 'LEAVE_MONTHLY_AMEND_LIMIT'; end if;
  if p_new_work_date is null or p_new_work_date<public.private_employee_leave_earliest_date(today) then raise exception 'LEAVE_THREE_DAYS_REQUIRED'; end if;
  if p_new_portion is null or p_new_portion not in ('full','first_half','second_half') then raise exception 'INVALID_PORTION'; end if;
  if p_new_work_date=r.work_date and p_new_portion=r.portion then raise exception 'LEAVE_CHANGE_UNCHANGED'; end if;
  update public.employee_leave_requests set modification_count=least(modification_count+1,1) where id=r.id;
 else
  if (public.private_employee_leave_change_usage(e)->>'cancel_remaining')::int=0 then raise exception 'LEAVE_MONTHLY_CANCEL_LIMIT'; end if;
  if p_new_work_date is not null or p_new_portion is not null then raise exception 'INVALID_REQUEST'; end if;
 end if;
 insert into public.employee_leave_change_requests(id,request_id,employee_uuid,action,new_work_date,new_portion,reason,submitted_by)
 values(p_id,r.id,e,p_action,p_new_work_date,p_new_portion,coalesce(p_reason,''),auth.uid());
 perform public.private_append_audit(auth.uid(),'employee_leave_change_requested','employee',e::text,'success',coalesce(nullif(btrim(p_reason),''),case p_action when 'cancel' then '직원 연차 취소 요청' else '직원 연차 수정 요청' end),jsonb_build_object('change_id',p_id,'request_id',r.id,'action',p_action));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.get_my_leave_context() returns jsonb language plpgsql security definer set search_path='' as $$
declare e uuid:=public.private_leave_employee(); b jsonb; begin
 b:=public.private_get_my_leave_context_pre573();
 return b||jsonb_build_object('earliest_date',public.private_employee_leave_earliest_date((b->>'server_today')::date),
 'change_requests',coalesce((select jsonb_agg(to_jsonb(c) order by created_at desc) from (select id,request_id,action,new_work_date,new_portion,reason,status,decision_note,created_at from public.employee_leave_change_requests where employee_uuid=e order by created_at desc limit 100) c),'[]'::jsonb),
 'self_service_limits',public.private_employee_leave_change_usage(e),'requests',coalesce((select jsonb_agg(to_jsonb(r) order by work_date desc) from (select id,work_date,portion,units,status,modification_count,replaces_request_id from public.employee_leave_requests where employee_uuid=e order by work_date desc limit 100) r),'[]'::jsonb));
end $$;

create or replace function public.get_employee_leave_admin_context(p_employee_uuid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; begin
 b:=public.private_get_employee_leave_admin_context_pre573(p_employee_uuid);
 -- The existing delegate performs the same narrow authorization before metadata is read.
 b:=b||jsonb_build_object('earliest_date',public.private_employee_leave_earliest_date((b->>'server_today')::date),
   'can_manage_work_terms',public.private_actor_can('employee.work_terms_manage'),
   -- Per-employee eligibility also keeps older web clients from offering adjustment to a lead.
   'can_initialize',public.private_actor_can('employee.work_terms_manage') and (public.current_user_has_role('operations_manager') or (public.current_user_has_role('promotion_lead') and (p_employee_uuid is null or not exists(select 1 from public.employee_leave_accounts where employee_uuid=p_employee_uuid)))),
   'can_adjust',public.current_user_has_role('operations_manager') and public.private_actor_can('employee.work_terms_manage'),
   'roster_version',1,'employees',coalesce((
   select jsonb_agg(item||jsonb_build_object(
     'full_name',item->>'name','employment_status',e.employment_status,
     'hired_on',e.hired_on,'departed_on',e.departed_on,
     'position_id',e.position_id,'position_name',p.name) order by ord)
   from jsonb_array_elements(b->'employees') with ordinality as entry(item,ord)
   join public.employees e on e.id=(item->>'id')::uuid
   left join public.positions p on p.id=e.position_id),'[]'::jsonb),
   'positions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code,'sort_order',sort_order) order by sort_order,name) from public.positions),'[]'::jsonb));
 return b||jsonb_build_object('change_requests',coalesce((select jsonb_agg(to_jsonb(c) order by created_at desc) from
 (select c.*,p.full_name as employee_name,r.work_date as original_work_date,r.portion as original_portion from public.employee_leave_change_requests c join public.employee_leave_requests r on r.id=c.request_id join public.employees e on e.id=c.employee_uuid join public.people p on p.id=e.person_id where p_employee_uuid is null or c.employee_uuid=p_employee_uuid order by c.created_at desc limit 300) c),'[]'::jsonb));
end $$;

create or replace function public.private_review_employee_leave_change(p_change_id uuid,p_decision text,p_note text,p_direct boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.employee_leave_change_requests; r public.employee_leave_requests; day date; today date:=(now() at time zone 'Asia/Seoul')::date; current_status jsonb;
begin
 if not public.private_leave_manager() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.employee_leave_change_requests where id=p_change_id;
 if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
 perform 1 from public.employees where id=c.employee_uuid for update;
 perform 1 from public.employee_leave_accounts where employee_uuid=c.employee_uuid for update;
 select * into c from public.employee_leave_change_requests where id=p_change_id for update;
 select * into r from public.employee_leave_requests where id=c.request_id for update;
 if not public.current_user_has_role('operations_manager') and ((c.submitted_by=auth.uid() and not p_direct) or r.employee_uuid=public.private_leave_employee()) then raise exception 'SELF_APPROVAL_FORBIDDEN'; end if;
 if not public.current_user_has_role('operations_manager') and (
  public.private_employee_is_protected(r.employee_uuid) or not exists (
   select 1 from public.employees e where e.id=r.employee_uuid
    and public.private_team_lead_can_assign_position(e.position_id)
  )
 ) then raise exception 'PROTECTED_EMPLOYEE_REVIEW_REQUIRED'; end if;
 if p_decision is null or p_decision not in ('approved','rejected') or length(btrim(coalesce(p_note,''))) not between 2 and 300 then raise exception 'DECISION_REQUIRED'; end if;
 if c.status<>'pending' then return jsonb_build_object('ok',true,'status',c.status); end if;
 if p_decision='approved' then
  for day in select distinct d from unnest(array[r.work_date,c.new_work_date]) d where d is not null order by d loop
   perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:'||day::text,0));
   if public.private_attendance_day_is_confirmed(day) then raise exception 'DAY_CONFIRMED_REOPEN_REQUIRED'; end if;
  end loop;
  if r.work_date<=today or (c.action='amend' and c.new_work_date<=today) then raise exception 'LEAVE_ALREADY_STARTED'; end if;
  if r.status not in ('pending','approved') then raise exception 'LEAVE_NOT_ACTIVE'; end if;
  if public.private_attendance_effective_event(r.employee_uuid,r.work_date,'clock_in')->>'status' is not null
   or public.private_attendance_effective_event(r.employee_uuid,r.work_date,'clock_out')->>'status' is not null then raise exception 'ATTENDANCE_CONFLICT'; end if;
  if r.attendance_change_id is not null then
   current_status:=public.private_attendance_effective_status(r.employee_uuid,r.work_date);
   if current_status->>'change_id' is distinct from r.attendance_change_id::text then raise exception 'ATTENDANCE_CONFLICT'; end if;
   -- Approval required the effective status to be work. Preserve the immutable
   -- original event and append its work restoration; never delete a status row.
   insert into public.attendance_day_status_changes(employee_uuid,work_date,attendance_status,note,reason,changed_by,changed_at)
   values(r.employee_uuid,r.work_date,'work','연차 취소·변경 승인',p_note,auth.uid(),clock_timestamp());
  end if;
  if r.status='approved' then
   insert into public.employee_leave_ledger(employee_uuid,kind,entry_key,delta,request_id,note,actor_id)
   values(r.employee_uuid,'restore','restore:'||r.id,r.units,r.id,'연차 취소·변경 승인',auth.uid());
  end if;
  update public.employee_leave_requests set status='cancelled',decided_by=auth.uid(),decided_at=now(),decision_note=p_note where id=r.id;
  if c.action='amend' then
   -- Restore + submit + approve are one transaction. Any failure retains the old
   -- approval, balance, attendance and pending change without partial writes.
   -- Intake checked the deadline. Do not retroactively recheck it at approval.
   perform public.private_submit_employee_leave(r.employee_uuid,r.submitted_by,c.id,jsonb_build_array(jsonb_build_object('date',c.new_work_date,'portion',c.new_portion)),null::date);
   update public.employee_leave_requests set modification_count=r.modification_count,replaces_request_id=r.id,
    admin_registration_note=r.admin_registration_note where id=c.id;
   perform public.review_employee_leave(c.id,'approved',p_note);
  end if;
 end if;
 update public.employee_leave_change_requests set status=p_decision,decided_by=auth.uid(),decided_at=now(),decision_note=p_note where id=c.id;
 perform public.private_append_audit(auth.uid(),'employee_leave_change_reviewed','employee',r.employee_uuid::text,'success',p_note,jsonb_build_object('change_id',c.id,'request_id',r.id,'decision',p_decision));
 return jsonb_build_object('ok',true,'status',p_decision);
end $$;

create or replace function public.admin_change_employee_leave(p_id uuid,p_request_id uuid,p_action text,p_new_work_date date,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.employee_leave_requests; c public.employee_leave_change_requests; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 if not public.private_leave_manager() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_action is null or p_action not in ('amend','cancel') or length(btrim(coalesce(p_note,''))) not between 2 and 300 then raise exception 'INVALID_REQUEST'; end if;
 select * into r from public.employee_leave_requests where id=p_request_id;
 if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
 perform 1 from public.employees where id=r.employee_uuid and archived_at is null and employment_status='active' for update;
 if not found then raise exception 'EMPLOYEE_NOT_ACTIVE'; end if;
 perform 1 from public.employee_leave_accounts where employee_uuid=r.employee_uuid for update;
 select * into r from public.employee_leave_requests where id=p_request_id for update;
 select * into c from public.employee_leave_change_requests where id=p_id;
 if found then
  if not c.manager_direct or c.submitted_by<>auth.uid() or c.request_id is distinct from p_request_id or c.action is distinct from p_action or c.new_work_date is distinct from p_new_work_date or c.reason is distinct from p_note then raise exception 'REQUEST_ID_CONFLICT'; end if;
  return public.private_review_employee_leave_change(p_id,'approved',p_note,true);
 end if;
 if r.status<>'approved' then raise exception 'LEAVE_NOT_APPROVED'; end if;
 if r.work_date<=today then raise exception 'LEAVE_ALREADY_STARTED'; end if;
 if exists(select 1 from public.employee_leave_change_requests where request_id=r.id and status='pending') then raise exception 'LEAVE_CHANGE_PENDING'; end if;
 if p_action='amend' then
  if p_new_work_date is null or p_new_work_date<public.private_employee_leave_earliest_date(today) then raise exception 'LEAVE_THREE_DAYS_REQUIRED'; end if;
  if p_new_work_date=r.work_date then raise exception 'LEAVE_CHANGE_UNCHANGED'; end if;
 elsif p_new_work_date is not null then raise exception 'INVALID_REQUEST'; end if;
 insert into public.employee_leave_change_requests(id,request_id,employee_uuid,action,new_work_date,new_portion,reason,submitted_by,manager_direct)
 values(p_id,r.id,r.employee_uuid,p_action,p_new_work_date,case when p_action='amend' then r.portion end,p_note,auth.uid(),true);
 -- Reuse the exact guarded atomic restoration/replacement. Only the manager's
 -- on-behalf submission check differs; self/position/confirmation guards remain.
 perform public.private_review_employee_leave_change(p_id,'approved',p_note,true);
 perform public.private_append_audit(auth.uid(),'employee_leave_manager_changed','employee',r.employee_uuid::text,'success',p_note,
  jsonb_build_object('change_id',p_id,'request_id',r.id,'action',p_action,'old_work_date',r.work_date,'new_work_date',p_new_work_date));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.admin_register_urgent_employee_leave(
 p_id uuid,p_employee_uuid uuid,p_work_date date,p_note text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 today date := (now() at time zone 'Asia/Seoul')::date;
 note text := btrim(coalesce(p_note,''));
 existing public.employee_leave_requests;
begin
 if not public.private_leave_manager() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_id is null or p_employee_uuid is null or p_work_date is null or length(note) not between 2 and 300 then
  raise exception 'INVALID_REQUEST';
 end if;

 -- Match the lock order of ordinary submission/approval.
 perform 1 from public.employees
 where id=p_employee_uuid and archived_at is null and employment_status='active'
  and (hired_on is null or hired_on<=today) and (departed_on is null or departed_on>p_work_date)
 for update;
 if not found then raise exception 'EMPLOYEE_NOT_ACTIVE'; end if;

 select * into existing from public.employee_leave_requests where id=p_id;
 if found then
  if existing.employee_uuid<>p_employee_uuid or existing.work_date<>p_work_date
   or existing.submitted_by<>auth.uid() or existing.admin_registration_note is distinct from note
   or existing.replaces_request_id is not null then
   raise exception 'REQUEST_ID_CONFLICT';
  end if;
  return jsonb_build_object('ok',true,'id',p_id,'status',existing.status);
 end if;

 if p_work_date<today or p_work_date>=public.private_employee_leave_earliest_date(today) then raise exception 'URGENT_LEAVE_DATE_REQUIRED'; end if;
 if exists(select 1 from public.employee_leave_requests
   where employee_uuid=p_employee_uuid and work_date=p_work_date and status in ('pending','approved')) then
  raise exception 'LEAVE_SCHEDULE_CONFLICT';
 end if;

 perform public.private_submit_employee_leave(p_employee_uuid,auth.uid(),p_id,
  jsonb_build_array(jsonb_build_object('date',p_work_date,'portion','full')),today,note);
 -- Approval already guards clock-in. Also reject an existing standalone clock-out.
 if public.private_attendance_effective_event(p_employee_uuid,p_work_date,'clock_out')->>'status' is not null then
  raise exception 'ATTENDANCE_CONFLICT';
 end if;
 perform public.review_employee_leave(p_id,'approved',note);
 perform public.private_append_audit(auth.uid(),'employee_leave_admin_registered','employee',
  p_employee_uuid::text,'success',note,jsonb_build_object('request_id',p_id,'work_date',p_work_date));
 return jsonb_build_object('ok',true,'id',p_id,'status','approved');
end $$;

notify pgrst,'reload schema';
commit;
