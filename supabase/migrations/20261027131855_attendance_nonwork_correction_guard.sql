-- Non-work statuses intentionally suppress effective timestamps. Reject a time
-- correction before appending an unusable ledger entry; never change day status.
-- Eligibility/off cases retain the existing private writer's validation contract.
begin;
create or replace function public.create_attendance_correction(
  p_employee_uuid uuid,
  p_work_date date,
  p_event_type text,
  p_action text,
  p_corrected_event_at timestamptz default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('attendance.correct') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_work_date is not null and exists (
    select 1 from public.employees e where e.id = p_employee_uuid
  ) and coalesce(public.private_attendance_effective_status(
    p_employee_uuid, p_work_date
  ) ->> 'status', 'work') in ('paid_leave', 'unpaid_absence', 'paid_holiday') then
    return jsonb_build_object('ok', false, 'code', 'DAY_STATUS_NOT_WORK');
  end if;
  return public.private_create_attendance_correction_pre148(
    p_employee_uuid, p_work_date, p_event_type, p_action,
    p_corrected_event_at, p_reason
  );
end;
$$;
alter function public.create_attendance_correction(uuid,date,text,text,timestamptz,text) owner to postgres;
revoke all on function public.create_attendance_correction(uuid,date,text,text,timestamptz,text) from public, anon;
grant execute on function public.create_attendance_correction(uuid,date,text,text,timestamptz,text) to authenticated;
commit;
