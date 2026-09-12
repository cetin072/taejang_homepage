begin;

create extension if not exists pgtap with schema extensions;
select plan(49);

select is(
  has_function_privilege('authenticated','public.support_ingestion_begin_run_v1(text,text,timestamptz,jsonb,jsonb,text,text,text)','EXECUTE'),
  false,
  'authenticated cannot start ingestion runs'
);
select is(
  has_function_privilege('authenticated','private.support_ingestion_apply_item_v1(uuid,jsonb)','EXECUTE'),
  false,
  'authenticated cannot execute the private raw ingestion writer'
);
select is(
  has_function_privilege('authenticated','public.support_ingestion_apply_item_checked_v1(uuid,jsonb)','EXECUTE'),
  false,
  'authenticated cannot execute the source-checked ingestion writer'
);
select is(
  has_function_privilege('authenticated','public.support_ingestion_record_reject_v1(uuid,integer,text,text,jsonb)','EXECUTE'),
  false,
  'authenticated cannot append ingestion rejects'
);
select is(
  has_function_privilege('authenticated','public.support_ingestion_finish_run_v1(uuid,timestamptz,jsonb,boolean,boolean,text,text)','EXECUTE'),
  false,
  'authenticated cannot finish ingestion runs'
);
select is(
  has_function_privilege('authenticated','public.support_ingestion_metadata_is_safe(jsonb)','EXECUTE'),
  false,
  'authenticated cannot invoke the shared ingestion metadata guard directly'
);

select is(
  has_function_privilege('service_role','public.support_ingestion_begin_run_v1(text,text,timestamptz,jsonb,jsonb,text,text,text)','EXECUTE'),
  true,
  'service role can start prepared ingestion runs'
);
select is(
  has_function_privilege('service_role','private.support_ingestion_apply_item_v1(uuid,jsonb)','EXECUTE'),
  true,
  'service role can execute the private raw writer only inside the trusted server boundary'
);
select is(
  has_function_privilege('service_role','public.support_ingestion_apply_item_checked_v1(uuid,jsonb)','EXECUTE'),
  true,
  'service role can execute the source-checked ingestion facade'
);
select is(
  has_function_privilege('service_role','public.support_ingestion_record_reject_v1(uuid,integer,text,text,jsonb)','EXECUTE'),
  true,
  'service role can append ingestion rejects'
);
select is(
  has_function_privilege('service_role','public.support_ingestion_finish_run_v1(uuid,timestamptz,jsonb,boolean,boolean,text,text)','EXECUTE'),
  true,
  'service role can finish prepared ingestion runs'
);
select is(
  has_function_privilege('service_role','public.support_ingestion_metadata_is_safe(jsonb)','EXECUTE'),
  true,
  'service role can invoke the shared ingestion metadata guard inside the server boundary'
);

select ok(
  public.support_ingestion_public_request_is_safe(
    '{"endpoint":"https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do","public_params":{"dataType":"json","pageUnit":"2","pageIndex":"1"}}'::jsonb
  ),
  'public request metadata accepts documented non-sensitive fields'
);
select is(
  public.support_ingestion_public_request_is_safe(
    '{"public_params":{"unexpectedKeyField":"do-not-store"}}'::jsonb
  ),
  false,
  'public request metadata rejects key-like private fields recursively'
);
select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname='public'
      and tablename='support_ingestion_runs'
      and indexname='support_ingestion_runs_one_running_per_stream_idx'
  ),
  'only one running ingestion run is allowed per source stream'
);

create temporary table ingestion_test_runs (
  label text primary key,
  run_id uuid not null
) on commit drop;

create temporary table ingestion_test_candidates (
  label text primary key,
  candidate jsonb not null
) on commit drop;

