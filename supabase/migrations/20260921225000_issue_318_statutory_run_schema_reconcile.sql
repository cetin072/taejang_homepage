-- Issue #318: reconcile payroll run schema with the statutory-aware persistence contract.
begin;

alter table public.payroll_calculation_runs
  add column if not exists statutory_input_fingerprint text;

do $$
begin
  alter table public.payroll_calculation_runs
    add constraint payroll_calculation_runs_statutory_input_fingerprint_check
    check (
      statutory_input_fingerprint is null
      or statutory_input_fingerprint ~ '^[0-9a-f]{64}$'
    );
exception
  when duplicate_object then null;
end;
$$;

comment on column public.payroll_calculation_runs.statutory_input_fingerprint is
  'Server-only SHA-256 fingerprint of monthly statutory deduction input used for deterministic payroll run reuse.';

commit;
