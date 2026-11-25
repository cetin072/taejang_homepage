begin;
-- Approved 2026-11-04: operations managers may review their own leave.
-- Existing active-profile/capability guards, balance rules, locks and audit stay in place.

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
 if not public.current_user_has_role('operations_manager') and (r.submitted_by=auth.uid() or r.employee_uuid=public.private_leave_employee()) then raise exception 'SELF_APPROVAL_FORBIDDEN'; end if;
 if p_decision is null or p_decision not in ('approved','rejected') or length(btrim(coalesce(p_note,''))) not between 2 and 300 then raise exception 'DECISION_REQUIRED'; end if;
 if not public.current_user_has_role('operations_manager') and (
  public.private_employee_is_protected(r.employee_uuid) or not exists (
   select 1 from public.employees e where e.id=r.employee_uuid
    and public.private_team_lead_can_assign_position(e.position_id)
  )
 ) then raise exception 'PROTECTED_EMPLOYEE_REVIEW_REQUIRED'; end if;
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

create or replace function public.review_employee_leave_change(p_change_id uuid,p_decision text,p_note text) returns jsonb
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
 if not public.current_user_has_role('operations_manager') and (c.submitted_by=auth.uid() or r.employee_uuid=public.private_leave_employee()) then raise exception 'SELF_APPROVAL_FORBIDDEN'; end if;
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
   perform public.private_submit_employee_leave(r.employee_uuid,r.submitted_by,c.id,jsonb_build_array(jsonb_build_object('date',c.new_work_date,'portion',c.new_portion)),(c.created_at at time zone 'Asia/Seoul')::date);
   update public.employee_leave_requests set modification_count=r.modification_count,replaces_request_id=r.id where id=c.id;
   perform public.review_employee_leave(c.id,'approved',p_note);
  end if;
 end if;
 update public.employee_leave_change_requests set status=p_decision,decided_by=auth.uid(),decided_at=now(),decision_note=p_note where id=c.id;
 perform public.private_append_audit(auth.uid(),'employee_leave_change_reviewed','employee',r.employee_uuid::text,'success',p_note,jsonb_build_object('change_id',c.id,'request_id',r.id,'decision',p_decision));
 return jsonb_build_object('ok',true,'status',p_decision);
end $$;

-- CREATE OR REPLACE preserves the existing authenticated-only RPC grants.
notify pgrst, 'reload schema';
commit;
