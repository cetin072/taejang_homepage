begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

select has_table('public', 'payroll_draft_handoffs', 'payroll draft handoff table exists');
select has_function('public', 'get_my_payroll_draft_handoff_workspace', array[]::text[], 'handoff workspace RPC exists');
select has_function('public', 'start_payroll_draft_handoff_review', array['date'], 'lead review start RPC exists');
select has_function('public', 'submit_payroll_draft_handoff', array['uuid', 'text'], 'lead submit RPC exists');
select has_function('public', 'request_payroll_draft_handoff_changes', array['uuid', 'text'], 'operations changes RPC exists');
select has_function('public', 'approve_payroll_draft_handoff', array['uuid', 'text'], 'operations approval RPC exists');

select is(
  has_table_privilege('authenticated', 'public.payroll_draft_handoffs', 'SELECT'),
  false,
  'authenticated clients cannot read handoffs directly'
);
select is(
  has_table_privilege('authenticated', 'public.payroll_draft_handoffs', 'UPDATE'),
  false,
  'authenticated clients cannot change handoffs directly'
);
select is(
  has_function_privilege('authenticated', 'public.private_payroll_handoff_lead_allowed()', 'EXECUTE'),
  false,
  'authenticated clients cannot call the private lead authorization helper'
);
select is(
  has_function_privilege('authenticated', 'public.private_payroll_handoff_source_is_current(uuid,uuid,text)', 'EXECUTE'),
  false,
  'authenticated clients cannot call the private source freshness helper'
);
select is(
  has_function_privilege('authenticated', 'public.get_my_payroll_draft_handoff_workspace()', 'EXECUTE'),
  true,
  'authenticated clients can call the guarded workspace RPC'
);
select is(
  has_function_privilege('authenticated', 'public.approve_payroll_draft_handoff(uuid,text)', 'EXECUTE'),
  true,
  'authenticated clients can call the guarded approval RPC'
);

select ok(
  exists (
    select 1
    from public.role_capability_grants grant_row
    join public.roles role on role.id = grant_row.role_id
    where role.code = 'promotion_lead'
      and grant_row.capability_code = 'payroll.handoff.review'
  ),
  'promotion lead receives only the handoff review capability'
);
select is(
  (select operations_manager_auto_grant from public.platform_capabilities where code = 'payroll.handoff.review'),
  false,
  'handoff review is not an operations-manager auto grant'
);
select is(
  (select operations_manager_auto_grant from public.platform_capabilities where code = 'payroll.handoff.approve'),
  true,
  'handoff approval is an operations-manager auto grant'
);
select ok(
  pg_get_functiondef('public.submit_payroll_draft_handoff(uuid,text)'::regprocedure)
    ilike '%PAYROLL_HANDOFF_SOURCE_STALE%'
  and pg_get_functiondef('public.approve_payroll_draft_handoff(uuid,text)'::regprocedure)
    ilike '%PAYROLL_HANDOFF_SOURCE_STALE%',
  'submit and approval both reject stale calculation runs'
);
select ok(
  pg_get_functiondef('public.get_my_payroll_draft_handoff_workspace()'::regprocedure)
    not ilike '%gross_pay_preview%'
  and pg_get_functiondef('public.get_my_payroll_draft_handoff_workspace()'::regprocedure)
    not ilike '%employee_uuid%',
  'workspace return model excludes payroll amount and employee detail fields'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payroll_draft_handoffs'
      and column_name in ('gross_pay_preview', 'net_pay_preview', 'deduction_preview', 'employee_uuid')
  ),
  'handoff persistence excludes payroll amounts and employee rows'
);

select * from finish();
rollback;
