begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

select has_table('public', 'people', 'people table exists');
select has_table('public', 'employees', 'employees table exists');
select has_table('public', 'account_person_links', 'account-person link table exists');
select has_table('public', 'employee_photos', 'employee photo table exists');
select has_table('public', 'employee_change_requests', 'employee change-request table exists');

select ok((select relrowsecurity from pg_class where oid='public.people'::regclass), 'people has RLS');
select ok((select relrowsecurity from pg_class where oid='public.employees'::regclass), 'employees has RLS');
select ok((select relrowsecurity from pg_class where oid='public.account_person_links'::regclass), 'account links have RLS');
select ok((select relrowsecurity from pg_class where oid='public.employee_photos'::regclass), 'employee photos have RLS');
select ok((select relrowsecurity from pg_class where oid='public.employee_change_requests'::regclass), 'change requests have RLS');

select is(has_table_privilege('anon', 'public.employees', 'SELECT'), false, 'anon cannot select employees');
select is(has_table_privilege('authenticated', 'public.employees', 'SELECT'), false, 'authenticated cannot directly select employees');
select is(has_table_privilege('authenticated', 'public.employee_photos', 'SELECT'), false, 'authenticated cannot directly select employee photo metadata');

select has_function('public', 'get_employee_management_context', array[]::text[], 'employee management RPC exists');
select has_function('public', 'create_employee', array['text','date','uuid','uuid','boolean'], 'operations employee-create RPC exists');
select has_function('public', 'submit_employee_change_request', array['text','uuid','jsonb'], 'team change-request RPC exists');
select has_function('public', 'approve_signup_request_with_employee', array['uuid','uuid','text','text'], 'employee-linked signup approval RPC exists');

select is(has_function_privilege('anon', 'public.get_employee_management_context()', 'EXECUTE'), false, 'anon cannot call employee management RPC');
select is(has_function_privilege('authenticated', 'public.get_employee_management_context()', 'EXECUTE'), true, 'authenticated may reach guarded employee RPC');
select is(has_function_privilege('anon', 'public.approve_signup_request_with_employee(uuid,uuid,text,text)', 'EXECUTE'), false, 'anon cannot call employee-linked approval RPC');

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='account_person_links_one_active_profile'
      and indexdef ilike '%where (revoked_at is null)%'
  ),
  'one active Person link per profile is enforced'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='account_person_links_one_active_person'
      and indexdef ilike '%where (revoked_at is null)%'
  ),
  'one active profile per Person is enforced'
);

select * from finish();
rollback;