insert into ingestion_test_candidates(label, candidate)
values (
  'base',
  jsonb_build_object(
    'contract_version', 'support-radar-phase1-map-v1',
    'source_code', 'bizinfo',
    'support_notice', jsonb_build_object(
      'title', 'DB fixture 작업환경 개선 지원사업',
      'managing_organization', '테스트 중앙기관',
      'implementing_organization', '테스트 수행기관',
      'canonical_url', 'https://www.bizinfo.go.kr/example/PBLN_DB_FIXTURE_0001',
      'target_regions', '["경남"]'::jsonb,
      'categories', '["인력"]'::jsonb,
      'eligibility_summary', '고용 중소기업',
      'application_process_summary', '온라인 신청',
      'contact_summary', '테스트 문의처'
    ),
    'support_notice_occurrence', jsonb_build_object(
      'source_notice_id', 'PBLN_DB_FIXTURE_0001',
      'source_url', 'https://www.bizinfo.go.kr/example/PBLN_DB_FIXTURE_0001',
      'raw_title', 'DB fixture 작업환경 개선 지원사업',
      'raw_payload', jsonb_build_object(
        'pblancId', 'PBLN_DB_FIXTURE_0001',
        '_support_radar_ingestion', jsonb_build_object(
          'content_hash_basis_version', 'support-radar-material-v1',
          'application_period_raw', '20260901 ~ 20260930'
        )
      ),
      'content_hash', repeat('a', 64)
    ),
    'support_documents', jsonb_build_array(
      jsonb_build_object(
        'document_type', 'attachment',
        'original_filename', '공고문.pdf',
        'source_url', 'https://www.bizinfo.go.kr/files/PBLN_DB_FIXTURE_0001.pdf',
        'content_hash', null
      )
    ),
    'deferred_fields', jsonb_build_array(
      jsonb_build_object(
        'target_column', 'deadline_at',
        'value', '2026-09-30',
        'precision', 'date',
        'action', 'defer'
      )
    )
  )
);

insert into ingestion_test_runs(label, run_id)
select
  'first',
  public.support_ingestion_begin_run_v1(
    'bizinfo',
    'default',
    '2026-09-13T02:20:00+09:00'::timestamptz,
    '{"endpoint":"https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do","public_params":{"dataType":"json","pageUnit":"2","pageIndex":"1"}}'::jsonb,
    '{"contract_version":"support-radar-page-cursor-v1","page_index":1}'::jsonb,
    'support-radar-ingestion-v1',
    'support-radar-material-v1',
    'support-radar-delta-v1'
  );

select is(
  (select status from public.support_ingestion_runs where id=(select run_id from ingestion_test_runs where label='first')),
  'running',
  'begin run creates a running ledger record'
);

select throws_ok(
  $$select public.support_ingestion_apply_item_checked_v1(
      (select run_id from ingestion_test_runs where label='first'),
      jsonb_set((select candidate from ingestion_test_candidates where label='base'), '{source_code}', '"enaradoom"'::jsonb)
    )$$,
  'P0001',
  'SUPPORT_INGESTION_SOURCE_MISMATCH',
  'source-checked writer rejects a candidate from another source'
);

select is(
  public.support_ingestion_apply_item_checked_v1(
    (select run_id from ingestion_test_runs where label='first'),
    (select candidate from ingestion_test_candidates where label='base')
  )->>'delta_status',
  'new',
  'first prepared item is classified as new'
);

select is(
  (select count(*)::integer from public.support_notice_occurrences where source_notice_id='PBLN_DB_FIXTURE_0001'),
  1,
  'writer creates one authoritative occurrence'
);
select is(
  (select count(*)::integer from public.support_notices notice
   join public.support_notice_occurrences occurrence on occurrence.notice_id=notice.id
   where occurrence.source_notice_id='PBLN_DB_FIXTURE_0001'),
  1,
  'writer creates one existing Phase 1 notice record'
);
select is(
  (select count(*)::integer from public.support_documents document
   join public.support_notice_occurrences occurrence on occurrence.id=document.occurrence_id
   where occurrence.source_notice_id='PBLN_DB_FIXTURE_0001'),
  1,
  'writer adds fixture document metadata without a second notice store'
);
select is_null(
  (select deadline_at from public.support_notices notice
   join public.support_notice_occurrences occurrence on occurrence.notice_id=notice.id
   where occurrence.source_notice_id='PBLN_DB_FIXTURE_0001'),
  'writer does not invent a timestamp for deferred date-only deadline'
);

select is(
  public.support_ingestion_finish_run_v1(
    (select run_id from ingestion_test_runs where label='first'),
    '2026-09-13T02:21:00+09:00'::timestamptz,
    '{"contract_version":"support-radar-page-cursor-v1","page_index":1,"state":"more","next_page_index":2}'::jsonb,
    true,
    null,
    null,
    null
  )->>'status',
  'succeeded',
  'successful run finalizes as succeeded'
);

select is(
  (select cursor->>'next_page_index'
   from public.support_ingestion_source_state state_row
   join public.support_sources source on source.id=state_row.source_id
   where source.code='bizinfo' and state_row.stream_key='default'),
  '2',
  'successful run advances authoritative source cursor'
);

