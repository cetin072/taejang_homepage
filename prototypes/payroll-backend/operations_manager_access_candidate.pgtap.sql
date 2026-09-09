-- Payroll operations-manager access candidate: database privilege checks
-- Run only in disposable/local Supabase or explicitly approved staging AFTER the payroll
-- prototype schema and operations_manager_access_candidate have been promoted temporarily.
-- Never run this file as a Production migration.

begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select has_function(
  'public',
  'private_payroll_operator_allowed',
  array[]::text[],
  'private payroll operator predicate exists'
);

select has_function(
  'public',
  'private_require_payroll_operator',
  array[]::text[],
  'private payroll authorization guard exists'
);

select has_function(
  'public',
  'get_payroll_operator_month_context',
  array['date'],
  'guarded payroll operator read RPC exists'
);

select is(
  has_function_privilege('anon', 'public.get_payroll_operator_month_context(date)', 'EXECUTE'),
  false,
  'anon cannot execute payroll read RPC'
);

select is(
  has_function_privilege('authenticated', 'public.get_payroll_operator_month_context(date)', 'EXECUTE'),
  true,
  'authenticated can reach the guarded payroll RPC'
);

select is(
  has_function_privilege('authenticated', 'public.private_payroll_operator_allowed()', 'EXECUTE'),
  false,
  'authenticated cannot directly call private payroll predicate'
);

select is(
  has_function_privilege('authenticated', 'public.private_require_payroll_operator()', 'EXECUTE'),
  false,
  'authenticated cannot directly call private payroll guard'
);

select is(
  has_table_privilege('authenticated', 'public.payroll_months', 'SELECT'),
  false,
  'authenticated cannot directly select payroll months'
);

select is(
  has_table_privilege('authenticated', 'public.payroll_months', 'UPDATE'),
  false,
  'authenticated cannot directly update payroll months'
);

select is(
  has_table_privilege('anon', 'public.payroll_months', 'SELECT'),
  false,
  'anon cannot directly select payroll months'
);

select is(
  has_table_privilege('authenticated', 'public.payroll_employee_results', 'SELECT'),
  false,
  'authenticated cannot directly select employee payroll results'
);

select ok(
  (select relrowsecurity from pg_class where oid='public.payroll_months'::regclass),
  'payroll months have RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid='public.payroll_employee_results'::regclass),
  'payroll employee results have RLS enabled'
);

select is(
  (
    select count(*)::bigint
    from pg_policies
    where schemaname='public'
      and tablename in (
        'payroll_employment_terms',
        'payroll_holidays',
        'payroll_months',
        'payroll_calculation_runs',
        'payroll_employee_results',
        'payroll_adjustments',
        'payroll_carryover_applications',
        'payroll_accounting_comparisons',
        'payroll_accounting_difference_rows'
      )
  ),
  0::bigint,
  'payroll tables remain policy-free/fail-closed in the candidate access layer'
);

select * from finish();
rollback;
