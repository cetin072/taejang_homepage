begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

select has_table('public', 'platform_capabilities', 'capability registry exists');
select has_table('public', 'role_capability_grants', 'role capability grant table exists');

select is(
  has_table_privilege('authenticated', 'public.platform_capabilities', 'SELECT'),
  false,
  'browser clients cannot read capability registry directly'
);

select is(
  has_table_privilege('authenticated', 'public.role_capability_grants', 'SELECT'),
  false,
  'browser clients cannot read role-capability grants directly'
);

select has_function('public', 'private_actual_role_codes', array[]::text[], 'actual-role helper exists');
select has_function('public', 'private_effective_role_codes', array[]::text[], 'effective-role helper exists');
select has_function('public', 'private_actor_capabilities', array[]::text[], 'capability resolver exists');
select has_function('public', 'private_actor_can', array['text'], 'server capability check helper exists');
select has_function('public', 'get_my_access_context_v2', array[]::text[], 'v2 access context exists');

select is(
  has_function_privilege('authenticated', 'public.private_actor_can(text)', 'EXECUTE'),
  false,
  'browser clients cannot execute private capability authorization helper'
);

select is(
  has_function_privilege('authenticated', 'public.private_actor_capabilities()', 'EXECUTE'),
  false,
  'browser clients cannot execute private capability resolver'
);

select is(
  has_function_privilege('authenticated', 'public.get_my_access_context_v2()', 'EXECUTE'),
  true,
  'authenticated client can read its own v2 access context'
);

select is(
  (select operations_manager_auto_grant from public.platform_capabilities where code = 'attendance.self_record'),
  false,
  'operations manager does not automatically inherit personal attendance recording'
);

select ok(
  not exists (
    select 1
    from public.platform_capabilities
    where capability_kind = 'technical'
      and operations_manager_auto_grant
  ),
  'technical capabilities are never operations-manager auto grants'
);

select ok(
  exists (
    select 1
    from public.role_capability_grants grant_row
    join public.roles role on role.id = grant_row.role_id
    where role.code = 'super_admin'
      and grant_row.capability_code = 'technical.bootstrap_super_admin'
  )
  and not exists (
    select 1
    from public.role_capability_grants grant_row
    join public.roles role on role.id = grant_row.role_id
    where role.code = 'super_admin'
      and grant_row.capability_code = 'task.manage'
  ),
  'super_admin has technical grants without implicit normal task-management grant'
);

select ok(
  pg_get_functiondef('public.private_actor_capabilities()'::regprocedure)
    ilike '%operations_manager_auto_grant%'
  and pg_get_functiondef('public.private_actor_capabilities()'::regprocedure)
    ilike '%capability_kind = ''technical''%'
  and pg_get_functiondef('public.private_actor_capabilities()'::regprocedure)
    ilike '%actual_roles%',
  'capability resolver separates ops auto grants from actual-role technical grants'
);

select ok(
  pg_get_functiondef('public.private_actor_capabilities()'::regprocedure)
    ilike '%attendance.self_record%'
  and pg_get_functiondef('public.private_actor_capabilities()'::regprocedure)
    ilike '%operations_manager%'
  and pg_get_functiondef('public.private_actor_capabilities()'::regprocedure)
    ilike '%ceo%',
  'executive attendance exclusion survives lower-role simulation'
);

select * from finish();
rollback;
