begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

select ok(to_regclass('public.support_ingestion_runs') is not null, 'ingestion runs table exists');
select ok(to_regclass('public.support_ingestion_source_state') is not null, 'ingestion source state table exists');
select ok(to_regclass('public.support_ingestion_rejects') is not null, 'ingestion rejects table exists');
select ok(to_regclass('public.support_ingestion_item_events') is not null, 'ingestion item events table exists');

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='support_notice_occurrences'
      and column_name='content_hash_basis_version'
  ),
  'occurrence stores content hash basis version'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='support_notice_occurrences'
      and column_name='last_ingestion_run_id'
  ),
  'occurrence links to latest ingestion run'
);

select is(
  (select relrowsecurity from pg_class where oid='public.support_ingestion_runs'::regclass),
  true,
  'ingestion runs use RLS'
);
select is(
  (select relrowsecurity from pg_class where oid='public.support_ingestion_source_state'::regclass),
  true,
  'ingestion source state uses RLS'
);
select is(
  (select relrowsecurity from pg_class where oid='public.support_ingestion_rejects'::regclass),
  true,
  'ingestion rejects use RLS'
);
select is(
  (select relrowsecurity from pg_class where oid='public.support_ingestion_item_events'::regclass),
  true,
  'ingestion item events use RLS'
);

select is(has_table_privilege('authenticated','public.support_ingestion_runs','SELECT'), true, 'authenticated has guarded read grant for ingestion runs');
select is(has_table_privilege('authenticated','public.support_ingestion_runs','INSERT'), false, 'authenticated cannot directly insert ingestion runs');
select is(has_table_privilege('authenticated','public.support_ingestion_source_state','INSERT'), false, 'authenticated cannot directly advance ingestion cursor');
select is(has_table_privilege('authenticated','public.support_ingestion_rejects','INSERT'), false, 'authenticated cannot directly insert ingestion rejects');
select is(has_table_privilege('authenticated','public.support_ingestion_item_events','INSERT'), false, 'authenticated cannot directly insert ingestion item events');

select ok(
  coalesce((
    select qual
    from pg_policies
    where schemaname='public'
      and tablename='support_ingestion_runs'
      and policyname='support_ingestion_runs_management_read'
  ), '') ilike '%private_actor_can%support_radar.management_view%',
  'ingestion run reads use Support Radar management capability'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='support_ingestion_runs'
      and indexname='support_ingestion_runs_source_started_idx'
  ),
  'ingestion run source and time index exists'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid='public.support_ingestion_item_events'::regclass
      and contype='f'
      and confrelid='public.support_notice_occurrences'::regclass
  ),
  'ingestion item events link back to existing notice occurrences'
);

select * from finish();
rollback;
