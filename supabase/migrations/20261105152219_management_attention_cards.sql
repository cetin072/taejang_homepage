-- Read-only attention cards; independent from disabled attendance Push.
begin;
create function public.private_management_clock_in_attention(p_now timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
 with candidates as materialized (
  select e.id,e.employee_id,p.full_name,s.value as schedule
  from public.employees e join public.people p on p.id=e.person_id
  cross join lateral (select public.private_employee_schedule(e.id,(p_now at time zone 'Asia/Seoul')::date) as value) s
  where e.archived_at is null and e.employment_status='active' and e.attendance_required
   and coalesce((s.value->>'configured')::boolean,false) and coalesce((s.value->>'is_workday')::boolean,false)
   and public.private_attendance_effective_status(e.id,(p_now at time zone 'Asia/Seoul')::date)->>'status'='work'
   and public.private_attendance_effective_event(e.id,(p_now at time zone 'Asia/Seoul')::date,'clock_in')->>'event_at' is null
   and public.private_attendance_effective_event(e.id,(p_now at time zone 'Asia/Seoul')::date,'clock_in')->>'status' is null
 ) select jsonb_build_object(
  'missing',coalesce((select jsonb_agg(jsonb_build_object('employee_uuid',id,'employee_id',employee_id,'name',full_name,'starts_at',schedule->>'starts_at') order by schedule->>'starts_at',employee_id)
   from candidates where (schedule->>'starts_at')::timestamptz+interval '5 minutes'<=p_now),'[]'::jsonb),
  'next_due_at',(select min((schedule->>'starts_at')::timestamptz+interval '5 minutes') from candidates where (schedule->>'starts_at')::timestamptz+interval '5 minutes'>p_now));
$$;
create function public.get_management_attention_cards() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare attendance_allowed boolean; leave_allowed boolean; attention jsonb; pending jsonb;
begin
 if not public.current_profile_is_active() or not (public.current_user_has_role('operations_manager') or public.current_user_has_role('promotion_lead')) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 attendance_allowed:=public.private_actor_can('attendance.admin_view') and not public.private_menu_denied('attendance.view');
 leave_allowed:=public.private_leave_manager();
 if not attendance_allowed and not leave_allowed then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if attendance_allowed then attention:=public.private_management_clock_in_attention(now()); end if;
 if leave_allowed then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.work_date,q.employee_id,q.id),'[]'::jsonb) into pending from (
   select r.id,r.employee_uuid,e.employee_id,p.full_name as name,r.work_date,null::date as new_work_date,'application'::text as kind
   from public.employee_leave_requests r join public.employees e on e.id=r.employee_uuid join public.people p on p.id=e.person_id
   where r.status='pending' and e.archived_at is null and e.employment_status in ('active','leave')
    and (public.current_user_has_role('operations_manager') or (r.submitted_by<>auth.uid() and e.id is distinct from public.private_leave_employee() and not public.private_employee_is_protected(e.id) and public.private_team_lead_can_assign_position(e.position_id)))
   union all
   select c.id,c.employee_uuid,e.employee_id,p.full_name,r.work_date,c.new_work_date,c.action
   from public.employee_leave_change_requests c join public.employee_leave_requests r on r.id=c.request_id join public.employees e on e.id=c.employee_uuid join public.people p on p.id=e.person_id
   where c.status='pending' and e.archived_at is null and e.employment_status in ('active','leave')
    and (public.current_user_has_role('operations_manager') or (c.submitted_by<>auth.uid() and e.id is distinct from public.private_leave_employee() and not public.private_employee_is_protected(e.id) and public.private_team_lead_can_assign_position(e.position_id)))
  ) q;
 end if;
 return jsonb_build_object('server_now',now(),'work_date',(now() at time zone 'Asia/Seoul')::date,
  'attendance_allowed',attendance_allowed,'leave_allowed',leave_allowed,
  'missing_clock_ins',coalesce(attention->'missing','[]'::jsonb),'next_due_at',attention->'next_due_at','pending_leaves',coalesce(pending,'[]'::jsonb));
end $$;
revoke all on function public.private_management_clock_in_attention(timestamptz) from public,anon,authenticated;
revoke all on function public.get_management_attention_cards() from public,anon,authenticated;
grant execute on function public.get_management_attention_cards() to authenticated;
notify pgrst,'reload schema';
commit;