insert into ingestion_test_runs(label, run_id)
select
  'second',
  public.support_ingestion_begin_run_v1(
    'bizinfo',
    'default',
    '2026-09-13T02:22:00+09:00'::timestamptz,
    '{"endpoint":"https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do","public_params":{"dataType":"json","pageUnit":"2","pageIndex":"2"}}'::jsonb,
    '{"contract_version":"support-radar-page-cursor-v1","page_index":1,"state":"more","next_page_index":2}'::jsonb,
    'support-radar-ingestion-v1',
    'support-radar-material-v1',
    'support-radar-delta-v1'
  );

select is(
  public.support_ingestion_apply_item_checked_v1(
    (select run_id from ingestion_test_runs where label='second'),
    (select candidate from ingestion_test_candidates where label='base')
  )->>'delta_status',
  'unchanged',
  'identical reingestion is classified as unchanged'
);

select is(
  (select count(*)::integer from public.support_notices notice
   join public.support_notice_occurrences occurrence on occurrence.notice_id=notice.id
   where occurrence.source_notice_id='PBLN_DB_FIXTURE_0001'),
  1,
  'unchanged reingestion does not duplicate the notice'
);
select is(
  (select count(*)::integer from public.support_documents document
   join public.support_notice_occurrences occurrence on occurrence.id=document.occurrence_id
   where occurrence.source_notice_id='PBLN_DB_FIXTURE_0001'),
  1,
  'unchanged reingestion does not duplicate identical document metadata'
);

select is(
  public.support_ingestion_finish_run_v1(
    (select run_id from ingestion_test_runs where label='second'),
    '2026-09-13T02:23:00+09:00'::timestamptz,
    '{"contract_version":"support-radar-page-cursor-v1","page_index":2,"state":"more","next_page_index":3}'::jsonb,
    true,
    null,
    null,
    null
  )->>'status',
  'succeeded',
  'second successful run finalizes cleanly'
);

insert into ingestion_test_runs(label, run_id)
select
  'failed',
  public.support_ingestion_begin_run_v1(
    'bizinfo',
    'default',
    '2026-09-13T02:24:00+09:00'::timestamptz,
    '{"endpoint":"https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do","public_params":{"dataType":"json","pageUnit":"2","pageIndex":"3"}}'::jsonb,
    '{"contract_version":"support-radar-page-cursor-v1","page_index":2,"state":"more","next_page_index":3}'::jsonb,
    'support-radar-ingestion-v1',
    'support-radar-material-v1',
    'support-radar-delta-v1'
  );

select is(
  public.support_ingestion_finish_run_v1(
    (select run_id from ingestion_test_runs where label='failed'),
    '2026-09-13T02:25:00+09:00'::timestamptz,
    '{"contract_version":"support-radar-page-cursor-v1","page_index":3,"state":"more","next_page_index":4}'::jsonb,
    false,
    true,
    'FIXTURE_UPSTREAM_FAILURE',
    'offline fixture failure'
  )->>'status',
  'failed',
  'failed run records explicit failure state'
);

select is(
  (select cursor->>'next_page_index'
   from public.support_ingestion_source_state state_row
   join public.support_sources source on source.id=state_row.source_id
   where source.code='bizinfo' and state_row.stream_key='default'),
  '3',
  'failed run does not advance the last successful cursor'
);

select is(
  (select error_code from public.support_ingestion_runs where id=(select run_id from ingestion_test_runs where label='failed')),
  'FIXTURE_UPSTREAM_FAILURE',
  'failed run preserves deterministic error code'
);

select is(
  (select count(*)::integer
   from public.support_ingestion_item_events event
   join public.support_ingestion_runs run on run.id=event.run_id
   where run.id in (select run_id from ingestion_test_runs where label in ('first','second'))),
  2,
  'each applied item leaves one ingestion event'
);

select is(
  (select count(*)::integer from public.support_notices notice
   join public.support_notice_occurrences occurrence on occurrence.notice_id=notice.id
   where occurrence.source_notice_id='PBLN_DB_FIXTURE_0001'),
  1,
  'replay remains idempotent after success and failure runs'
);

select throws_ok(
  $$select public.support_ingestion_begin_run_v1(
      'bizinfo',
      'default',
      '2026-09-13T02:25:30+09:00'::timestamptz,
      '{"endpoint":"https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do"}'::jsonb,
      '{"token":"not-for-ledger"}'::jsonb,
      'support-radar-ingestion-v1',
      'support-radar-material-v1',
      'support-radar-delta-v1'
    )$$,
  'P0001',
  'SUPPORT_INGESTION_CURSOR_UNSAFE',
  'cursor provenance rejects credential-shaped metadata before a run is created'
);

