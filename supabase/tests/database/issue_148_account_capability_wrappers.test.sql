begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

select ok(
  exists(select 1 from public.platform_capabilities where code='account.view_management' and capability_kind='operational' and active),
  'account management view capability exists'
);
select is(has_function_privilege('authenticated','public.list_pending_profiles()','EXECUTE'),false,
  'legacy pending-profile list is no longer browser-callable');
select is(has_function_privilege('authenticated','public.approve_pending_user(uuid,uuid,uuid,text[],text)','EXECUTE'),false,
  'legacy direct signup approval is no longer browser-callable');
select is(has_function_privilege('authenticated','public.approve_signup_request(uuid,uuid,uuid,text,text)','EXECUTE'),false,
  'legacy non-Employee signup approval is no longer browser-callable');

select ok(
  pg_get_functiondef('public.list_pending_signup_requests()'::regprocedure)
    ilike '%private_actor_can(''account.approve'')%'
  and pg_get_functiondef('public.list_pending_signup_requests()'::regprocedure)
    ilike '%private_actor_can(''account.reject'')%',
  'pending signup list is capability gated'
);
select ok(
  pg_get_functiondef('public.approve_signup_request_with_employee(uuid,uuid,text,text)'::regprocedure)
    ilike '%private_actor_can(''account.approve'')%',
  'Employee-linked signup approval is capability gated'
);
select ok(
  pg_get_functiondef('public.record_pending_decision(uuid,text,text)'::regprocedure)
    ilike '%private_actor_can(''account.reject'')%',
  'signup rejection/defer decision is capability gated'
);
select ok(
  pg_get_functiondef('public.get_operations_account_management()'::regprocedure)
    ilike '%private_actor_can(''account.view_management'')%',
  'operational account management context is capability gated'
);
select ok(
  pg_get_functiondef('public.link_employee_account(uuid,uuid,text)'::regprocedure)
    ilike '%private_actor_can(''employee.account_link'')%',
  'Employee account link is capability gated'
);
select ok(
  pg_get_functiondef('public.unlink_employee_account(uuid,text)'::regprocedure)
    ilike '%private_actor_can(''employee.account_unlink'')%',
  'Employee account unlink is capability gated'
);
select ok(
  pg_get_functiondef('public.change_account_status(uuid,public.account_status,text)'::regprocedure)
    ilike '%private_actor_can(''account.status_manage'')%',
  'normal account status management is operational-capability gated'
);
select ok(
  pg_get_functiondef('public.assign_profile_organization(uuid,uuid,uuid,text)'::regprocedure)
    ilike '%private_actor_can(''account.organization_manage'')%',
  'organization assignment is operational-capability gated'
);
select ok(
  pg_get_functiondef('public.set_profile_roles(uuid,text[],text)'::regprocedure)
    ilike '%private_actor_can(''account.operational_roles_manage'')%'
  and pg_get_functiondef('public.set_profile_roles(uuid,text[],text)'::regprocedure)
    ilike '%TECHNICAL_ROLE_REQUIRES_SEPARATE_FUNCTION%',
  'normal role endpoint cannot grant technical super-admin'
);
select ok(
  pg_get_functiondef('public.set_profile_super_admin_status(uuid,boolean,text)'::regprocedure)
    ilike '%private_actor_can(''technical.manage_last_super_admin'')%',
  'technical super-admin role has a separate narrow capability endpoint'
);
select ok(
  pg_get_functiondef('public.technical_change_account_status(uuid,public.account_status,text)'::regprocedure)
    ilike '%private_actor_can(''technical.emergency_system_access'')%',
  'technical emergency account status action has an explicit technical endpoint'
);

select is(has_function_privilege('authenticated','public.private_set_profile_roles_pre148(uuid,text[],text)','EXECUTE'),false,
  'browser cannot call preserved mixed role implementation directly');
select is(has_function_privilege('authenticated','public.private_change_account_status_pre148(uuid,public.account_status,text)','EXECUTE'),false,
  'browser cannot bypass account status capabilities through preserved implementation');
select ok(
  pg_get_functiondef('public.private_unlink_employee_account_pre148(uuid,text)'::regprocedure)
    ilike '%LAST_ACTIVE_SUPER_ADMIN_PROTECTED%',
  'last active super-admin protection remains behind account unlink wrapper'
);

select * from finish();
rollback;
