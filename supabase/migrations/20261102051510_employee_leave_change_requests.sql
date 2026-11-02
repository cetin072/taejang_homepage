-- PR #573: employee change request -> manager review -> atomic attendance/balance update.
begin;
alter table public.employee_leave_requests add column modification_count smallint not null default 0 check(modification_count between 0 and 1);
alter table public.employee_leave_requests add column replaces_request_id uuid references public.employee_leave_requests(id);
create table public.employee_leave_change_requests (
 id uuid primary key,
 request_id uuid not null references public.employee_leave_requests(id),
 employee_uuid uuid not null references public.employees(id),
 action text not null check(action in ('cancel','amend')),
 new_work_date date, new_portion text check(new_portion in ('full','first_half','second_half')),
 reason text not null check(length(btrim(reason)) between 2 and 300),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 submitted_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 decided_by uuid references public.profiles(id), decided_at timestamptz, decision_note text,
 check((action='cancel' and new_work_date is null and new_portion is null) or (action='amend' and new_work_date is not null and new_portion is not null))
);
create unique index employee_leave_one_pending_change on public.employee_leave_change_requests(request_id) where status='pending';
create index employee_leave_changes_employee on public.employee_leave_change_requests(employee_uuid,created_at desc);
alter table public.employee_leave_change_requests enable row level security;
revoke all on public.employee_leave_change_requests from public,anon,authenticated;
create function public.private_submit_employee_leave(p_employee uuid,p_submitter uuid,p_id uuid,p_days jsonb,p_requested_on date) returns jsonb language plpgsql security definer set search_path='' as $$
declare e uuid:=p_employee; item jsonb; d date; portion text; units numeric; total numeric:=0; s jsonb; b jsonb; old public.employee_leave_requests;
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
 for item in select value from jsonb_array_elements(p_days) order by value->>'date' loop
  d:=(item->>'date')::date; portion:=item->>'portion';
  perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:'||d::text,0));
  if d is null or d<p_requested_on+3 then raise exception 'LEAVE_THREE_DAYS_REQUIRED'; end if;
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
  insert into public.employee_leave_requests(id,employee_uuid,work_date,portion,units,term_id,leave_minutes,submitted_by,request_payload)
  values(case when item=p_days->0 then p_id else md5(p_id::text||':'||d::text)::uuid end,e,d,portion,units,(s->>'term_id')::uuid,(s->>'scheduled_minutes')::numeric*units,p_submitter,case when item=p_days->0 then p_days else null end);
 end loop;
 perform public.private_append_audit(auth.uid(),'employee_leave_submitted','employee',e::text,'success','직원앱 연차 신청',jsonb_build_object('batch_id',p_id,'units',total));
 return jsonb_build_object('ok',true,'id',p_id);
end $$;

