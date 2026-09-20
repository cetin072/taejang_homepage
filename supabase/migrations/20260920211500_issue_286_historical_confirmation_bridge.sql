-- Issue #286 follow-up: historical final-workbook confirmations are authoritative
-- for their recorded date and should not be re-blocked by missing live GPS/fingerprint
-- evidence that did not exist in the legacy period.
begin;

create or replace function public.private_attendance_confirmation_blockers(p_work_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb;
  filtered jsonb;
  status_blockers jsonb;
begin
  base := public.private_attendance_confirmation_blockers_pre286(p_work_date);

  select coalesce(
    jsonb_agg(item order by item ->> 'display_name', item ->> 'type', item ->> 'key'),
    '[]'::jsonb
  )
  into filtered
  from jsonb_array_elements(base) item
  where not (
    nullif(item ->> 'employee_uuid','') is not null
    and not public.private_employee_is_attendance_subject_on(
      (item ->> 'employee_uuid')::uuid,
      p_work_date
    )
  )
  and not (
    nullif(item ->> 'employee_uuid','') is not null
    and item ->> 'type' in (
      'missing_clock_in','missing_clock_out','pending_gps_exception',
      'fingerprint_missing','fingerprint_ambiguous',
      'fingerprint_clock_in_missing','fingerprint_clock_out_missing',
      'clock_in_mismatch','clock_out_mismatch'
    )
    and exists (
      select 1
      from public.attendance_historical_rows h
      where h.work_date=p_work_date
        and h.employee_uuid=(item ->> 'employee_uuid')::uuid
        and h.parse_status='matched'
        and h.attendance_status in ('work','paid_leave','unpaid_absence','paid_holiday')
        and (
          h.attendance_status<>'work'
          or (
            h.clock_in_at is not null
            and h.clock_out_at is not null
            and h.clock_out_at>h.clock_in_at
          )
        )
    )
  )
  and not (
    item ->> 'type' = 'fingerprint_import_missing'
    and exists (
      select 1
      from public.attendance_historical_rows h
      where h.work_date = p_work_date
        and h.parse_status = 'matched'
    )
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', encode(extensions.digest(
      concat_ws('|','attendance_status_review_required',p_work_date::text,e.id::text),
      'sha256'
    ),'hex'),
    'type','attendance_status_review_required',
    'employee_uuid',e.id,
    'display_name',person.full_name,
    'evidence_context',jsonb_build_object(
      'status',public.private_attendance_effective_status(e.id,p_work_date)
    ),
    'resolved',false
  ) order by person.full_name,e.employee_id),'[]'::jsonb)
  into status_blockers
  from public.employees e
  join public.people person on person.id=e.person_id
  where public.private_employee_is_attendance_subject_on(e.id,p_work_date)
    and public.private_attendance_effective_status(e.id,p_work_date) ->> 'status' = 'review_required';

  return filtered || status_blockers;
end;
$$;

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
        and coalesce(record.record_snapshot ->> 'attendance_status','work') <> 'work'
    )
  )
  and not (
    item ->> 'code'='attendance_exception_unresolved'
    and exists (
      select 1
      from public.attendance_confirmation_revisions rev
      where rev.work_date=(item ->> 'work_date')::date
        and not exists (
          select 1
          from public.attendance_confirmation_reopens ro
          where ro.confirmation_revision_id=rev.id
        )
    )
    and exists (
      select 1
      from public.attendance_historical_rows h
      where h.work_date=(item ->> 'work_date')::date
        and h.parse_status='matched'
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

revoke all on function public.private_attendance_confirmation_blockers(date)
from public,anon,authenticated;
revoke all on function public.private_payroll_confirmed_attendance_readiness(date,date)
from public,anon,authenticated;

commit;
