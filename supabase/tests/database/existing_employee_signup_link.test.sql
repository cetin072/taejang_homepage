begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_function('public','list_existing_employee_signup_candidates',array[]::text[],
  'existing employee candidate RPC is available');
select has_function('public','approve_existing_employee_signup_request',
  array['uuid','uuid','text','text','boolean','text'],
  'guarded existing employee account linking RPC exists');

select ok(has_function_privilege('authenticated','public.list_existing_employee_signup_candidates()','EXECUTE'),
  'signed-in actor may call guarded employee-number selector');
select ok(has_function_privilege('authenticated','public.approve_existing_employee_signup_request(uuid,uuid,text,text,boolean,text)','EXECUTE'),
  'signed-in actor may invoke guarded existing-link RPC');
select ok(not has_function_privilege('anon','public.list_existing_employee_signup_candidates()','EXECUTE'),
  'anonymous actors cannot list employee identities');
select ok(not has_function_privilege('anon','public.approve_existing_employee_signup_request(uuid,uuid,text,text,boolean,text)','EXECUTE'),
  'anonymous actors cannot approve employee link');
select ok(not has_function_privilege('authenticated','public.private_approve_signup_request_with_employee_pre148(uuid,uuid,text,text)','EXECUTE'),
  'historical private linker cannot be called directly by browser users');

select ok(
 position('private_actor_can(''employee.onboard'')' in
  pg_get_functiondef('public.approve_existing_employee_signup_request(uuid,uuid,text,text,boolean,text)'::regprocedure))>0,
 'existing-link endpoint requires employee onboarding capability'
);
select ok(
 position('EXISTING_EMPLOYEE_LINK_REQUIRED' in
  pg_get_functiondef('public.approve_employee_signup_request(uuid,uuid,uuid,text,boolean,text)'::regprocedure))>0,
 'new-employee creation from lead mobile approval is explicitly denied'
);
select ok(
 position('ROLE_NOT_ASSIGNABLE' in
  pg_get_functiondef('public.private_approve_signup_request_with_employee_pre148(uuid,uuid,text,text)'::regprocedure))>0,
 'shared internal linker forbids granting lead role by promotion lead'
);
select ok(
 position('EMPLOYEE_NUMBER_CONFIRMATION_MISMATCH' in
  pg_get_functiondef('public.approve_existing_employee_signup_request(uuid,uuid,text,text,boolean,text)'::regprocedure))>0,
 'server requires explicit employee-number confirmation'
);
select ok(
 position('EMPLOYEE_ALREADY_LINKED' in
  pg_get_functiondef('public.approve_existing_employee_signup_request(uuid,uuid,text,text,boolean,text)'::regprocedure))>0
 and position('PROFILE_ALREADY_LINKED' in
  pg_get_functiondef('public.approve_existing_employee_signup_request(uuid,uuid,text,text,boolean,text)'::regprocedure))>0,
 'server denies both employee and applicant double-link'
);
select ok(
 position('SIGNUP_IDENTITY_MISMATCH_REQUIRES_CONFIRMATION' in
  pg_get_functiondef('public.approve_existing_employee_signup_request(uuid,uuid,text,text,boolean,text)'::regprocedure))>0,
 'name or hire-date mismatch requires explicit identity check'
);
select ok(
 position('public.private_approve_signup_request_with_employee_pre148' in
  pg_get_functiondef('public.approve_existing_employee_signup_request(uuid,uuid,text,text,boolean,text)'::regprocedure))>0,
 'new endpoint reuses established atomic account-link, profile activation and audit'
);
select ok(
 position('private_insert_employee' in
  pg_get_functiondef('public.approve_existing_employee_signup_request(uuid,uuid,text,text,boolean,text)'::regprocedure))=0,
 'existing employee approval never creates a second Employee'
);
select ok(
 position('promotion_lead' in
  pg_get_functiondef('public.list_existing_employee_signup_candidates()'::regprocedure))>0,
 'selector guarded for operations manager and team lead'
);
select ok(
 position('signup_phone' in
  pg_get_functiondef('public.list_existing_employee_signup_candidates()'::regprocedure))=0
 and position('rrn' in
  pg_get_functiondef('public.list_existing_employee_signup_candidates()'::regprocedure))=0,
 'selector does not expose mobile phone or resident registration number'
);
select * from finish();
rollback;
