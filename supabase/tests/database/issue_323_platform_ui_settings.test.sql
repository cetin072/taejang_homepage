begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select has_table('public','role_navigation_visibility','role navigation visibility table exists');
select has_table('public','profile_ui_preferences','profile UI preference table exists');

select is(
  has_table_privilege('authenticated','public.role_navigation_visibility','SELECT'),
  false,
  'authenticated clients cannot read role navigation settings table directly'
);

select is(
  has_table_privilege('authenticated','public.profile_ui_preferences','SELECT'),
  false,
  'authenticated clients cannot read profile UI preferences directly'
);

select has_function('public','get_my_ui_preferences',array['text'],'personal UI preference reader exists');
select has_function('public','save_my_ui_preferences',array['text','boolean','jsonb'],'personal UI preference writer exists');
select has_function('public','get_my_navigation_visibility',array['text'],'personal role visibility reader exists');
select has_function('public','get_platform_navigation_settings',array[]::text[],'operations navigation settings reader exists');
select has_function('public','save_role_navigation_visibility',array['text','jsonb'],'operations navigation settings writer exists');
select has_function('public','reset_role_navigation_visibility',array['text'],'operations navigation reset exists');

select is(
  (select operations_manager_auto_grant from public.platform_capabilities where code='platform.navigation.manage'),
  true,
  'operations manager automatically receives platform navigation management'
);

select ok(
  pg_get_functiondef('public.get_platform_navigation_settings()'::regprocedure)
    ilike '%private_actor_can(''platform.navigation.manage'')%',
  'platform navigation settings reader requires management capability'
);

select ok(
  pg_get_functiondef('public.save_role_navigation_visibility(text,jsonb)'::regprocedure)
    ilike '%private_actor_can(''platform.navigation.manage'')%',
  'role navigation writer requires management capability'
);

select ok(
  pg_get_functiondef('public.save_my_ui_preferences(text,boolean,jsonb)'::regprocedure)
    ilike '%auth.uid%'
  and pg_get_functiondef('public.save_my_ui_preferences(text,boolean,jsonb)'::regprocedure)
    ilike '%private_resolve_ui_role%',
  'personal UI preference writer is scoped to the authenticated profile and role context'
);

select * from finish();
rollback;
