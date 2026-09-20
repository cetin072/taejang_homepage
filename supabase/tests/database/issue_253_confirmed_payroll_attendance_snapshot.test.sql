begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
select has_table('public','payroll_confirmed_attendance_snapshots','immutable payroll attendance snapshot ledger exists');
select has_column('public','payroll_calculation_runs','confirmed_attendance_snapshot_id','calculation run links exact attendance snapshot');
select has_column('public','payroll_calculation_runs','confirmed_attendance_fingerprint','calculation run records attendance fingerprint');
select is(has_table_privilege('authenticated','public.payroll_confirmed_attendance_snapshots','select'),false,'browser roles cannot read payroll attendance snapshots directly');
select has_function('public','get_payroll_confirmed_attendance_readiness',array['date','date'],'monthly readiness RPC exists');
select has_function('public','private_build_payroll_calculation_input',array['date','date','uuid'],'canonical payroll input bridge exists');
select ok(
  pg_get_functiondef('public.private_payroll_confirmed_attendance_readiness(date,date)'::regprocedure) ilike '%private_payroll_confirmed_attendance_readiness_pre286%'
  and pg_get_functiondef('public.private_payroll_confirmed_attendance_readiness_pre286(date,date)'::regprocedure) ilike '%day_unconfirmed%'
  and pg_get_functiondef('public.private_payroll_confirmed_attendance_readiness_pre286(date,date)'::regprocedure) ilike '%attendance_exception_unresolved%',
  'readiness wrapper preserves base unconfirmed-day and unresolved-evidence blockers'
);
select ok(
  pg_get_functiondef('public.private_payroll_confirmed_attendance_readiness_pre286(date,date)'::regprocedure) ilike '%employee_record_missing%'
  and pg_get_functiondef('public.private_payroll_confirmed_attendance_readiness_pre286(date,date)'::regprocedure) ilike '%confirmed_duration_invalid%'
  and pg_get_functiondef('public.private_payroll_confirmed_attendance_readiness(date,date)'::regprocedure) ilike '%confirmed_duration_invalid%',
  'readiness preserves missing-employee and invalid-duration guards while allowing explicit historical exceptions'
);
select ok(pg_get_functiondef('public.private_build_payroll_calculation_input(date,date,uuid)'::regprocedure) ilike '%attendance_confirmed_records%' and pg_get_functiondef('public.private_build_payroll_calculation_input(date,date,uuid)'::regprocedure) ilike '%employee_uuid%','native input derives from confirmed records with canonical employee UUID');
select ok(
  pg_get_functiondef('public.private_build_payroll_calculation_input(date,date,uuid)'::regprocedure) ilike '%payroll-db-input-v6-confirmed-status%'
  and pg_get_functiondef('public.private_build_payroll_calculation_input(date,date,uuid)'::regprocedure) ilike '%confirmed_attendance%',
  'input carries exact confirmed-attendance fingerprint with status-aware basis version'
);
select ok(pg_get_functiondef('public.private_attach_payroll_confirmed_snapshot()'::regprocedure) ilike '%payroll_confirmed_attendance_snapshots%' and pg_get_functiondef('public.private_attach_payroll_confirmed_snapshot()'::regprocedure) ilike '%new.confirmed_attendance_snapshot_id%','persisted calculation runs attach immutable attendance snapshots');
select ok(exists(select 1 from pg_trigger where tgrelid='public.payroll_calculation_runs'::regclass and tgname='payroll_calculation_runs_confirmed_attendance_snapshot' and not tgisinternal),'calculation persistence trigger attaches snapshot');
select ok(exists(select 1 from pg_trigger where tgrelid='public.payroll_confirmed_attendance_snapshots'::regclass and tgname='payroll_confirmed_attendance_snapshots_append_only' and not tgisinternal),'snapshot ledger is append-only');
select ok(pg_get_functiondef('public.private_build_payroll_calculation_input_legacy_v4(date,date,uuid)'::regprocedure) is not null,'legacy XLS/manual calculation builder remains retained for emergency/history');
select * from finish(); rollback;
