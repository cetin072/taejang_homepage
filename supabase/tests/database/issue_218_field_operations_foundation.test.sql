begin;

create extension if not exists pgtap with schema extensions;
select plan(26);

select has_table('public', 'work_group_employee_memberships', 'Employee-based work-group membership exists');
select has_table('public', 'field_work_templates', 'field recurring template table exists');
select has_table('public', 'field_assignment_employee_overrides', 'daily Employee override table exists');

select is(
  has_table_privilege('authenticated', 'public.work_group_employee_memberships', 'SELECT'),
  false,
  'authenticated browser cannot read field membership table directly'
);
select is(
  has_table_privilege('authenticated', 'public.work_group_employee_memberships', 'INSERT'),
  false,
  'authenticated browser cannot write field membership table directly'
);
select is(
  has_table_privilege('authenticated', 'public.field_work_templates', 'SELECT'),
  false,
  'authenticated browser cannot read field template table directly'
);
select is(
  has_table_privilege('authenticated', 'public.field_work_templates', 'INSERT'),
  false,
  'authenticated browser cannot write field template table directly'
);
select is(
  has_table_privilege('authenticated', 'public.field_assignment_employee_overrides', 'SELECT'),
  false,
  'authenticated browser cannot read field override table directly'
);
select is(
  has_table_privilege('authenticated', 'public.field_assignment_employee_overrides', 'INSERT'),
  false,
  'authenticated browser cannot write field override table directly'
);

select is(
  (select count(*)::integer from public.platform_capabilities where code in (
    'field.membership.manage', 'field.template.manage', 'field.assignment.manage'
  )),
  3,
  'all Phase D field capabilities are registered'
);

select ok(
  not exists (
    select 1 from public.platform_capabilities
    where code in ('field.membership.manage', 'field.template.manage', 'field.assignment.manage')
      and (capability_kind <> 'operational' or not operations_manager_auto_grant or not active)
  ),
  'field capabilities are active operational capabilities inherited by operations manager'
);

select is(
  (
    select count(*)::integer
    from public.role_capability_grants grant_row
    join public.roles role on role.id = grant_row.role_id
    where role.code = 'department_lead'
      and grant_row.capability_code in ('field.membership.manage', 'field.template.manage', 'field.assignment.manage')
  ),
  3,
  'department lead receives all three Phase D management capabilities'
);

select is(
  (
    select count(*)::integer
    from public.role_capability_grants grant_row
    join public.roles role on role.id = grant_row.role_id
    where role.code = 'field_lead'
      and grant_row.capability_code in ('field.template.manage', 'field.assignment.manage')
  ),
  2,
  'field lead receives template and daily assignment capabilities'
);

select ok(
  not exists (
    select 1
    from public.role_capability_grants grant_row
    join public.roles role on role.id = grant_row.role_id
    where role.code = 'field_lead'
      and grant_row.capability_code = 'field.membership.manage'
  ),
  'field lead cannot mutate the formal Employee work-group roster'
);

select ok(to_regprocedure('public.list_field_work_group_members(uuid,date)') is not null,
  'field membership list RPC exists');
select ok(to_regprocedure('public.set_field_work_group_employee(uuid,uuid,public.work_group_member_type,date,date,text)') is not null,
  'field membership mutation RPC exists');
select ok(to_regprocedure('public.list_field_work_templates(uuid,boolean)') is not null,
  'field template list RPC exists');
select ok(to_regprocedure('public.save_field_work_template(uuid,uuid,text,text,uuid,uuid,text,text,text,uuid,text,text,text,time without time zone,time without time zone,smallint,boolean,public.board_record_status,text)') is not null,
  'field template mutation RPC exists');
select ok(to_regprocedure('public.create_field_assignment_from_template(uuid,date,public.field_time_block,uuid,uuid,text,text,public.board_record_status,text)') is not null,
  'template-to-daily-assignment RPC exists');
select ok(to_regprocedure('public.set_field_assignment_employee_override(uuid,uuid,public.field_assignment_override_action,boolean,text)') is not null,
  'daily Employee override RPC exists');
select ok(to_regprocedure('public.get_field_assignment_roster(uuid)') is not null,
  'effective daily roster RPC exists');

select is(
  has_function_privilege('authenticated', 'public.private_actor_can_manage_field_department(text,uuid)', 'EXECUTE'),
  false,
  'authenticated browser cannot execute private field department authorization helper'
);
select is(
  has_function_privilege('authenticated', 'public.private_actor_can_manage_field_group(text,uuid)', 'EXECUTE'),
  false,
  'authenticated browser cannot execute private field work-group authorization helper'
);

select is(
  has_function_privilege('authenticated', 'public.list_field_work_group_members(uuid,date)', 'EXECUTE'),
  true,
  'authenticated clients may enter guarded field roster list RPC'
);
select is(
  has_function_privilege('authenticated', 'public.create_field_assignment_from_template(uuid,date,public.field_time_block,uuid,uuid,text,text,public.board_record_status,text)', 'EXECUTE'),
  true,
  'authenticated clients may enter guarded field assignment RPC'
);

select ok(
  pg_get_functiondef('public.current_user_in_work_group(uuid)'::regprocedure)
    ilike '%work_group_employee_memberships%'
  and pg_get_functiondef('public.current_user_in_work_group(uuid)'::regprocedure)
    ilike '%account_person_links%',
  'current work-group membership resolves both legacy Profile and authoritative Employee membership'
);

select ok(
  pg_get_functiondef('public.private_profile_leads_work_group(uuid,uuid)'::regprocedure)
    ilike '%work_group_members%'
  and pg_get_functiondef('public.private_profile_leads_work_group(uuid,uuid)'::regprocedure)
    ilike '%work_group_employee_memberships%'
  and pg_get_functiondef('public.private_profile_leads_work_group(uuid,uuid)'::regprocedure)
    ilike '%account_person_links%',
  'field-lead scope bridges existing Profile leads and linked Employee leads without guessing identities'
);

select * from finish();
rollback;
