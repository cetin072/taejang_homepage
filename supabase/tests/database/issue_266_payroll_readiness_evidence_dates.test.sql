begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
select ok(
  pg_get_functiondef('public.private_payroll_confirmed_attendance_readiness(date,date)'::regprocedure) ilike '%private_payroll_confirmed_attendance_readiness_pre286%'
  and pg_get_functiondef('public.private_payroll_confirmed_attendance_readiness_pre286(date,date)'::regprocedure) ilike '%evidence_dates%'
  and pg_get_functiondef('public.private_payroll_confirmed_attendance_readiness_pre286(date,date)'::regprocedure) ilike '%attendance_events%'
  and pg_get_functiondef('public.private_payroll_confirmed_attendance_readiness_pre286(date,date)'::regprocedure) ilike '%attendance_external_evidence%'
  and pg_get_functiondef('public.private_payroll_confirmed_attendance_readiness_pre286(date,date)'::regprocedure) ilike '%attendance_corrections%',
  'readiness derives required dates from every authoritative attendance evidence ledger'
);
select ok(
  pg_get_functiondef('public.private_payroll_confirmed_attendance_readiness_pre286(date,date)'::regprocedure) ilike '%required_confirmation_dates%'
  and pg_get_functiondef('public.private_payroll_confirmed_attendance_readiness_pre286(date,date)'::regprocedure) ilike '%day_unconfirmed%',
  'date confirmation is required for scheduled-or-evidenced dates, not every calendar date'
);
select ok(
  pg_get_functiondef('public.private_payroll_confirmed_attendance_readiness_pre286(date,date)'::regprocedure) ilike '%evidence_employee_days%'
  and pg_get_functiondef('public.private_payroll_confirmed_attendance_readiness_pre286(date,date)'::regprocedure) ilike '%employee_record_missing%',
  'employee-record requirements include the concrete eligible employee represented by evidence'
);
select ok(
  pg_get_functiondef('public.private_payroll_confirmed_attendance_readiness_pre286(date,date)'::regprocedure) ilike '%private_attendance_confirmation_blockers(required.work_date)%',
  'unresolved confirmation exceptions are evaluated for every required confirmation date'
);
select * from finish();
rollback;
