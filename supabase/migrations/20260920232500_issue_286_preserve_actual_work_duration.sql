-- Issue #286 follow-up: preserve real worked duration when complete clock evidence exists.
-- Operator-directed blank/missing-time historical rows remain scheduled work without
-- fabricating timestamps; complete confirmed work rows keep their actual duration.

begin;

create or replace function public.private_build_payroll_calculation_input(
  p_payroll_month date,
  p_cutoff_date date,
  p_expected_batch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb;
  attendance_json jsonb;
  boundary_start date;
  fingerprint text;
begin
  base := public.private_build_payroll_calculation_input_pre286(
    p_payroll_month,p_cutoff_date,p_expected_batch_id
  );
  boundary_start := (base #>> '{input_window,boundary_start}')::date;

  with effective_records as (
    select
      record.id,
      record.employee_uuid,
      record.work_date,
      record.clock_in_at,
      record.clock_out_at,
      record.record_fingerprint,
      record.record_snapshot,
      rev.id as revision_id,
      term.daily_scheduled_hours,
      case
        when coalesce(record.record_snapshot ->> 'attendance_status','work') = 'paid_leave'
          then 'paid_leave'
        when coalesce(record.record_snapshot ->> 'attendance_status','work') = 'unpaid_absence'
          then 'unpaid_absence'
        when coalesce(record.record_snapshot ->> 'attendance_status','work') = 'paid_holiday'
          then 'paid_holiday'
        when coalesce(record.record_snapshot ->> 'attendance_status','work') = 'off'
          then 'out_of_scope'
        when coalesce(record.record_snapshot ->> 'attendance_status','work') = 'work'
          and coalesce(record.record_snapshot ->> 'payroll_decision','') = 'confirmed_correction'
          and record.clock_in_at is not null
          and record.clock_out_at is not null
          and record.clock_out_at > record.clock_in_at
          then 'confirmed_correction'
        when coalesce(record.record_snapshot ->> 'attendance_status','work') = 'work'
          and coalesce(record.record_snapshot ->> 'historical_default_present','false') <> 'true'
          and record.clock_in_at is not null
          and record.clock_out_at is not null
          and record.clock_out_at > record.clock_in_at
          then 'actual_worked'
        when coalesce(record.record_snapshot ->> 'attendance_status','work') = 'work'
          then 'actual_scheduled'
        else 'out_of_scope'
      end as effective_decision
    from public.attendance_confirmed_records record
    join public.attendance_confirmation_revisions rev
      on rev.id=record.confirmation_revision_id
    left join lateral (
      select t.daily_scheduled_hours
      from public.payroll_employment_terms t
      where t.employee_uuid=record.employee_uuid
        and t.effective_from<=record.work_date
        and (t.effective_to is null or t.effective_to>=record.work_date)
      order by t.effective_from desc,t.id desc
      limit 1
    ) term on true
    where record.work_date between boundary_start and p_cutoff_date
      and not exists(
        select 1 from public.attendance_confirmation_reopens ro
        where ro.confirmation_revision_id=rev.id
      )
      and exists(
        select 1
        from jsonb_array_elements(base -> 'employees') e
        where e ->> 'employee_uuid'=record.employee_uuid::text
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'attendance_row_id',r.id,
    'source_key','confirmed:'||r.revision_id::text||':'||r.id::text,
    'employee_uuid',r.employee_uuid,
    'work_date',r.work_date,
    'scheduled_hours',r.daily_scheduled_hours,
    'match_status','matched',
    'record_status','confirmed_immutable',
    'auto_decision',r.effective_decision,
    'exception_type',null,
    'review_status',case
      when r.effective_decision in ('confirmed_correction','actual_worked')
        then 'confirmed'
      else 'status_confirmed'
    end,
    'confirmed_hours',case
      when r.effective_decision in ('confirmed_correction','actual_worked')
      then round((extract(epoch from (r.clock_out_at-r.clock_in_at))/3600)::numeric,2)
      else null
    end,
    'confirmation_revision_id',r.revision_id,
    'record_fingerprint',r.record_fingerprint,
    'attendance_status',coalesce(r.record_snapshot ->> 'attendance_status','work')
  ) order by r.work_date,r.employee_uuid::text,r.id::text),'[]'::jsonb)
  into attendance_json
  from effective_records r;

  fingerprint := encode(extensions.digest(attendance_json::text,'sha256'),'hex');
  base := jsonb_set(base,'{attendance}',attendance_json,true);
  base := jsonb_set(
    base,
    '{confirmed_attendance}',
    jsonb_build_object(
      'readiness_fingerprint', base #>> '{confirmed_attendance,readiness_fingerprint}',
      'attendance_fingerprint', fingerprint
    ),
    true
  );
  base := jsonb_set(base,'{input_basis_version}',to_jsonb('payroll-db-input-v6-confirmed-status'::text),true);
  base := base - 'input_basis_fingerprint';
  return base || jsonb_build_object(
    'input_basis_fingerprint',encode(extensions.digest(base::text,'sha256'),'hex')
  );
end;
$$;

revoke all on function public.private_build_payroll_calculation_input(date,date,uuid)
from public, anon, authenticated, service_role;

commit;
