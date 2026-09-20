-- Issue #286 follow-up: historical final confirmations supersede obsolete raw-evidence blockers.
begin;

create or replace function public.private_payroll_confirmed_attendance_readiness(
  p_payroll_month date,
  p_cutoff_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb;
  blockers jsonb;
begin
  base := public.private_payroll_confirmed_attendance_readiness_pre286(
    p_payroll_month,p_cutoff_date
  );

  select coalesce(
    jsonb_agg(item order by item ->> 'work_date', item ->> 'employee_uuid', item ->> 'code'),
    '[]'::jsonb
  )
  into blockers
  from jsonb_array_elements(coalesce(base -> 'blockers','[]'::jsonb)) item
  where not (
    item ->> 'code' = 'confirmed_duration_invalid'
    and exists (
      select 1
      from public.attendance_confirmation_revisions rev
      join public.attendance_confirmed_records record
        on record.confirmation_revision_id = rev.id
      where rev.work_date = (item ->> 'work_date')::date
        and record.employee_uuid = nullif(item ->> 'employee_uuid','')::uuid
        and not exists (
          select 1
          from public.attendance_confirmation_reopens ro
          where ro.confirmation_revision_id = rev.id
        )
        and (
          coalesce(record.record_snapshot ->> 'attendance_status','work') <> 'work'
          or (
            coalesce(record.record_snapshot ->> 'payroll_decision','') = 'actual_scheduled'
            and coalesce(record.record_snapshot ->> 'historical_default_present','false') = 'true'
          )
        )
    )
  )
  and not (
    item ->> 'code' = 'attendance_exception_unresolved'
    and exists (
      select 1
      from public.attendance_confirmation_revisions rev
      join public.attendance_confirmed_records record
        on record.confirmation_revision_id = rev.id
      where rev.work_date = (item ->> 'work_date')::date
        and not exists (
          select 1
          from public.attendance_confirmation_reopens ro
          where ro.confirmation_revision_id = rev.id
        )
        and record.record_snapshot ? 'historical_source'
        and (
          coalesce(record.record_snapshot ->> 'historical_default_present','false') = 'true'
          or coalesce(record.record_snapshot #>> '{historical_source,source_fingerprint}','') <> ''
        )
    )
  );

  return jsonb_build_object(
    'payroll_month', base ->> 'payroll_month',
    'cutoff_date', base ->> 'cutoff_date',
    'boundary_start', base ->> 'boundary_start',
    'ready', jsonb_array_length(blockers) = 0,
    'blockers', blockers,
    'readiness_fingerprint', encode(extensions.digest(blockers::text,'sha256'),'hex')
  );
end;
$$;

revoke all on function public.private_payroll_confirmed_attendance_readiness(date,date)
from public,anon,authenticated;

commit;
