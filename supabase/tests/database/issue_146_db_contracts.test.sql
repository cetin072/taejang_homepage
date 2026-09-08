begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select is(
  (select attnotnull from pg_attribute where attrelid='public.employees'::regclass and attname='department_id'),
  false,
  'Employee department_id allows the explicit unassigned state'
);

select is(
  (select count(*)::integer from pg_constraint
   where conrelid='public.homepage_change_requests'::regclass
     and conname='homepage_change_requests_page_key_check'),
  0,
  'legacy homepage page-key CHECK is removed in favor of the slot registry'
);

select is(
  (select count(*)::integer from pg_constraint
   where conrelid='public.homepage_change_requests'::regclass
     and conname='homepage_change_requests_page_section_allowlist'),
  0,
  'legacy homepage page-section CHECK is removed in favor of the slot registry'
);

select ok(
  exists (
    select 1 from public.homepage_content_slots
    where active and page_key='community_esg' and slot_key='community_esg.hero.title'
  ),
  'canonical homepage slot registry includes the real community ESG page'
);

select ok(
  pg_get_functiondef('public.create_homepage_slot_change_request(text,text,text,text,text,text)'::regprocedure)
    ilike '%promotion_validate_url%',
  'canonical homepage image request RPC validates URLs server-side'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.create_homepage_change_request(text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  false,
  'authenticated clients cannot call the legacy non-slot homepage request RPC'
);

select ok(
  pg_get_functiondef('public.get_employee_management_context()'::regprocedure)
    ilike '%left join public.departments%',
  'employee management can represent unassigned employees'
);

select ok(
  pg_get_functiondef('public.update_employee_core(uuid,text,date,uuid,uuid,text,date,boolean,text)'::regprocedure)
    ilike '%EMPLOYEE_ARCHIVED_RESTORE_FIRST%',
  'archived Employees cannot be modified through the ordinary update RPC'
);

select * from finish();
rollback;
