-- Issue #148: capability-gate attendance administration without changing the
-- established #149 Employee/GPS/self-review/correction business rules.

begin;

alter function public.get_attendance_admin_today(date)
  rename to private_get_attendance_admin_today_pre148;
alter function public.review_attendance_exception(uuid, boolean)
  rename to private_review_attendance_exception_pre148;
alter function public.create_attendance_correction(uuid, date, text, text, timestamptz, text)
  rename to private_create_attendance_correction_pre148;
alter function public.get_attendance_correction_history(uuid, date)
  rename to private_get_attendance_correction_history_pre148;

revoke all on function public.private_get_attendance_admin_today_pre148(date)
  from public, anon, authenticated;
revoke all on function public.private_review_attendance_exception_pre148(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.private_create_attendance_correction_pre148(uuid, date, text, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.private_get_attendance_correction_history_pre148(uuid, date)
  from public, anon, authenticated;

create function public.get_attendance_admin_today(p_work_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('attendance.admin_view') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return public.private_get_attendance_admin_today_pre148(p_work_date);
end;
$$;

create function public.review_attendance_exception(
  p_event_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('attendance.exception_review') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  return public.private_review_attendance_exception_pre148(p_event_id, p_approve);
end;
$$;

create function public.create_attendance_correction(
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
  return public.private_create_attendance_correction_pre148(
    p_employee_uuid,
    p_work_date,
    p_event_type,
    p_action,
    p_corrected_event_at,
    p_reason
  );
end;
$$;

create function public.get_attendance_correction_history(
  p_employee_uuid uuid,
  p_work_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('attendance.admin_view') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return public.private_get_attendance_correction_history_pre148(p_employee_uuid, p_work_date);
end;
$$;

alter function public.get_attendance_admin_today(date) owner to postgres;
alter function public.review_attendance_exception(uuid, boolean) owner to postgres;
alter function public.create_attendance_correction(uuid, date, text, text, timestamptz, text) owner to postgres;
alter function public.get_attendance_correction_history(uuid, date) owner to postgres;

revoke all on function public.get_attendance_admin_today(date) from public, anon;
revoke all on function public.review_attendance_exception(uuid, boolean) from public, anon;
revoke all on function public.create_attendance_correction(uuid, date, text, text, timestamptz, text) from public, anon;
revoke all on function public.get_attendance_correction_history(uuid, date) from public, anon;

grant execute on function public.get_attendance_admin_today(date) to authenticated;
grant execute on function public.review_attendance_exception(uuid, boolean) to authenticated;
grant execute on function public.create_attendance_correction(uuid, date, text, text, timestamptz, text) to authenticated;
grant execute on function public.get_attendance_correction_history(uuid, date) to authenticated;

commit;
