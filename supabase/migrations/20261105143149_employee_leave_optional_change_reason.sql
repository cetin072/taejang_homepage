-- Employee leave reasons are optional; retain prior notes and all approval guards.
begin;
alter table public.employee_leave_change_requests drop constraint employee_leave_change_requests_reason_check;
alter table public.employee_leave_change_requests add constraint employee_leave_change_requests_reason_check check(length(btrim(reason)) <= 300);
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
  if c.employee_uuid<>e or c.request_id is distinct from p_request_id or c.action is distinct from p_action or c.new_work_date is distinct from p_new_work_date or c.new_portion is distinct from p_new_portion or c.reason is distinct from coalesce(p_reason,'') then raise exception 'REQUEST_ID_CONFLICT'; end if;
  return jsonb_build_object('ok',true,'already_submitted',true);
 end if;
 select * into r from public.employee_leave_requests where id=p_request_id and employee_uuid=e for update;
 if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
 if r.status<>'approved' then raise exception 'LEAVE_NOT_APPROVED'; end if;
 if r.work_date<=today then raise exception 'LEAVE_ALREADY_STARTED'; end if;
 if exists(select 1 from public.employee_leave_change_requests where request_id=r.id and status='pending') then raise exception 'LEAVE_CHANGE_PENDING'; end if;
 if p_action is null or p_action not in ('cancel','amend') or length(btrim(coalesce(p_reason,''))) > 300 then raise exception 'INVALID_REQUEST'; end if;
 if p_action='amend' then
  if r.modification_count>=1 then raise exception 'LEAVE_MODIFICATION_LIMIT'; end if;
  if p_new_work_date is null or p_new_work_date<today+3 then raise exception 'LEAVE_THREE_DAYS_REQUIRED'; end if;
  if p_new_portion is null or p_new_portion not in ('full','first_half','second_half') then raise exception 'INVALID_PORTION'; end if;
  if p_new_work_date=r.work_date and p_new_portion=r.portion then raise exception 'LEAVE_CHANGE_UNCHANGED'; end if;
  update public.employee_leave_requests set modification_count=modification_count+1 where id=r.id;
 elsif p_new_work_date is not null or p_new_portion is not null then raise exception 'INVALID_REQUEST';
 end if;
 insert into public.employee_leave_change_requests(id,request_id,employee_uuid,action,new_work_date,new_portion,reason,submitted_by)
 values(p_id,r.id,e,p_action,p_new_work_date,p_new_portion,coalesce(p_reason,''),auth.uid());
 perform public.private_append_audit(auth.uid(),'employee_leave_change_requested','employee',e::text,'success',coalesce(nullif(btrim(p_reason),''),case p_action when 'cancel' then '직원 연차 취소 요청' else '직원 연차 수정 요청' end),jsonb_build_object('change_id',p_id,'request_id',r.id,'action',p_action));
 return jsonb_build_object('ok',true);
end $$;

-- Keep the existing RPC signature and explicit access boundary for older app versions.
revoke all on function public.request_my_leave_change(uuid,uuid,text,date,text,text) from public,anon,authenticated;
grant execute on function public.request_my_leave_change(uuid,uuid,text,date,text,text) to authenticated;
commit;