select throws_ok(
  $$select public.support_ingestion_begin_run_v1(
      'bizinfo',
      'default',
      '2026-09-13T02:25:45+09:00'::timestamptz,
      '{"endpoint":"https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do"}'::jsonb,
      '{"contract_version":"support-radar-page-cursor-v1","page_index":1}'::jsonb,
      'support-radar-ingestion-v1',
      'support-radar-material-v1',
      'support-radar-delta-v1'
    )$$,
  'P0001',
  'SUPPORT_INGESTION_CURSOR_STALE',
  'a stale cursor cannot begin a new run after a prior success'
);

insert into ingestion_test_runs(label, run_id)
select
  'input_guard',
  public.support_ingestion_begin_run_v1(
    'bizinfo',
    'default',
    '2026-09-13T02:26:00+09:00'::timestamptz,
    '{"endpoint":"https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do","public_params":{"dataType":"json"}}'::jsonb,
    '{"contract_version":"support-radar-page-cursor-v1","page_index":2,"state":"more","next_page_index":3}'::jsonb,
    'support-radar-ingestion-v1',
    'support-radar-material-v1',
    'support-radar-delta-v1'
  );

select is(
  public.support_ingestion_metadata_is_safe(
    '{"source_url":"https://example.invalid/notice?api_key=not-for-ledger"}'::jsonb
  ),
  false,
  'credential-shaped values are rejected even when hidden inside a URL'
);

select throws_ok(
  $$select public.support_ingestion_apply_item_checked_v1(
      (select run_id from ingestion_test_runs where label='input_guard'),
      jsonb_set(
        (select candidate from ingestion_test_candidates where label='base'),
        '{support_notice_occurrence,raw_payload,authorization}',
        '"Bearer not-for-ledger"'::jsonb,
        true
      )
    )$$,
  'P0001',
  'SUPPORT_INGESTION_CANDIDATE_UNSAFE',
  'writer rejects credential-shaped candidate provenance before a database write'
);

select throws_ok(
  $$select public.support_ingestion_record_reject_v1(
      (select run_id from ingestion_test_runs where label='input_guard'),
      0,
      'PBLN_DB_FIXTURE_0001',
      'MALFORMED_SOURCE_ITEM',
      '{"token":"not-for-ledger"}'::jsonb
    )$$,
  'P0001',
  'SUPPORT_INGESTION_REJECT_DETAILS_UNSAFE',
  'reject ledger refuses credential-shaped diagnostics'
);

select is(
  public.support_ingestion_finish_run_v1(
    (select run_id from ingestion_test_runs where label='input_guard'),
    '2026-09-13T02:27:00+09:00'::timestamptz,
    '{"contract_version":"support-radar-page-cursor-v1","page_index":3,"state":"more","next_page_index":4}'::jsonb,
    true,
    null,
    null,
    null
  )->>'status',
  'succeeded',
  'a later successful run can safely advance the cursor after a previous failed run'
);

insert into ingestion_test_runs(label, run_id)
select
  'error_guard',
  public.support_ingestion_begin_run_v1(
    'bizinfo',
    'default',
    '2026-09-13T02:27:30+09:00'::timestamptz,
    '{"endpoint":"https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do","public_params":{"dataType":"json"}}'::jsonb,
    '{"contract_version":"support-radar-page-cursor-v1","page_index":3,"state":"more","next_page_index":4}'::jsonb,
    'support-radar-ingestion-v1',
    'support-radar-material-v1',
    'support-radar-delta-v1'
  );

select throws_ok(
  $$select public.support_ingestion_finish_run_v1(
      (select run_id from ingestion_test_runs where label='error_guard'),
      '2026-09-13T02:27:45+09:00'::timestamptz,
      null,
      false,
      true,
      'UPSTREAM_FAILURE',
      'upstream URL included ?api_key=not-for-ledger'
    )$$,
  'P0001',
  'SUPPORT_INGESTION_ERROR_SUMMARY_UNSAFE',
  'failure ledger refuses credential-shaped error summaries'
);

select is(
  public.support_ingestion_finish_run_v1(
    (select run_id from ingestion_test_runs where label='error_guard'),
    '2026-09-13T02:28:00+09:00'::timestamptz,
    null,
    false,
    true,
    'UPSTREAM_FAILURE',
    'safe offline failure summary'
  )->>'status',
  'failed',
  'safe failure summary can finalize the failed run without cursor movement'
);

