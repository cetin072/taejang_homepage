-- Issue #249: promotion lead owns daily attendance correction in the new Phase 1 flow.
-- Raw GPS evidence remains immutable. Missing effective times may be backfilled without
-- a user-entered reason; edits to an existing effective time and invalidations still require one.

begin;

insert into public.role_capability_grants(role_id, capability_code)
select r.id, 'attendance.correct'
from public.roles r
where r.code = 'promotion_lead'
  and r.active
on conflict (role_id, capability_code) do nothing;

create or replace function public.private_create_attendance_correction_pre148(
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
declare
  actor_id uuid := (select auth.uid());
  employee_row public.employees%rowtype;
  position_code text;
  current_value jsonb;
  counterpart jsonb;
  previous_correction_id uuid;
  created public.attendance_corrections%rowtype;
  raw_event_id uuid;
  original_event_at timestamptz;
  missing_effective_time boolean := false;
  normalized_reason text;
begin
  -- Public create_attendance_correction() owns the capability gate.
  -- Keep this private implementation non-executable by browser clients and
  -- retain only the active-account defense in depth here.
  if actor_id is null or not public.current_profile_is_active() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if p_work_date is null then
    return jsonb_build_object('ok', false, 'code', 'WORK_DATE_REQUIRED');
  end if;
  if p_event_type not in ('clock_in', 'clock_out') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_EVENT_TYPE');
  end if;
  if p_action not in ('set_time', 'invalidate') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CORRECTION_ACTION');
  end if;

  select * into employee_row
  from public.employees e
  where e.id = p_employee_uuid;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'EMPLOYEE_NOT_FOUND');
  end if;

  select pos.code into position_code
  from public.positions pos
  where pos.id = employee_row.position_id;

  if not employee_row.attendance_required
     or coalesce(position_code, '') in ('ceo', 'operations_manager')
     or exists (
       select 1
       from public.account_person_links apl
       join public.profile_roles pr on pr.profile_id = apl.profile_id and pr.revoked_at is null
       join public.roles r on r.id = pr.role_id and r.active
       where apl.person_id = employee_row.person_id
         and apl.revoked_at is null
         and r.code in ('ceo', 'operations_manager')
     ) then
    return jsonb_build_object('ok', false, 'code', 'ATTENDANCE_NOT_REQUIRED');
  end if;

  if p_work_date < employee_row.hired_on
     or (employee_row.departed_on is not null and p_work_date > employee_row.departed_on) then
    return jsonb_build_object('ok', false, 'code', 'OUTSIDE_EMPLOYMENT_PERIOD');
  end if;

  if p_action = 'set_time' then
    if p_corrected_event_at is null then
      return jsonb_build_object('ok', false, 'code', 'CORRECTED_TIME_REQUIRED');
    end if;
    if (p_corrected_event_at at time zone 'Asia/Seoul')::date <> p_work_date then
      return jsonb_build_object('ok', false, 'code', 'CORRECTED_TIME_DATE_MISMATCH');
    end if;
    if p_corrected_event_at > now() + interval '5 minutes' then
      return jsonb_build_object('ok', false, 'code', 'FUTURE_ATTENDANCE_TIME');
    end if;
  elsif p_corrected_event_at is not null then
    return jsonb_build_object('ok', false, 'code', 'INVALIDATED_TIME_MUST_BE_NULL');
  end if;

  current_value := public.private_attendance_effective_event(
    p_employee_uuid,
    p_work_date,
    p_event_type
  );
  missing_effective_time := current_value is null or current_value ->> 'event_at' is null;

  if p_action = 'set_time' and missing_effective_time then
    -- No operator-entered reason is required for a true missing time. The system
    -- still writes an explicit audit-friendly reason into the append-only ledger.
    normalized_reason := coalesce(
      nullif(btrim(coalesce(p_reason, '')), ''),
      '누락 근태 수기 입력'
    );
  else
    normalized_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if normalized_reason is null
       or char_length(normalized_reason) < 5
       or char_length(normalized_reason) > 300 then
      return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
    end if;
  end if;

  if char_length(normalized_reason) < 5 or char_length(normalized_reason) > 300 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  if p_action = 'invalidate'
     and missing_effective_time then
    return jsonb_build_object('ok', false, 'code', 'NOTHING_TO_INVALIDATE');
  end if;

  if p_action = 'set_time' and p_event_type = 'clock_out' then
    counterpart := public.private_attendance_effective_event(p_employee_uuid, p_work_date, 'clock_in');
    if counterpart is null or counterpart ->> 'event_at' is null then
      return jsonb_build_object('ok', false, 'code', 'CLOCK_IN_REQUIRED');
    end if;
    if p_corrected_event_at < (counterpart ->> 'event_at')::timestamptz then
      return jsonb_build_object('ok', false, 'code', 'CLOCK_OUT_BEFORE_CLOCK_IN');
    end if;
  elsif p_action = 'set_time' and p_event_type = 'clock_in' then
    counterpart := public.private_attendance_effective_event(p_employee_uuid, p_work_date, 'clock_out');
    if counterpart is not null and counterpart ->> 'event_at' is not null
       and p_corrected_event_at > (counterpart ->> 'event_at')::timestamptz then
      return jsonb_build_object('ok', false, 'code', 'CLOCK_IN_AFTER_CLOCK_OUT');
    end if;
  elsif p_action = 'invalidate' and p_event_type = 'clock_in' then
    counterpart := public.private_attendance_effective_event(p_employee_uuid, p_work_date, 'clock_out');
    if counterpart is not null and counterpart ->> 'event_at' is not null then
      return jsonb_build_object('ok', false, 'code', 'CLOCK_OUT_EXISTS');
    end if;
  end if;

  select c.id into previous_correction_id
  from public.attendance_corrections c
  where c.employee_uuid = p_employee_uuid
    and c.work_date = p_work_date
    and c.event_type = p_event_type
  order by c.created_at desc, c.id desc
  limit 1;

  if current_value ->> 'raw_event_id' is not null then
    raw_event_id := (current_value ->> 'raw_event_id')::uuid;
  end if;
  if current_value ->> 'event_at' is not null then
    original_event_at := (current_value ->> 'event_at')::timestamptz;
  end if;

  insert into public.attendance_corrections (
    employee_uuid,
    work_date,
    event_type,
    action,
    corrected_event_at,
    target_event_id,
    original_status,
    original_event_at,
    reason,
    supersedes_correction_id,
    created_by
  ) values (
    p_employee_uuid,
    p_work_date,
    p_event_type,
    p_action,
    case when p_action = 'set_time' then p_corrected_event_at else null end,
    raw_event_id,
    coalesce(current_value ->> 'status', 'missing'),
    original_event_at,
    normalized_reason,
    previous_correction_id,
    actor_id
  ) returning * into created;

  perform public.private_append_audit(
    actor_id,
    'attendance_correction_created',
    'attendance_correction',
    created.id::text,
    'success',
    case
      when p_action = 'set_time' and missing_effective_time then '누락 근태 수기 입력'
      else '근태 기록 보정'
    end,
    jsonb_build_object(
      'employee_uuid', p_employee_uuid,
      'work_date', p_work_date,
      'event_type', p_event_type,
      'action', p_action,
      'entry_mode', case
        when p_action = 'set_time' and missing_effective_time then 'manual_backfill'
        else 'correction'
      end,
      'target_event_id', raw_event_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'ATTENDANCE_CORRECTED',
    'mode', case
      when p_action = 'set_time' and missing_effective_time then 'manual_backfill'
      else 'correction'
    end,
    'correction_id', created.id,
    'effective', public.private_attendance_effective_event(p_employee_uuid, p_work_date, p_event_type)
  );
end;
$$;

revoke all on function public.private_create_attendance_correction_pre148(
  uuid,date,text,text,timestamptz,text
) from public, anon, authenticated;

comment on function public.private_create_attendance_correction_pre148(
  uuid,date,text,text,timestamptz,text
) is
  'Append-only attendance correction implementation. Public wrapper owns capability authorization; missing effective time uses automatic manual-backfill reason, while existing-time edits and invalidations require an operator reason.';

commit;
