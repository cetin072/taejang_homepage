-- Issue #286 follow-up: distinguish time-confirmed rows from status-confirmed rows.
-- Only manual/effective-time corrections carry review_status='confirmed' and confirmed_hours.
-- Scheduled work / leave / absence / holiday are semantic day statuses and must not
-- be forced through the confirmed-hours preflight contract.

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

  select coalesce(jsonb_agg(jsonb_build_object(
    'attendance_row_id',record.id,
    'source_key','confirmed:'||rev.id::text||':'||record.id::text,
    'employee_uuid',record.employee_uuid,
    'work_date',record.work_date,
    'scheduled_hours',term.daily_scheduled_hours,
    'match_status','matched',
    'record_status','confirmed_immutable',
    'auto_decision',coalesce(
      nullif(record.record_snapshot ->> 'payroll_decision',''),
      case coalesce(record.record_snapshot ->> 'attendance_status','work')
        when 'paid_leave' then 'paid_leave'
        when 'unpaid_absence' then 'unpaid_absence'
        when 'paid_holiday' then 'paid_holiday'
        when 'off' then 'out_of_scope'
        else 'confirmed_correction'
      end
    ),
    'exception_type',null,
    'review_status',case
      when coalesce(record.record_snapshot ->> 'payroll_decision','') = 'confirmed_correction'
        then 'confirmed'
      else 'status_confirmed'
    end,
    'confirmed_hours',case
      when coalesce(record.record_snapshot ->> 'payroll_decision','') = 'confirmed_correction'
        and record.clock_in_at is not null
        and record.clock_out_at is not null
        and record.clock_out_at > record.clock_in_at
      then round((extract(epoch from (record.clock_out_at-record.clock_in_at))/3600)::numeric,2)
      else null
    end,
    'confirmation_revision_id',rev.id,
    'record_fingerprint',record.record_fingerprint,
    'attendance_status',coalesce(record.record_snapshot ->> 'attendance_status','work')
  ) order by record.work_date,record.employee_uuid::text,record.id::text),'[]'::jsonb)
  into attendance_json
  from public.attendance_confirmed_records record
  join public.attendance_confirmation_revisions rev on rev.id=record.confirmation_revision_id
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
    );

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
