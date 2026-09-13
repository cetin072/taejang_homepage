import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeSupportRadarItemContentHash,
  createSupportRadarIngestionBatch,
  validateSupportRadarIngestionBatch
} from '../scripts/support-radar-ingestion-contract.mjs';
import {
  buildSupportRadarPageCursor,
  classifySupportRadarItemDelta,
  planSupportRadarBatchDelta
} from '../scripts/support-radar-ingestion-delta.mjs';
import { buildSupportRadarPhase1WriteCandidate } from '../scripts/support-radar-ingestion-phase1-map.mjs';

function normalizedItem(overrides = {}) {
  const base = {
    source_code: 'bizinfo',
    occurrence: {
      source_notice_id: 'PBLN_TEST_0001',
      source_url: 'https://example.go.kr/notices/PBLN_TEST_0001',
      raw_title: '2026년 경남 작업환경 개선 지원사업',
      source_published_raw: '2026-09-01 09:00:00',
      raw_payload: { id: 'PBLN_TEST_0001', observed: 'first' }
    },
    notice: {
      title: '2026년 경남 작업환경 개선 지원사업',
      managing_organization: '테스트 중앙기관',
      implementing_organization: '테스트 수행기관',
      canonical_url: 'https://example.go.kr/notices/PBLN_TEST_0001',
      application_start_date: '2026-09-01',
      application_start_precision: 'date',
      deadline_date: '2026-09-30',
      deadline_precision: 'date',
      target_regions: ['경남'],
      categories: ['인력'],
      eligibility_summary: '장애인 고용기업',
      application_process_summary: '온라인 신청',
      contact_summary: '테스트 문의처'
    },
    source_summary: '작업환경 개선을 지원하는 테스트 공고',
    application_url: 'https://example.go.kr/apply/PBLN_TEST_0001',
    application_period_raw: '20260901 ~ 20260930',
    hashtags: ['경남', '인력'],
    documents: [{
      document_type: 'attachment',
      source_url: 'https://example.go.kr/files/PBLN_TEST_0001.pdf',
      original_filename: '공고문.pdf'
    }]
  };
  return { ...base, ...structuredClone(overrides) };
}

function batchFor(item = normalizedItem(), fetchedAt = '2026-09-13T01:45:00+09:00') {
  return createSupportRadarIngestionBatch({
    source_code: 'bizinfo',
    fetched_at: fetchedAt,
    normalized: { meta: { reported_total_count: 1 }, items: [item], rejected: [] },
    cursor: { page_index: 1, page_unit: 20 }
  });
}

test('fingerprint covers material facts but ignores raw payload-only volatility', () => {
  const baseline = batchFor().items[0];
  const volatile = normalizedItem();
  volatile.occurrence.raw_payload.observed = 'later';
  volatile.occurrence.raw_payload.view_count = 999;
  const volatileItem = batchFor(volatile, '2026-09-13T02:00:00+09:00').items[0];
  assert.equal(volatileItem.content_hash, baseline.content_hash);

  const changed = normalizedItem();
  changed.notice.eligibility_summary = '장애인 고용기업 및 사회적기업';
  const changedItem = batchFor(changed, '2026-09-13T02:00:00+09:00').items[0];
  assert.notEqual(changedItem.content_hash, baseline.content_hash);
  assert.equal(computeSupportRadarItemContentHash(changedItem), changedItem.content_hash);
});

test('fingerprint ignores ordering noise in set-like fields and document lists', () => {
  const baselineSource = normalizedItem();
  baselineSource.notice.target_regions = ['경남', '전남'];
  baselineSource.notice.categories = ['인력', '경영'];
  baselineSource.hashtags = ['경남', '고용', '인력'];
  baselineSource.documents = [
    {
      document_type: 'attachment',
      source_url: 'https://example.go.kr/files/a.pdf',
      original_filename: 'a.pdf'
    },
    {
      document_type: 'attachment',
      source_url: 'https://example.go.kr/files/b.pdf',
      original_filename: 'b.pdf'
    }
  ];

  const reordered = structuredClone(baselineSource);
  reordered.notice.target_regions = ['전남', '경남', '경남'];
  reordered.notice.categories = ['경영', '인력'];
  reordered.hashtags = ['인력', '경남', '고용', '경남'];
  reordered.documents.reverse();

  assert.equal(
    batchFor(baselineSource).items[0].content_hash,
    batchFor(reordered).items[0].content_hash
  );
});

test('batch validation rejects duplicate source IDs, cross-source items and tampered normalized material', () => {
  const batch = batchFor();
  const duplicate = structuredClone(batch);
  duplicate.items.push(structuredClone(duplicate.items[0]));
  assert.throws(() => validateSupportRadarIngestionBatch(duplicate), /INGESTION_DUPLICATE_SOURCE_NOTICE_ID/);

  const crossSource = structuredClone(batch);
  crossSource.items[0].source_code = 'other_source';
  assert.throws(() => validateSupportRadarIngestionBatch(crossSource), /INGESTION_ITEM_SOURCE_MISMATCH/);

  const tampered = structuredClone(batch);
  tampered.items[0].notice.title = '사후 변경 제목';
  assert.throws(() => validateSupportRadarIngestionBatch(tampered), /INGESTION_CONTENT_HASH_MISMATCH/);
});

