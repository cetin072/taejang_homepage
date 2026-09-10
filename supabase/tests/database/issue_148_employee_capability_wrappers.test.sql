begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select ok(
  exists(select 1 from public.platform_capabilities where code='employee.view_scoped' and capability_kind='operational' and active),
  'scoped Employee read capability exists'
);
select ok(
  exists(select 1 from public.platform_capabilities where code='employee.request_change' and capability_kind='operational' and active),
  'Employee change-request capability exists'
);
select ok(
  exists(
    select 1 from public.role_capability_grants grant_row
    join public.roles role on role.id=grant_row.role_id
    where role.code='promotion_lead' and grant_row.capability_code='employee.view_scoped'
  ),
  'promotion lead keeps scoped existing-Employee view'
);
select ok(
  exists(
    select 1 from public.role_capability_grants grant_row
    join public.roles role on role.id=grant_row.role_id
    where role.code='department_lead' and grant_row.capability_code='employee.request_change'
  ),
  'department lead keeps Employee change-request authority'
);
select ok(
  not exists(
    select 1 from public.role_capability_grants grant_row
    join public.roles role on role.id=grant_row.role_id
    where role.code='promotion_lead' and grant_row.capability_code='employee.update'
  ),
  'promotion lead does not gain direct existing-Employee update authority'
);
select ok(
  not exists(
    select 1 from public.role_capability_grants grant_row
    join public.roles role on role.id=grant_row.role_id
    where role.code='super_admin' and grant_row.capability_code like 'employee.%'
  ),
  'technical super-admin has no direct Employee operational capability grant'
);
select ok(
  pg_get_functiondef('public.create_employee(text,date,uuid,uuid,boolean)'::regprocedure)
    ilike '%private_actor_can(''employee.create'')%',
  'Employee create RPC is capability gated'
);
select ok(
  pg_get_functiondef('public.update_employee_core(uuid,text,date,uuid,uuid,text,date,boolean,text)'::regprocedure)
    ilike '%private_actor_can(''employee.update'')%',
  'Employee update RPC is capability gated'
);
select ok(
  pg_get_functiondef('public.submit_employee_change_request(text,uuid,jsonb)'::regprocedure)
    ilike '%private_actor_can(''employee.request_change'')%',
  'Employee request RPC is capability gated'
);
select ok(
  pg_get_functiondef('public.review_employee_change_request(uuid,text,text)'::regprocedure)
    ilike '%private_actor_can(''employee.review_change_requests'')%',
  'Employee request review RPC is capability gated'
);
select is(
  has_function_privilege('authenticated','public.private_update_employee_core_pre148(uuid,text,date,uuid,uuid,text,date,boolean,text)','EXECUTE'),
  false,
  'browser cannot call preserved Employee update implementation directly'
);
select ok(
  exists(
    select 1 from pg_trigger
    where tgrelid='public.employees'::regclass
      and tgname='employees_employee_id_immutable'
      and not tgisinternal
  ),
  'immutable employee_id trigger remains active'
);

select * from finish();
rollback;
