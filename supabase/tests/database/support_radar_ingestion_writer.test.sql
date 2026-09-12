begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

select is(
  has_function_privilege('authenticated','public.support_ingestion_begin_run_v1(text,text,timestamptz,jsonb,jsonb,text,text,text)','EXECUTE'),
  false,
  'authenticated cannot start ingestion runs'
);
select is(
  has_function_privilege('authenticated','public.support_ingestion_apply_item_v1(uuid,jsonb)','EXECUTE'),
  false,
  'authenticated cannot apply ingestion items'
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
  has_function_privilege('service_role','public.support_ingestion_begin_run_v1(text,text,timestamptz,jsonb,jsonb,text,text,text)','EXECUTE'),
  true,
  'service role can start prepared ingestion runs'
);
select is(
  has_function_privilege('service_role','public.support_ingestion_apply_item_v1(uuid,jsonb)','EXECUTE'),
  true,
  'service role can apply prepared ingestion items'
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

select is(
  public.support_ingestion_apply_item_v1(
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
  public.support_ingestion_apply_item_v1(
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

select * from finish();
rollback;