create or replace function public.submit_my_leave_request(p_id uuid,p_days jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return public.private_submit_employee_leave(public.private_leave_employee(),auth.uid(),p_id,p_days,(now() at time zone 'Asia/Seoul')::date);
end $$;
create or replace function public.review_employee_leave(p_request_id uuid,p_decision text,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.employee_leave_requests; b jsonb; change_id uuid; attendance_duty boolean; begin
 if not public.private_leave_manager() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into r from public.employee_leave_requests where id=p_request_id;
 if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
 perform 1 from public.employees where id=r.employee_uuid for update;
 perform 1 from public.employee_leave_accounts where employee_uuid=r.employee_uuid for update;
 perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:'||r.work_date::text,0));
 select * into r from public.employee_leave_requests where id=p_request_id for update;
 if exists(select 1 from public.employee_leave_change_requests where request_id=r.id and status='pending') then raise exception 'LEAVE_CHANGE_PENDING'; end if;
 if r.status<>'pending' then return jsonb_build_object('ok',true,'status',r.status); end if;
 if r.submitted_by=auth.uid() or r.employee_uuid=public.private_leave_employee() then raise exception 'SELF_APPROVAL_FORBIDDEN'; end if;
 if p_decision is null or p_decision not in ('approved','rejected') or length(btrim(coalesce(p_note,''))) not between 2 and 300 then raise exception 'DECISION_REQUIRED'; end if;
 if public.current_user_has_role('promotion_lead') and not public.current_user_has_role('operations_manager') and public.private_employee_is_protected(r.employee_uuid) then raise exception 'PROTECTED_EMPLOYEE_REVIEW_REQUIRED'; end if;
 select attendance_required into attendance_duty from public.employees where id=r.employee_uuid;
 if p_decision='approved' then
  if r.work_date<(now() at time zone 'Asia/Seoul')::date then raise exception 'PAST_LEAVE_REVIEW_REQUIRED'; end if;
  if public.private_attendance_day_is_confirmed(r.work_date) then raise exception 'DAY_CONFIRMED_REOPEN_REQUIRED'; end if;
  if (attendance_duty and (public.private_attendance_effective_status(r.employee_uuid,r.work_date)->>'status'<>'work'
   or public.private_attendance_effective_event(r.employee_uuid,r.work_date,'clock_in')->>'status' is not null))
   or not coalesce((public.private_employee_schedule(r.employee_uuid,r.work_date)->>'is_workday')::boolean,false) then raise exception 'ATTENDANCE_CONFLICT'; end if;
  b:=public.private_employee_leave_balance(r.employee_uuid);
  if (b->>'remaining')::numeric<r.units then raise exception 'INSUFFICIENT_LEAVE'; end if;
  if r.portion='full' and attendance_duty then
   insert into public.attendance_day_status_changes(employee_uuid,work_date,attendance_status,note,reason,changed_by,changed_at)
   values(r.employee_uuid,r.work_date,'paid_leave','승인 연차','연차 신청 승인',auth.uid(),clock_timestamp()) returning id into change_id;
  end if;
  insert into public.employee_leave_ledger(employee_uuid,kind,entry_key,delta,request_id,note,actor_id)
   values(r.employee_uuid,'use','use:'||r.id,-r.units,r.id,'승인 연차 사용',auth.uid());
 end if;
 update public.employee_leave_requests set status=p_decision,decided_by=auth.uid(),decided_at=now(),decision_note=p_note,attendance_change_id=change_id where id=r.id;
 perform public.private_append_audit(auth.uid(),'employee_leave_reviewed','employee',r.employee_uuid::text,'success',p_note,jsonb_build_object('request_id',r.id,'decision',p_decision));
 return jsonb_build_object('ok',true,'status',p_decision);
end $$;

-- Pending edits are atomic replacements with no modification-count limit.
create function public.edit_my_pending_leave(p_request_id uuid,p_id uuid,p_work_date date,p_portion text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e uuid:=public.private_leave_employee(); r public.employee_leave_requests; replacement public.employee_leave_requests; day date; payload jsonb:=jsonb_build_array(jsonb_build_object('date',p_work_date,'portion',p_portion));
begin
 if e is null then raise exception 'EMPLOYEE_LINK_REQUIRED' using errcode='42501'; end if;
 perform 1 from public.employees where id=e for update;
 perform 1 from public.employee_leave_accounts where employee_uuid=e for update;
 select * into replacement from public.employee_leave_requests where id=p_id;
 if found then
  if replacement.employee_uuid<>e or replacement.replaces_request_id is distinct from p_request_id or replacement.request_payload is distinct from payload then raise exception 'REQUEST_ID_CONFLICT'; end if;
  return jsonb_build_object('ok',true,'already_submitted',true);
 end if;
 select * into r from public.employee_leave_requests where id=p_request_id and employee_uuid=e for update;
 if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
 if r.status<>'pending' then raise exception 'LEAVE_NOT_PENDING'; end if;
 for day in select distinct d from unnest(array[r.work_date,p_work_date]) d where d is not null order by d loop
  perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:'||day::text,0));
  if public.private_attendance_day_is_confirmed(day) then raise exception 'DAY_CONFIRMED_REOPEN_REQUIRED'; end if;
 end loop;
 update public.employee_leave_requests set status='cancelled',decided_by=auth.uid(),decided_at=now(),decision_note='승인 전 신청 수정' where id=r.id;
 perform public.private_submit_employee_leave(e,auth.uid(),p_id,payload,(now() at time zone 'Asia/Seoul')::date);
 update public.employee_leave_requests set replaces_request_id=r.id where id=p_id;
 perform public.private_append_audit(auth.uid(),'employee_pending_leave_edited','employee',e::text,'success','승인 전 신청 수정',jsonb_build_object('old_request_id',r.id,'new_request_id',p_id));
 return jsonb_build_object('ok',true);
end $$;
create function public.request_my_leave_change(p_id uuid,p_request_id uuid,p_action text,p_new_work_date date,p_new_portion text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e uuid:=public.private_leave_employee(); r public.employee_leave_requests; c public.employee_leave_change_requests; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 if e is null then raise exception 'EMPLOYEE_LINK_REQUIRED' using errcode='42501'; end if;
 if p_id is null then raise exception 'INVALID_REQUEST'; end if;
 perform 1 from public.employees where id=e for update;
 perform 1 from public.employee_leave_accounts where employee_uuid=e for update;
 select * into c from public.employee_leave_change_requests where id=p_id;
 if found then
  if c.employee_uuid<>e or c.request_id is distinct from p_request_id or c.action is distinct from p_action or c.new_work_date is distinct from p_new_work_date or c.new_portion is distinct from p_new_portion or c.reason is distinct from p_reason then raise exception 'REQUEST_ID_CONFLICT'; end if;
  return jsonb_build_object('ok',true,'already_submitted',true);
 end if;
 select * into r from public.employee_leave_requests where id=p_request_id and employee_uuid=e for update;
 if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
 if r.status<>'approved' then raise exception 'LEAVE_NOT_APPROVED'; end if;
 if r.work_date<=today then raise exception 'LEAVE_ALREADY_STARTED'; end if;
 if exists(select 1 from public.employee_leave_change_requests where request_id=r.id and status='pending') then raise exception 'LEAVE_CHANGE_PENDING'; end if;
 if p_action is null or p_action not in ('cancel','amend') or length(btrim(coalesce(p_reason,''))) not between 2 and 300 then raise exception 'INVALID_REQUEST'; end if;
 if p_action='amend' then
  if r.modification_count>=1 then raise exception 'LEAVE_MODIFICATION_LIMIT'; end if;
  if p_new_work_date is null or p_new_work_date<today+3 then raise exception 'LEAVE_THREE_DAYS_REQUIRED'; end if;
  if p_new_portion is null or p_new_portion not in ('full','first_half','second_half') then raise exception 'INVALID_PORTION'; end if;
  if p_new_work_date=r.work_date and p_new_portion=r.portion then raise exception 'LEAVE_CHANGE_UNCHANGED'; end if;
  update public.employee_leave_requests set modification_count=modification_count+1 where id=r.id;
 elsif p_new_work_date is not null or p_new_portion is not null then raise exception 'INVALID_REQUEST';
 end if;
 insert into public.employee_leave_change_requests(id,request_id,employee_uuid,action,new_work_date,new_portion,reason,submitted_by)
 values(p_id,r.id,e,p_action,p_new_work_date,p_new_portion,p_reason,auth.uid());
 perform public.private_append_audit(auth.uid(),'employee_leave_change_requested','employee',e::text,'success',p_reason,jsonb_build_object('change_id',p_id,'request_id',r.id,'action',p_action));
 return jsonb_build_object('ok',true);
end $$;
create function public.review_employee_leave_change(p_change_id uuid,p_decision text,p_note text) returns jsonb
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
 if c.submitted_by=auth.uid() or r.employee_uuid=public.private_leave_employee() then raise exception 'SELF_APPROVAL_FORBIDDEN'; end if;
 if public.current_user_has_role('promotion_lead') and not public.current_user_has_role('operations_manager') and public.private_employee_is_protected(r.employee_uuid) then raise exception 'PROTECTED_EMPLOYEE_REVIEW_REQUIRED'; end if;
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
   perform public.private_submit_employee_leave(r.employee_uuid,r.submitted_by,c.id,jsonb_build_array(jsonb_build_object('date',c.new_work_date,'portion',c.new_portion)),(c.created_at at time zone 'Asia/Seoul')::date);
   update public.employee_leave_requests set modification_count=r.modification_count,replaces_request_id=r.id where id=c.id;
   perform public.review_employee_leave(c.id,'approved',p_note);
  end if;
 end if;
 update public.employee_leave_change_requests set status=p_decision,decided_by=auth.uid(),decided_at=now(),decision_note=p_note where id=c.id;
 perform public.private_append_audit(auth.uid(),'employee_leave_change_reviewed','employee',r.employee_uuid::text,'success',p_note,jsonb_build_object('change_id',c.id,'request_id',r.id,'decision',p_decision));
 return jsonb_build_object('ok',true,'status',p_decision);
end $$;
-- Guarded projections extend existing API contracts; no raw table access.
alter function public.get_my_leave_context() rename to private_get_my_leave_context_pre573;
create function public.get_my_leave_context() returns jsonb language plpgsql security definer set search_path='' as $$
declare e uuid:=public.private_leave_employee(); b jsonb; begin
 b:=public.private_get_my_leave_context_pre573();
 return b||jsonb_build_object('change_requests',coalesce((select jsonb_agg(to_jsonb(c) order by created_at desc) from (select id,request_id,action,new_work_date,new_portion,reason,status,decision_note,created_at from public.employee_leave_change_requests where employee_uuid=e order by created_at desc limit 100) c),'[]'::jsonb),
 'requests',coalesce((select jsonb_agg(to_jsonb(r) order by work_date desc) from (select id,work_date,portion,units,status,modification_count,replaces_request_id from public.employee_leave_requests where employee_uuid=e order by work_date desc limit 100) r),'[]'::jsonb));
end $$;
alter function public.get_employee_leave_admin_context(uuid) rename to private_get_employee_leave_admin_context_pre573;
create function public.get_employee_leave_admin_context(p_employee_uuid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; begin
 b:=public.private_get_employee_leave_admin_context_pre573(p_employee_uuid);
 return b||jsonb_build_object('change_requests',coalesce((select jsonb_agg(to_jsonb(c) order by created_at desc) from
 (select c.*,p.full_name as employee_name,r.work_date as original_work_date,r.portion as original_portion from public.employee_leave_change_requests c join public.employee_leave_requests r on r.id=c.request_id join public.employees e on e.id=c.employee_uuid join public.people p on p.id=e.person_id where p_employee_uuid is null or c.employee_uuid=p_employee_uuid order by c.created_at desc limit 300) c),'[]'::jsonb));
end $$;
revoke all on function public.private_submit_employee_leave(uuid,uuid,uuid,jsonb,date),public.private_get_my_leave_context_pre573(),public.private_get_employee_leave_admin_context_pre573(uuid) from public,anon,authenticated;
revoke all on function public.edit_my_pending_leave(uuid,uuid,date,text),public.request_my_leave_change(uuid,uuid,text,date,text,text),public.review_employee_leave_change(uuid,text,text),public.get_my_leave_context(),public.get_employee_leave_admin_context(uuid) from public,anon,authenticated;
grant execute on function public.edit_my_pending_leave(uuid,uuid,date,text),public.request_my_leave_change(uuid,uuid,text,date,text,text),public.review_employee_leave_change(uuid,text,text),public.get_my_leave_context(),public.get_employee_leave_admin_context(uuid) to authenticated;
commit;
