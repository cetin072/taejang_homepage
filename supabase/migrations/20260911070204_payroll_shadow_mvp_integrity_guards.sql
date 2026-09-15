-- Staging-applied payroll integrity guards for Shadow MVP.
begin;

create extension if not exists btree_gist with schema extensions;
set local search_path = public, extensions;

alter table public.payroll_employment_terms
  add constraint payroll_employment_terms_no_overlap_excl
  exclude using gist (
    employee_uuid with =,
    daterange(effective_from, effective_to, '[]') with &&
  );

create unique index payroll_attendance_one_employee_day_per_batch_uq
  on public.payroll_attendance_rows(batch_id, employee_uuid, work_date)
  where employee_uuid is not null;

alter table public.payroll_employee_results
  add constraint payroll_employee_results_partial_gross_withheld_ck
  check (
    gross_pay_preview is null
    or (
      rate_status = 'single_rate'
      and unresolved_count = 0
      and weekly_holiday_pending_weeks = 0
    )
  );

alter table public.payroll_employee_results
  add constraint payroll_employee_results_nonnegative_hours_ck
  check (
    actual_work_hours >= 0
    and expected_work_hours >= 0
    and paid_holiday_hours >= 0
    and weekly_holiday_actual_hours >= 0
    and weekly_holiday_expected_hours >= 0
    and weekly_holiday_pending_weeks >= 0
    and unresolved_count >= 0
    and payable_hours_preview >= 0
    and (hourly_rate is null or hourly_rate > 0)
    and (gross_pay_preview is null or gross_pay_preview >= 0)
  );

create or replace function public.private_reject_payroll_attendance_correction_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode='55000', message='PAYROLL_ATTENDANCE_CORRECTION_APPEND_ONLY';
end;
$$;

revoke all on function public.private_reject_payroll_attendance_correction_mutation()
from public, anon, authenticated;

drop trigger if exists payroll_attendance_corrections_append_only_guard
on public.payroll_attendance_corrections;
create trigger payroll_attendance_corrections_append_only_guard
before update or delete on public.payroll_attendance_corrections
for each row execute function public.private_reject_payroll_attendance_correction_mutation();

commit;
