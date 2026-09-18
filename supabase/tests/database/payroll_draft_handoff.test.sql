begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

select has_table('public', 'payroll_draft_handoffs', 'payroll draft handoff table exists');
select has_column('public', 'payroll_draft_handoffs', 'payroll_period', 'handoff stores payroll period');
select has_column('public', 'payroll_draft_handoffs', 'external_draft_id', 'handoff stores external draft id');
select has_column('public', 'payroll_draft_handoffs', 'external_draft_revision', 'handoff stores external draft revision');
select has_column('public', 'payroll_draft_handoffs', 'confirmed_attendance_ref', 'handoff stores confirmed attendance reference');
select has_column('public', 'payroll_draft_handoffs', 'gross_summary_amount', 'handoff stores aggregate gross summary only');

select has_function('public', 'get_my_payroll_draft_handoff_workspace', array[]::text[], 'handoff workspace RPC exists');
select has_function('public', 'start_payroll_draft_handoff_review', array['uuid'], 'lead review start RPC exists');
select has_function('public', 'submit_payroll_draft_handoff', array['uuid', 'text'], 'lead submit RPC exists');
select has_function('public', 'request_payroll_draft_handoff_changes', array['uuid', 'text'], 'operations changes RPC exists');
select has_function('public', 'reject_payroll_draft_handoff', array['uuid', 'text'], 'operations reject RPC exists');
select has_function('public', 'approve_payroll_draft_handoff', array['uuid', 'text'], 'operations approval RPC exists');
select has_function('public', 'get_payroll_draft_handoff_decision', array['date', 'text', 'integer'], 'protected result read RPC exists');

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
  has_function_privilege('authenticated', 'public.private_payroll_handoff_reviewer_allowed()', 'EXECUTE'),
  false,
  'authenticated clients cannot call private reviewer helper'
);
select is(
  has_function_privilege('authenticated', 'public.get_my_payroll_draft_handoff_workspace()', 'EXECUTE'),
  true,
  'authenticated clients can call guarded workspace RPC'
);
select is(
  has_function_privilege('authenticated', 'public.get_payroll_draft_handoff_decision(date,text,integer)', 'EXECUTE'),
  true,
  'authenticated clients can call guarded decision read RPC'
);

select ok(
  exists (
    select 1
    from public.role_capability_grants grant_row
    join public.roles role on role.id = grant_row.role_id
    where role.code = 'promotion_lead'
      and grant_row.capability_code = 'payroll.handoff.review'
  ),
  'promotion lead receives handoff review capability'
);
select is(
  (select operations_manager_auto_grant from public.platform_capabilities where code = 'payroll.handoff.review'),
  true,
  'operations manager inherits lead-level handoff review capability'
);
select is(
  (select operations_manager_auto_grant from public.platform_capabilities where code = 'payroll.handoff.approve'),
  true,
  'operations manager receives final handoff approval capability'
);

select ok(
  (
    select string_agg(pg_get_constraintdef(oid), ' ')
    from pg_constraint
    where conrelid = 'public.payroll_draft_handoffs'::regclass
      and contype = 'c'
  ) ilike '%draft%'
  and (
    select string_agg(pg_get_constraintdef(oid), ' ')
    from pg_constraint
    where conrelid = 'public.payroll_draft_handoffs'::regclass
      and contype = 'c'
  ) ilike '%rejected%'
  and (
    select string_agg(pg_get_constraintdef(oid), ' ')
    from pg_constraint
    where conrelid = 'public.payroll_draft_handoffs'::regclass
      and contype = 'c'
  ) ilike '%approved%',
  'handoff status constraints include approved six-state lifecycle'
);

select ok(
  pg_get_functiondef('public.get_my_payroll_draft_handoff_workspace()'::regprocedure)
    ilike '%gross_summary_amount%'
  and pg_get_functiondef('public.get_my_payroll_draft_handoff_workspace()'::regprocedure)
    not ilike '%employee_uuid%',
  'workspace exposes approved aggregate summary without employee rows'
);

select ok(
  pg_get_functiondef('public.approve_payroll_draft_handoff(uuid,text)'::regprocedure)
    not ilike '%update public.payroll_months%'
  and pg_get_functiondef('public.approve_payroll_draft_handoff(uuid,text)'::regprocedure)
    not ilike '%payment%',
  'platform approval cannot lock payroll month or execute payment'
);

select * from finish();
rollback;
