begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select has_column(
  'public','profile_ui_preferences','collapsed_sections',
  'profile UI preferences store collapsed sidebar categories'
);

select has_function(
  'public','save_my_sidebar_sections',array['text','jsonb'],
  'personal sidebar category writer exists'
);

select ok(
  pg_get_functiondef('public.get_my_ui_preferences(text)'::regprocedure)
    ilike '%collapsed_sections%',
  'personal UI reader returns collapsed sidebar categories'
);

select ok(
  pg_get_functiondef('public.save_my_sidebar_sections(text,jsonb)'::regprocedure)
    ilike '%private_resolve_ui_role%'
  and pg_get_functiondef('public.save_my_sidebar_sections(text,jsonb)'::regprocedure)
    ilike '%auth.uid%',
  'collapsed category writer stays scoped to authenticated profile and role'
);

select ok(
  pg_get_functiondef('public.save_my_sidebar_sections(text,jsonb)'::regprocedure)
    ilike '%jsonb_array_length%'
  and pg_get_functiondef('public.save_my_sidebar_sections(text,jsonb)'::regprocedure)
    ilike '%INVALID_COLLAPSED_SECTION%',
  'collapsed category payload is bounded and validated'
);

select is(
  has_table_privilege('authenticated','public.profile_ui_preferences','SELECT'),
  false,
  'authenticated browser still cannot read profile UI preference table directly'
);

select is(
  has_table_privilege('authenticated','public.profile_ui_preferences','UPDATE'),
  false,
  'authenticated browser still cannot update profile UI preference table directly'
);

select ok(
  exists(
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='profile_ui_preferences'
      and column_name='sidebar_collapsed'
  ),
  'legacy whole-sidebar column remains only for backwards-compatible schema replay'
);

select * from finish();
rollback;
