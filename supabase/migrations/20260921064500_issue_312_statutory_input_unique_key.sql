-- Issue #312 follow-up: statutory fingerprint must participate in the unique run identity.
begin;

alter table public.payroll_calculation_runs
  drop constraint if exists payroll_calculation_runs_payroll_month_id_calculation_versi_key;

alter table public.payroll_calculation_runs
  add constraint payroll_calculation_runs_statutory_identity_key
  unique (
    payroll_month_id,
    calculation_version,
    input_fingerprint,
    statutory_input_fingerprint,
    cutoff_date
  );

comment on constraint payroll_calculation_runs_statutory_identity_key
  on public.payroll_calculation_runs is
  'A payroll run is idempotent only when attendance/input and statutory deduction inputs are both unchanged.';

commit;