test('batch validation rejects non-HTTP browser-reachable URLs before mapping', () => {
  const unsafeSource = structuredClone(batchFor());
  unsafeSource.items[0].occurrence.source_url = 'javascript:alert(1)';
  assert.throws(() => validateSupportRadarIngestionBatch(unsafeSource), /INGESTION_SOURCE_URL_INVALID/);

  const unsafeCanonical = structuredClone(batchFor());
  unsafeCanonical.items[0].notice.canonical_url = 'data:text/html,unsafe';
  assert.throws(() => validateSupportRadarIngestionBatch(unsafeCanonical), /INGESTION_CANONICAL_URL_INVALID/);

  const unsafeApplication = structuredClone(batchFor());
  unsafeApplication.items[0].application_url = 'javascript:alert(1)';
  assert.throws(() => validateSupportRadarIngestionBatch(unsafeApplication), /INGESTION_APPLICATION_URL_INVALID/);

  const unsafeDocument = structuredClone(batchFor());
  unsafeDocument.items[0].documents[0].source_url = 'file:///tmp/unsafe.pdf';
  assert.throws(() => validateSupportRadarIngestionBatch(unsafeDocument), /INGESTION_DOCUMENT_URL_INVALID/);
});

test('delta classification preserves new unchanged changed and basis-change meanings', () => {
  const baseline = batchFor().items[0];
  assert.equal(classifySupportRadarItemDelta(null, baseline).status, 'new');
  assert.equal(classifySupportRadarItemDelta(baseline, structuredClone(baseline)).status, 'unchanged');

  const changed = normalizedItem();
  changed.notice.application_process_summary = '온라인 신청 후 추가서류 제출';
  const changedItem = batchFor(changed, '2026-09-13T02:10:00+09:00').items[0];
  const changedDelta = classifySupportRadarItemDelta(baseline, changedItem);
  assert.equal(changedDelta.status, 'changed');
  assert.equal(changedDelta.requires_re_evaluation, true);

  const newBasis = structuredClone(changedItem);
  newBasis.content_hash_basis_version = 'support-radar-material-v2';
  const basisDelta = classifySupportRadarItemDelta(baseline, newBasis);
  assert.equal(basisDelta.status, 'basis_changed');
  assert.equal(basisDelta.requires_rebaseline, true);
});

test('batch delta plan produces deterministic write actions', () => {
  const previous = batchFor().items[0];
  const same = structuredClone(previous);
  const changedSource = normalizedItem();
  changedSource.notice.contact_summary = '변경된 문의처';
  const changed = batchFor(changedSource, '2026-09-13T02:20:00+09:00').items[0];

  const samePlan = planSupportRadarBatchDelta({ current_items: [same], previous_items: [previous] });
  assert.deepEqual(samePlan.counts, {
    insert: 0,
    touch_seen: 1,
    update_material_facts: 0,
    rebaseline: 0
  });
  assert.equal(samePlan.requires_re_evaluation_count, 0);

  const changedPlan = planSupportRadarBatchDelta({ current_items: [changed], previous_items: [previous] });
  assert.equal(changedPlan.actions[0].action, 'update_material_facts');
  assert.equal(changedPlan.requires_re_evaluation_count, 1);
});

test('pagination stops instead of guessing when total count and page shape conflict', () => {
  assert.equal(buildSupportRadarPageCursor({
    page_index: 1,
    page_unit: 20,
    item_count: 20,
    reported_total_count: 41
  }).state, 'more');

  const inconsistent = buildSupportRadarPageCursor({
    page_index: 1,
    page_unit: 20,
    item_count: 5,
    reported_total_count: 41
  });
  assert.equal(inconsistent.state, 'inconsistent');
  assert.equal(inconsistent.next_page_index, null);

  const unknown = buildSupportRadarPageCursor({
    page_index: 2,
    page_unit: 20,
    item_count: 20,
    reported_total_count: null
  });
  assert.equal(unknown.state, 'unknown');
  assert.equal(unknown.next_page_index, 3);
});

test('fingerprinted ingestion item maps into current Phase 1 boundary without inventing timestamps', () => {
  const item = batchFor().items[0];
  const candidate = buildSupportRadarPhase1WriteCandidate(item, {
    fetched_at: '2026-09-13T01:45:00+09:00'
  });
  assert.equal(candidate.support_notice_occurrence.content_hash, item.content_hash);
  assert.equal(
    candidate.support_notice_occurrence.raw_payload._support_radar_ingestion.content_hash_basis_version,
    'support-radar-material-v1'
  );
  assert.equal(Object.hasOwn(candidate.support_notice, 'deadline_at'), false);
  assert.equal(candidate.deferred_fields.length, 2);
  assert.equal(candidate.safety.database_write_performed, false);
});
