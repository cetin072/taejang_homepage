import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildSupportRadarPhase1WriteCandidate,
  SUPPORT_RADAR_PHASE1_MAP_CONTRACT
} from '../scripts/support-radar-ingestion-phase1-map.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const foundationMigration = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260909213000_support_radar_phase1_foundation.sql'),
  'utf8'
);

function sampleItem() {
  return {
    source_code: 'bizinfo',
    occurrence: {
      source_notice_id: 'PBLN_TEST_0001',
      source_url: 'https://www.bizinfo.go.kr/example/PBLN_TEST_0001',
      raw_title: '2026년 경남 장애인 고용환경 개선 지원사업',
      source_published_raw: '2026-09-01 09:00:00',
      raw_payload: { pblancId: 'PBLN_TEST_0001', viewCnt: '10' }
    },
    notice: {
      title: '2026년 경남 장애인 고용환경 개선 지원사업',
      managing_organization: '테스트 중앙기관',
      implementing_organization: '테스트 수행기관',
      canonical_url: 'https://www.bizinfo.go.kr/example/PBLN_TEST_0001',
      application_start_date: '2026-09-01',
      application_start_precision: 'date',
      deadline_date: '2026-09-30',
      deadline_precision: 'date',
      target_regions: ['경남'],
      categories: ['인력'],
      eligibility_summary: '장애인 고용 중소기업',
      application_process_summary: '온라인 신청 후 구비서류 제출',
      contact_summary: '테스트 문의처'
    },
    source_summary: '장애인 고용기업의 작업환경 개선을 지원하는 예시 공고입니다.',
    application_url: 'https://example.go.kr/apply/PBLN_TEST_0001',
    application_period_raw: '20260901 ~ 20260930',
    hashtags: ['2026', '인력', '경남', '장애인고용'],
    documents: [{
      document_type: 'attachment',
      source_url: 'https://www.bizinfo.go.kr/files/PBLN_TEST_0001.pdf',
      original_filename: '공고문.pdf'
    }],
    content_hash: 'a'.repeat(64),
    content_hash_basis_version: 'support-radar-material-v1'
  };
}

test('current Phase 1 schema uses timestamptz for application dates and therefore must not receive invented times', () => {
  assert.match(foundationMigration, /application_start_at timestamptz/);
  assert.match(foundationMigration, /deadline_at timestamptz/);
  assert.match(foundationMigration, /content_hash text/);
  assert.doesNotMatch(foundationMigration, /content_hash_basis_version/);
});

test('maps only safe normalized facts into existing Phase 1 row shapes', () => {
  const candidate = buildSupportRadarPhase1WriteCandidate(sampleItem(), {
    fetched_at: '2026-09-13T01:40:00+09:00'
  });

  assert.equal(candidate.contract_version, 'support-radar-phase1-map-v1');
  assert.equal(candidate.support_notice.title, '2026년 경남 장애인 고용환경 개선 지원사업');
  assert.deepEqual(candidate.support_notice.target_regions, ['경남']);
  assert.equal(candidate.support_notice_occurrence.source_notice_id, 'PBLN_TEST_0001');
  assert.equal(candidate.support_notice_occurrence.content_hash, 'a'.repeat(64));
  assert.equal(candidate.support_documents.length, 1);
  assert.equal(candidate.safety.database_write_performed, false);
  assert.equal(candidate.safety.timestamp_invention_performed, false);
  assert.equal(candidate.safety.semantic_ai_used, false);
  assert.equal(Object.hasOwn(candidate.support_notice, 'application_start_at'), false);
  assert.equal(Object.hasOwn(candidate.support_notice, 'deadline_at'), false);
});

test('preserves date-only facts and source-only metadata in provenance instead of discarding or coercing them', () => {
  const candidate = buildSupportRadarPhase1WriteCandidate(sampleItem());
  assert.equal(candidate.deferred_fields.length, 2);
  assert.deepEqual(candidate.deferred_fields.map(item => item.target_column), [
    'application_start_at',
    'deadline_at'
  ]);
  assert.ok(candidate.deferred_fields.every(item => item.action === 'defer'));
  assert.ok(candidate.deferred_fields.every(item => item.reason === 'DATE_ONLY_MUST_NOT_BE_INVENTED_AS_TIMESTAMPTZ'));

  const provenance = candidate.support_notice_occurrence.raw_payload._support_radar_ingestion;
  assert.equal(provenance.content_hash_basis_version, 'support-radar-material-v1');
  assert.equal(provenance.application_url, 'https://example.go.kr/apply/PBLN_TEST_0001');
  assert.equal(provenance.application_period_raw, '20260901 ~ 20260930');
  assert.deepEqual(provenance.hashtags, ['2026', '인력', '경남', '장애인고용']);
  assert.equal(provenance.date_facts.application_start.value, '2026-09-01');
  assert.equal(provenance.date_facts.deadline.value, '2026-09-30');
});

test('declares ingestion ledger requirements that current occurrence rows do not fully cover', () => {
  const candidate = buildSupportRadarPhase1WriteCandidate(sampleItem());
  assert.deepEqual(candidate.ledger_requirements, {
    preserve_content_hash_basis_version: true,
    preserve_ingestion_run_and_cursor: true,
    preserve_rejected_item_counts: true
  });
  assert.match(SUPPORT_RADAR_PHASE1_MAP_CONTRACT.principles.join(' '), /ingestion ledger boundary/);
});

test('rejects unsupported date precision instead of guessing a timestamp', () => {
  const item = sampleItem();
  item.notice.deadline_precision = 'datetime';
  assert.throws(
    () => buildSupportRadarPhase1WriteCandidate(item),
    /PHASE1_MAP_DEADLINE_PRECISION_UNSUPPORTED/
  );
});
