begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

select is(
  has_function_privilege('authenticated','private.support_ingestion_http_url_is_safe(text)','EXECUTE'),
  false,
  'authenticated cannot execute the private ingestion URL helper'
);
select is(
  has_function_privilege('authenticated','private.support_ingestion_candidate_urls_are_safe(jsonb)','EXECUTE'),
  false,
  'authenticated cannot execute the private candidate URL helper'
);
select is(
  has_function_privilege('service_role','private.support_ingestion_candidate_urls_are_safe(jsonb)','EXECUTE'),
  true,
  'service role can validate candidate URLs inside the trusted ingestion boundary'
);

select is(
  private.support_ingestion_http_url_is_safe('https://www.bizinfo.go.kr/example/PBLN_URL_GUARD'),
  true,
  'documented HTTPS Source URLs are accepted'
);
select is(
  private.support_ingestion_http_url_is_safe('https:///missing-host'),
  false,
  'hostless HTTP(S) URLs are rejected'
);
select is(
  private.support_ingestion_http_url_is_safe('https://user:password@example.invalid/notice'),
  false,
  'credential-bearing URL authorities are rejected'
);

create temporary table url_guard_runs (
  run_id uuid primary key
) on commit drop;

create temporary table url_guard_candidates (
  candidate jsonb not null
) on commit drop;

insert into url_guard_candidates(candidate)
values (
  jsonb_build_object(
    'contract_version', 'support-radar-phase1-map-v1',
    'source_code', 'bizinfo',
    'support_notice', jsonb_build_object(
      'title', 'URL guard fixture',
      'managing_organization', '테스트 기관',
      'implementing_organization', '테스트 수행기관',
      'canonical_url', 'https://www.bizinfo.go.kr/example/PBLN_URL_GUARD',
      'target_regions', '["경남"]'::jsonb,
      'categories', '["인력"]'::jsonb,
      'eligibility_summary', '장애인 고용기업',
      'application_process_summary', '온라인 신청',
      'contact_summary', '테스트 문의처'
    ),
    'support_notice_occurrence', jsonb_build_object(
      'source_notice_id', 'PBLN_URL_GUARD',
      'source_url', 'https://www.bizinfo.go.kr/example/PBLN_URL_GUARD',
      'raw_title', 'URL guard fixture',
      'raw_payload', jsonb_build_object(
        'pblancId', 'PBLN_URL_GUARD',
        '_support_radar_ingestion', jsonb_build_object(
          'content_hash_basis_version', 'support-radar-material-v1',
          'application_url', 'https://www.bizinfo.go.kr/apply/PBLN_URL_GUARD'
        )
      ),
      'content_hash', repeat('a', 64)
    ),
    'support_documents', jsonb_build_array(
      jsonb_build_object(
        'document_type', 'attachment',
        'original_filename', '공고문.pdf',
        'source_url', 'https://www.bizinfo.go.kr/files/PBLN_URL_GUARD.pdf',
        'content_hash', null
      )
    ),
    'deferred_fields', '[]'::jsonb
  )
);

insert into url_guard_runs(run_id)
select public.support_ingestion_begin_run_v1(
  'bizinfo',
  'url-guard',
  '2026-09-13T05:20:00+09:00'::timestamptz,
  '{"endpoint":"https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do","public_params":{"dataType":"json"}}'::jsonb,
  null,
  'support-radar-ingestion-v1',
  'support-radar-material-v1',
  'support-radar-delta-v1'
);

select throws_ok(
  $$select public.support_ingestion_apply_item_checked_v1(
      (select run_id from url_guard_runs limit 1),
      jsonb_set(
        (select candidate from url_guard_candidates limit 1),
        '{support_notice_occurrence,source_url}',
        '"javascript:alert(1)"'::jsonb
      )
    )$$,
  'P0001',
  'SUPPORT_INGESTION_URL_UNSAFE',
  'service writer rejects a non-HTTP occurrence URL'
);

select throws_ok(
  $$select public.support_ingestion_apply_item_checked_v1(
      (select run_id from url_guard_runs limit 1),
      jsonb_set(
        (select candidate from url_guard_candidates limit 1),
        '{support_notice,canonical_url}',
        '"data:text/html,unsafe"'::jsonb
      )
    )$$,
  'P0001',
  'SUPPORT_INGESTION_URL_UNSAFE',
  'service writer rejects a non-HTTP canonical URL'
);

select throws_ok(
  $$select public.support_ingestion_apply_item_checked_v1(
      (select run_id from url_guard_runs limit 1),
      jsonb_set(
        (select candidate from url_guard_candidates limit 1),
        '{support_notice_occurrence,raw_payload,_support_radar_ingestion,application_url}',
        '"javascript:alert(1)"'::jsonb
      )
    )$$,
  'P0001',
  'SUPPORT_INGESTION_URL_UNSAFE',
  'service writer rejects a non-HTTP application URL in provenance'
);

select throws_ok(
  $$select public.support_ingestion_apply_item_checked_v1(
      (select run_id from url_guard_runs limit 1),
      jsonb_set(
        (select candidate from url_guard_candidates limit 1),
        '{support_documents,0,source_url}',
        '"file:///tmp/unsafe.pdf"'::jsonb
      )
    )$$,
  'P0001',
  'SUPPORT_INGESTION_URL_UNSAFE',
  'service writer rejects a non-HTTP document URL'
);

select is(
  public.support_ingestion_apply_item_checked_v1(
    (select run_id from url_guard_runs limit 1),
    (select candidate from url_guard_candidates limit 1)
  )->>'delta_status',
  'new',
  'safe HTTPS candidate still reaches the private prepared writer'
);

select * from finish();
rollback;