insert into ingestion_test_runs(label, run_id)
select
  'changed',
  public.support_ingestion_begin_run_v1(
    'bizinfo',
    'default',
    '2026-09-13T02:28:00+09:00'::timestamptz,
    '{"endpoint":"https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do","public_params":{"dataType":"json","pageIndex":"4"}}'::jsonb,
    '{"contract_version":"support-radar-page-cursor-v1","page_index":3,"state":"more","next_page_index":4}'::jsonb,
    'support-radar-ingestion-v1',
    'support-radar-material-v1',
    'support-radar-delta-v1'
  );

select is(
  public.support_ingestion_apply_item_checked_v1(
    (select run_id from ingestion_test_runs where label='changed'),
    jsonb_set(
      jsonb_set(
        (select candidate from ingestion_test_candidates where label='base'),
        '{support_notice,eligibility_summary}',
        '"고용 중소기업 및 장애인 표준사업장"'::jsonb
      ),
      '{support_notice_occurrence,content_hash}',
      to_jsonb(repeat('b', 64))
    )
  )->>'delta_status',
  'changed',
  'material field change updates the existing notice instead of creating a duplicate'
);

select is(
  (select eligibility_summary from public.support_notices notice
   join public.support_notice_occurrences occurrence on occurrence.notice_id=notice.id
   where occurrence.source_notice_id='PBLN_DB_FIXTURE_0001'),
  '고용 중소기업 및 장애인 표준사업장',
  'changed replay writes revised material facts into the existing Phase 1 notice'
);

select is(
  (select count(*)::integer from public.support_notices notice
   join public.support_notice_occurrences occurrence on occurrence.notice_id=notice.id
   where occurrence.source_notice_id='PBLN_DB_FIXTURE_0001'),
  1,
  'changed replay preserves one authoritative notice'
);

select is(
  public.support_ingestion_finish_run_v1(
    (select run_id from ingestion_test_runs where label='changed'),
    '2026-09-13T02:29:00+09:00'::timestamptz,
    '{"contract_version":"support-radar-page-cursor-v1","page_index":4,"state":"more","next_page_index":5}'::jsonb,
    true,
    null,
    null,
    null
  )->>'requires_re_evaluation_count',
  '1',
  'changed replay is marked for deterministic re-evaluation without running it automatically'
);

insert into ingestion_test_runs(label, run_id)
select
  'basis_changed',
  public.support_ingestion_begin_run_v1(
    'bizinfo',
    'default',
    '2026-09-13T02:30:00+09:00'::timestamptz,
    '{"endpoint":"https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do","public_params":{"dataType":"json","pageIndex":"5"}}'::jsonb,
    '{"contract_version":"support-radar-page-cursor-v1","page_index":4,"state":"more","next_page_index":5}'::jsonb,
    'support-radar-ingestion-v1',
    'support-radar-material-v2',
    'support-radar-delta-v1'
  );

select is(
  public.support_ingestion_apply_item_checked_v1(
    (select run_id from ingestion_test_runs where label='basis_changed'),
    jsonb_set(
      jsonb_set(
        (select candidate from ingestion_test_candidates where label='base'),
        '{support_notice_occurrence,raw_payload,_support_radar_ingestion,content_hash_basis_version}',
        '"support-radar-material-v2"'::jsonb
      ),
      '{support_notice_occurrence,content_hash}',
      to_jsonb(repeat('c', 64))
    )
  )->>'delta_status',
  'basis_changed',
  'hash-contract change is recorded as rebaseline rather than a false source revision'
);

select is(
  (select content_hash_basis_version from public.support_notice_occurrences
   where source_notice_id='PBLN_DB_FIXTURE_0001'),
  'support-radar-material-v2',
  'rebaseline preserves the new hash-contract provenance on the existing occurrence'
);

select is(
  (select count(*)::integer from public.support_notices notice
   join public.support_notice_occurrences occurrence on occurrence.notice_id=notice.id
   where occurrence.source_notice_id='PBLN_DB_FIXTURE_0001'),
  1,
  'rebaseline also preserves one authoritative notice'
);

select is(
  public.support_ingestion_finish_run_v1(
    (select run_id from ingestion_test_runs where label='basis_changed'),
    '2026-09-13T02:31:00+09:00'::timestamptz,
    '{"contract_version":"support-radar-page-cursor-v1","page_index":5,"state":"complete"}'::jsonb,
    true,
    null,
    null,
    null
  )->>'requires_re_evaluation_count',
  '1',
  'rebaseline is marked for deterministic re-evaluation without changing a human decision'
);

select * from finish();
rollback;
