begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

select has_table('public', 'employee_self_service_contact_requests', 'self-service contact request ledger exists');
select has_function('public', 'get_my_employee_profile', array[]::text[], 'employee profile read model exists');
select has_function('public', 'list_my_employee_contact_change_requests', array[]::text[], 'employee contact request history read model exists');
select has_function('public', 'submit_my_employee_contact_change_request', array['text'], 'employee contact request writer exists');
select has_function('public', 'review_employee_contact_change_request', array['uuid', 'text', 'text'], 'reviewer contact request action exists');

select ok(not has_table_privilege('authenticated', 'public.employee_self_service_contact_requests', 'SELECT'), 'authenticated clients cannot read the contact request table directly');
select ok(not has_table_privilege('authenticated', 'public.employee_self_service_contact_requests', 'INSERT'), 'authenticated clients cannot forge a contact request row');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'), 'authenticated clients cannot update profile contact rows directly');
select ok(has_function_privilege('authenticated', 'public.get_my_employee_profile()', 'EXECUTE'), 'authenticated clients may call guarded profile read model');
select ok(not has_function_privilege('anon', 'public.get_my_employee_profile()', 'EXECUTE'), 'anonymous clients cannot call profile read model');
select ok(
  pg_get_functiondef('public.review_employee_contact_change_request(uuid,text,text)'::regprocedure)
    ilike '%private_actor_can(''employee.review_change_requests'')%',
  'contact approval uses existing server capability authority'
);
select ok(
  pg_get_functiondef('public.submit_my_employee_contact_change_request(text)'::regprocedure)
    not ilike '%update public.profiles%',
  'employee submission cannot update canonical contact data'
);

select ok(not has_table_privilege('authenticated', 'public.employee_self_service_contact_requests', 'UPDATE'), 'clients cannot decide requests directly');
select ok(not has_table_privilege('authenticated', 'public.employee_self_service_contact_requests', 'DELETE'), 'clients cannot delete requests directly');
select ok(not has_function_privilege('authenticated','public.private_can_review_employee_contact(uuid)','EXECUTE'), 'scope helper is private');
select ok(pg_get_functiondef('public.private_active_employee_for_profile(uuid)'::regprocedure) like '%employee.archived_at is null%', 'archived employees fail closed');
select ok(pg_get_functiondef('public.get_employee_management_context()'::regprocedure) like '%private_can_review_employee_contact(request.profile_id)%', 'queue uses shared target guard');
select ok(pg_get_functiondef('public.review_employee_contact_change_request(uuid,text,text)'::regprocedure) like '%private_can_review_employee_contact(request_row.profile_id)%', 'known request IDs use same guard');
select * from finish();
rollback;
