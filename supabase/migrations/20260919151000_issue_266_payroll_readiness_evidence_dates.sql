-- Issue #266 / audit remediation C: payroll readiness must use the same
-- scheduled-or-evidenced date set that can contribute confirmed attendance.
begin;

create or replace function public.private_payroll_confirmed_attendance_readiness(
  p_payroll_month date, p_cutoff_date date
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  month_end date;
  boundary_start date;
  blockers jsonb;
begin
  if p_payroll_month is null or date_trunc('month',p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;
  month_end := (p_payroll_month + interval '1 month - 1 day')::date;
  if p_cutoff_date is null or p_cutoff_date < p_payroll_month or p_cutoff_date > month_end then
    raise exception using errcode='22023', message='INVALID_PAYROLL_CUTOFF_DATE';
  end if;
  boundary_start := p_payroll_month - (extract(isodow from p_payroll_month)::integer - 1);

  with eligible_employee_days as (
    select d.work_date::date as work_date, e.id as employee_uuid
    from generate_series(boundary_start, p_cutoff_date, interval '1 day') d(work_date)
    join public.employees e on e.attendance_required
      and e.hired_on <= d.work_date::date
      and (e.departed_on is null or e.departed_on >= d.work_date::date)
    where exists (
      select 1 from public.payroll_employment_terms t
      where t.employee_uuid=e.id and t.effective_from <= d.work_date::date
        and (t.effective_to is null or t.effective_to >= d.work_date::date)
    )
  ), scheduled_employee_days as (
    select eligible.work_date, eligible.employee_uuid
    from eligible_employee_days eligible
    where extract(isodow from eligible.work_date) between 1 and 5
      and not exists (
        select 1 from public.payroll_holidays h where h.holiday_date=eligible.work_date
      )
  ), evidence_employee_days as (
    select event.work_date, eligible.employee_uuid
    from public.attendance_events event
    join public.account_person_links link on link.profile_id=event.profile_id and link.revoked_at is null
    join public.employees employee on employee.person_id=link.person_id
    join eligible_employee_days eligible on eligible.work_date=event.work_date and eligible.employee_uuid=employee.id
    where event.work_date between boundary_start and p_cutoff_date
    union
    select evidence.work_date, eligible.employee_uuid
    from public.attendance_external_evidence evidence
    join eligible_employee_days eligible on eligible.work_date=evidence.work_date
      and eligible.employee_uuid=evidence.employee_uuid_at_import
    where evidence.work_date between boundary_start and p_cutoff_date
    union
    select correction.work_date, eligible.employee_uuid
    from public.attendance_corrections correction
    join eligible_employee_days eligible on eligible.work_date=correction.work_date
      and eligible.employee_uuid=correction.employee_uuid
    where correction.work_date between boundary_start and p_cutoff_date
  ), evidence_dates as (
    -- Payroll readiness is scoped to employees eligible for this payroll input.
    -- Unlinked raw evidence remains immutable and is surfaced when a scheduled
    -- confirmation day is reviewed, but cannot create a payroll blocker for an
    -- unrelated profile or an out-of-scope employee.
    select distinct work_date from evidence_employee_days
  ), required_confirmation_dates as (
    select work_date from scheduled_employee_days
    union
    select work_date from evidence_dates
  ), required_employee_days as (
    select work_date, employee_uuid from scheduled_employee_days
    union
    select work_date, employee_uuid from evidence_employee_days
  ), active_revisions as (
    select r.id, r.work_date, r.revision_no, r.snapshot_fingerprint
    from public.attendance_confirmation_revisions r
    where r.work_date between boundary_start and p_cutoff_date
      and not exists (select 1 from public.attendance_confirmation_reopens ro where ro.confirmation_revision_id=r.id)
  ), raw as (
    select 'day_unconfirmed'::text as code, required.work_date, null::uuid as employee_uuid, null::text as detail
    from required_confirmation_dates required
    left join active_revisions revision on revision.work_date=required.work_date
    where revision.id is null
    union all
    select 'employee_record_missing', required.work_date, required.employee_uuid, null
    from required_employee_days required join active_revisions revision on revision.work_date=required.work_date
    left join public.attendance_confirmed_records record on record.confirmation_revision_id=revision.id and record.employee_uuid=required.employee_uuid
    where record.id is null
    union all
    select 'confirmed_duration_invalid', required.work_date, required.employee_uuid, null
    from required_employee_days required join active_revisions revision on revision.work_date=required.work_date
    join public.attendance_confirmed_records record on record.confirmation_revision_id=revision.id and record.employee_uuid=required.employee_uuid
    where record.clock_in_at is null or record.clock_out_at is null or record.clock_out_at <= record.clock_in_at
    union all
    select 'attendance_exception_unresolved', required.work_date, null::uuid, item ->> 'type'
    from required_confirmation_dates required
    cross join lateral jsonb_array_elements(public.private_attendance_confirmation_blockers(required.work_date)) item
    where coalesce((item ->> 'resolved')::boolean,false) is false
  )
  select coalesce(jsonb_agg(jsonb_build_object('code',code,'work_date',work_date,'employee_uuid',employee_uuid,'detail',detail)
      order by work_date, employee_uuid nulls last, code, detail), '[]'::jsonb)
  into blockers from raw;
  return jsonb_build_object(
    'payroll_month',p_payroll_month,'cutoff_date',p_cutoff_date,'boundary_start',boundary_start,
    'ready',jsonb_array_length(blockers)=0,'blockers',blockers,
    'readiness_fingerprint',encode(extensions.digest(blockers::text,'sha256'),'hex')
  );
end;
$$;

revoke all on function public.private_payroll_confirmed_attendance_readiness(date,date)
  from public, anon, authenticated;
comment on function public.private_payroll_confirmed_attendance_readiness(date,date) is
  'Issue #266: readiness covers scheduled employee-days plus dates and eligible employees represented by authoritative GPS, external, or correction evidence. Weekend/holiday dates without evidence are not invented.';

commit;
