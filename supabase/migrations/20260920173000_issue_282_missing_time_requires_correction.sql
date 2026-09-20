-- Issue #282: missing clock times are facts, not acknowledgement-only exceptions.
-- A lead must record the actual missing clock-in/clock-out through the append-only
-- attendance correction path before daily confirmation can proceed.

begin;

create or replace function public.resolve_attendance_confirmation_exception(
  p_work_date date,
  p_exception_key text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  blocker jsonb;
  created public.attendance_confirmation_exception_resolutions%rowtype;
  normalized_reason text := btrim(coalesce(p_reason, ''));
begin
  if actor_id is null or not public.private_actor_can('attendance.confirm') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_work_date is null then
    return jsonb_build_object('ok', false, 'code', 'WORK_DATE_REQUIRED');
  end if;
  if public.private_attendance_day_is_confirmed(p_work_date) then
    return jsonb_build_object('ok', false, 'code', 'DAY_CONFIRMED_REOPEN_REQUIRED');
  end if;
  if p_exception_key !~ '^[0-9a-f]{64}$' or char_length(normalized_reason) not between 5 and 300 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_RESOLUTION');
  end if;

  select item into blocker
  from jsonb_array_elements(public.private_attendance_confirmation_blockers(p_work_date)) item
  where item ->> 'key' = p_exception_key
  limit 1;

  if blocker is null then
    return jsonb_build_object('ok', false, 'code', 'EXCEPTION_NOT_FOUND');
  end if;

  if blocker ->> 'type' in ('missing_clock_in', 'missing_clock_out') then
    return jsonb_build_object(
      'ok', false,
      'code', 'MISSING_TIME_REQUIRES_CORRECTION',
      'employee_uuid', blocker ->> 'employee_uuid',
      'event_type', case
        when blocker ->> 'type' = 'missing_clock_in' then 'clock_in'
        else 'clock_out'
      end
    );
  end if;

  insert into public.attendance_confirmation_exception_resolutions(
    work_date, exception_key, employee_uuid, exception_type, evidence_context, reason, resolved_by
  ) values (
    p_work_date,
    p_exception_key,
    nullif(blocker ->> 'employee_uuid', '')::uuid,
    blocker ->> 'type',
    blocker -> 'evidence_context',
    normalized_reason,
    actor_id
  ) returning * into created;

  perform public.private_append_audit(
    actor_id, 'attendance_confirmation_exception_resolved',
    'attendance_confirmation_exception_resolution', created.id::text,
    'success', '일일 근태 확정 예외 해소',
    jsonb_build_object(
      'work_date', p_work_date,
      'exception_key', p_exception_key,
      'exception_type', blocker ->> 'type'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'EXCEPTION_RESOLVED',
    'resolution_id', created.id
  );
end;
$$;

comment on function public.resolve_attendance_confirmation_exception(date,text,text) is
  'Judgment-type attendance confirmation exceptions may be acknowledged with a reason. Missing clock-in/out must be corrected with an actual time first.';

commit;
