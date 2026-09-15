begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

select is(
  has_function_privilege('authenticated','private.support_ingestion_re_evaluation_candidates_v1(uuid)','EXECUTE'),
  false,
  'authenticated cannot inspect the service-only re-evaluation candidate boundary'
);
select is(
  has_function_privilege('service_role','private.support_ingestion_re_evaluation_candidates_v1(uuid)','EXECUTE'),
  true,
  'service role can inspect succeeded-run re-evaluation candidates'
);

create temporary table semantics_runs (
  label text primary key,
  run_id uuid not null
) on commit drop;

create temporary table semantics_candidates (
  label text primary key,
  candidate jsonb not null
) on commit drop;

insert into semantics_candidates(label, candidate)
values (
  'base',
  jsonb_build_object(
    'contract_version', 'support-radar-phase1-map-v1',
    'source_code', 'bizinfo',
    'support_notice', jsonb_build_object(
      'title', 'Semantics guard fixture',
      'managing_organization', '테스트 기관',
      'implementing_organization', '테스트 수행기관',
      'canonical_url', 'https://www.bizinfo.go.kr/example/PBLN_SEMANTICS_0001',
      'target_regions', '["경남"]'::jsonb,
      'categories', '["인력"]'::jsonb,
      'eligibility_summary', '장애인 고용기업',
      'application_process_summary', '온라인 신청',
      'contact_summary', '테스트 문의처'
    ),
    'support_notice_occurrence', jsonb_build_object(
      'source_notice_id', 'PBLN_SEMANTICS_0001',
      'source_url', 'https://www.bizinfo.go.kr/example/PBLN_SEMANTICS_0001',
      'raw_title', 'Semantics guard fixture',
      'raw_payload', jsonb_build_object(
        'pblancId', 'PBLN_SEMANTICS_0001',
        '_support_radar_ingestion', jsonb_build_object(
          'content_hash_basis_version', 'support-radar-material-v1'
        )
      ),
      'content_hash', repeat('a', 64)
    ),
    'support_documents', '[]'::jsonb,
    'deferred_fields', '[]'::jsonb
  )
);

insert into semantics_runs(label, run_id)
select 'failed_after_write', public.support_ingestion_begin_run_v1(
  'bizinfo',
  'semantics-guard',
  '2026-09-13T05:10:00+09:00'::timestamptz,
  '{"endpoint":"https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do","public_params":{"dataType":"json","pageUnit":"1","pageIndex":"1"}}'::jsonb,
  null,
  'support-radar-ingestion-v1',
  'support-radar-material-v1',
  'support-radar-delta-v1'
);

select is(
  public.support_ingestion_apply_item_checked_v1(
    (select run_id from semantics_runs where label='failed_after_write'),
    (select candidate from semantics_candidates where label='base')
  )->>'delta_status',
  'new',
  'a run can write provenance before a later upstream failure'
);

select is(
  public.support_ingestion_finish_run_v1(
    (select run_id from semantics_runs where label='failed_after_write'),
    '2026-09-13T05:11:00+09:00'::timestamptz,
    null,
    false,
    true,
    'FIXTURE_AFTER_WRITE_FAILURE',
    'safe fixture failure after one prepared item'
  )->>'status',
  'failed',
  'the partially written run is finalized as failed'
);

select is(
  (select occurrence.last_ingestion_run_id
   from public.support_notice_occurrences occurrence
   where occurrence.source_notice_id='PBLN_SEMANTICS_0001'),
  (select run_id from semantics_runs where label='failed_after_write'),
  'last_ingestion_run_id means latest write attempt, not latest successful run'
);

select is(
  (select count(*)::integer
   from private.support_ingestion_re_evaluation_candidates_v1(
     (select run_id from semantics_runs where label='failed_after_write')
   )),
  0,
  'failed-run item events are never exposed as Rule Engine candidates'
);

insert into semantics_runs(label, run_id)
select 'successful_retry', public.support_ingestion_begin_run_v1(
  'bizinfo',
  'semantics-guard',
  '2026-09-13T05:12:00+09:00'::timestamptz,
  '{"endpoint":"https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do","public_params":{"dataType":"json","pageUnit":"1","pageIndex":"1"}}'::jsonb,
  null,
  'support-radar-ingestion-v1',
  'support-radar-material-v1',
  'support-radar-delta-v1'
);

select is(
  public.support_ingestion_apply_item_checked_v1(
    (select run_id from semantics_runs where label='successful_retry'),
    (select candidate from semantics_candidates where label='base')
  )->>'delta_status',
  'unchanged',
  'retry of the exact source facts remains content-wise unchanged'
);

select is(
  (select event.requires_re_evaluation
   from public.support_ingestion_item_events event
   where event.run_id=(select run_id from semantics_runs where label='successful_retry')
   limit 1),
  true,
  'unchanged retry inherits unresolved re-evaluation debt from the failed write'
);

select is(
  public.support_ingestion_finish_run_v1(
    (select run_id from semantics_runs where label='successful_retry'),
    '2026-09-13T05:13:00+09:00'::timestamptz,
    '{"contract_version":"support-radar-page-cursor-v1","page_index":1,"state":"more","next_page_index":2}'::jsonb,
    true,
    null,
    null,
    null
  )->>'requires_re_evaluation_count',
  '1',
  'successful retry run summary preserves the carried re-evaluation requirement'
);

select is(
  (select status from public.support_ingestion_runs
   where id=(select run_id from semantics_runs where label='successful_retry')),
  'succeeded',
  'retry finalizes successfully and becomes authoritative progress'
);

select is(
  (select count(*)::integer
   from private.support_ingestion_re_evaluation_candidates_v1(
     (select run_id from semantics_runs where label='successful_retry')
   )),
  1,
  'succeeded unchanged retry remains eligible for future deterministic evaluation'
);

select ok(
  (select candidate.notice_id is not null
   from private.support_ingestion_re_evaluation_candidates_v1(
     (select run_id from semantics_runs where label='successful_retry')
   ) candidate
   limit 1),
  'succeeded candidate resolves to the existing Phase 1 notice id'
);

insert into semantics_runs(label, run_id)
select 'cursor_guard', public.support_ingestion_begin_run_v1(
  'bizinfo',
  'semantics-guard',
  '2026-09-13T05:14:00+09:00'::timestamptz,
  '{"endpoint":"https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do","public_params":{"dataType":"json","pageUnit":"1","pageIndex":"2"}}'::jsonb,
  '{"contract_version":"support-radar-page-cursor-v1","page_index":1,"state":"more","next_page_index":2}'::jsonb,
  'support-radar-ingestion-v1',
  'support-radar-material-v1',
  'support-radar-delta-v1'
);

select throws_ok(
  $$select public.support_ingestion_finish_run_v1(
      (select run_id from semantics_runs where label='cursor_guard'),
      '2026-09-13T05:15:00+09:00'::timestamptz,
      '{"contract_version":"support-radar-page-cursor-v1","page_index":2,"state":"inconsistent"}'::jsonb,
      true,
      null,
      null,
      null
    )$$,
  '23514'
);

select * from finish();
rollback;
