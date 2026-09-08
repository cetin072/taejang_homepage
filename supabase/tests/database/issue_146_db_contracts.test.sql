begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

select is(
  (select attnotnull from pg_attribute where attrelid='public.employees'::regclass and attname='department_id'),
  false,
  'Employee department_id allows the explicit unassigned state'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid='public.homepage_change_requests'::regclass
      and conname='homepage_change_requests_page_key_check'
      and pg_get_constraintdef(oid) ilike '%community_esg%'
  ),
  'homepage page-key constraint includes community_esg'
);

select ok(
  pg_get_functiondef('public.create_homepage_change_request(text,text,text,text,text,text,text,text)'::regprocedure)
    ilike '%promotion_validate_url%',
  'homepage image request RPC validates URLs server-side'
);

select ok(
  pg_get_functiondef('public.get_employee_management_context()'::regprocedure)
    ilike '%left join public.departments%',
  'employee management keeps unassigned employees visible'
);

select ok(
  pg_get_functiondef('public.update_employee_core(uuid,text,date,uuid,uuid,text,date,boolean,text)'::regprocedure)
    ilike '%ARCHIVED_EMPLOYEE_UPDATE_FORBIDDEN%',
  'archived Employees cannot be modified through the ordinary update RPC'
);

select * from finish();
rollback;
