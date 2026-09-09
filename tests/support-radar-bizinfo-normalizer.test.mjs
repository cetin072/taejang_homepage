import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  normalizeBizinfoPayload,
  parseBizinfoApplicationPeriod,
  parseBizinfoCsv,
  stripBizinfoHtml
} from '../scripts/support-radar-bizinfo-normalizer.mjs';
import {
  createSupportRadarIngestionBatch,
  SUPPORT_RADAR_INGESTION_CONTRACT,
  validateSupportRadarIngestionBatch
} from '../scripts/support-radar-ingestion-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixtures', 'support-radar-bizinfo-sample.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const sourcePath = path.join(__dirname, '..', 'scripts', 'support-radar-bizinfo-normalizer.mjs');
const source = fs.readFileSync(sourcePath, 'utf8');
const contractPath = path.join(__dirname, '..', 'scripts', 'support-radar-ingestion-contract.mjs');
const contractSource = fs.readFileSync(contractPath, 'utf8');

test('normalizes documented BizInfo fields into ledger-ready source and notice shapes', () => {
  const result = normalizeBizinfoPayload(fixture);

  assert.equal(result.source_code, 'bizinfo');
  assert.equal(result.meta.title, '기업마당 지원사업정보');
  assert.equal(result.meta.reported_total_count, 2);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.rejected, []);

  const first = result.items[0];
  assert.equal(first.occurrence.source_notice_id, 'PBLN_TEST_0001');
  assert.equal(first.notice.title, '2026년 경남 장애인 고용환경 개선 지원사업');
  assert.equal(first.notice.managing_organization, '테스트 중앙기관');
  assert.equal(first.notice.implementing_organization, '테스트 수행기관');
  assert.equal(first.notice.application_start_date, '2026-09-01');
  assert.equal(first.notice.deadline_date, '2026-09-30');
  assert.deepEqual(first.notice.target_regions, ['경남']);
  assert.deepEqual(first.notice.categories, ['인력']);
  assert.equal(first.notice.eligibility_summary, '장애인 고용 중소기업');
  assert.equal(first.notice.application_process_summary, '온라인 신청 후 구비서류 제출');
  assert.equal(first.application_url, 'https://example.go.kr/apply/PBLN_TEST_0001');
  assert.equal(first.source_summary, '장애인 고용기업의 작업환경 개선을 지원하는 예시 공고입니다.');
  assert.equal(first.documents.length, 2);
  assert.equal(first.documents[0].original_filename, '공고문.pdf');
});

test('uses documented fallback fields without inventing missing semantic facts', () => {
  const second = normalizeBizinfoPayload(fixture).items[1];

  assert.equal(second.occurrence.source_notice_id, 'PBLN_TEST_0002');
  assert.equal(second.notice.title, '2026년 디지털 전환 컨설팅 지원 예시');
  assert.equal(second.notice.managing_organization, '테스트 지원기관');
  assert.equal(second.notice.implementing_organization, null);
  assert.equal(second.notice.application_start_date, '2026-09-02');
  assert.equal(second.notice.deadline_date, '2026-10-15');
  assert.deepEqual(second.notice.categories, ['기술']);
  assert.deepEqual(second.notice.target_regions, ['경남']);
  assert.equal(second.application_url, null);
  assert.equal(second.notice.application_process_summary, null);
  assert.deepEqual(second.documents, []);
});

test('rejects malformed items instead of creating incomplete official ledger rows', () => {
  const result = normalizeBizinfoPayload({
    jsonArray: {
      item: [
        { pblancId: 'PBLN_TEST_BAD', pblancNm: 'URL 없는 공고' },
        null
      ]
    }
  });

  assert.equal(result.items.length, 0);
  assert.equal(result.rejected.length, 2);
  assert.equal(result.rejected[0].reason, 'MISSING_REQUIRED_FIELDS');
  assert.deepEqual(result.rejected[0].missing, ['source_url']);
  assert.equal(result.rejected[1].reason, 'ITEM_NOT_OBJECT');
});

test('rejects invalid payload roots clearly', () => {
  assert.throws(() => normalizeBizinfoPayload({}), /BIZINFO_INVALID_PAYLOAD/);
  assert.throws(() => normalizeBizinfoPayload({ jsonArray: [] }), /BIZINFO_INVALID_PAYLOAD/);
});

test('parses only explicit application date ranges and preserves raw values', () => {
  assert.deepEqual(parseBizinfoApplicationPeriod('20260901 ~ 20260930'), {
    raw: '20260901 ~ 20260930',
    start_date: '2026-09-01',
    end_date: '2026-09-30'
  });
  assert.deepEqual(parseBizinfoApplicationPeriod('수시 접수'), {
    raw: '수시 접수',
    start_date: null,
    end_date: null
  });
  assert.deepEqual(parseBizinfoApplicationPeriod('20260231 ~ 20260310'), {
    raw: '20260231 ~ 20260310',
    start_date: null,
    end_date: '2026-03-10'
  });
});

test('normalizes simple source text deterministically', () => {
  assert.equal(stripBizinfoHtml('<div>지원&nbsp;사업 &amp; 신청</div>'), '지원 사업 & 신청');
  assert.deepEqual(parseBizinfoCsv('경남, 인력,경남,,AI'), ['경남', '인력', 'AI']);
});

test('wraps a source adapter result in a source-neutral ingestion contract', () => {
  const normalized = normalizeBizinfoPayload(fixture);
  const batch = createSupportRadarIngestionBatch({
    source_code: 'bizinfo',
    fetched_at: '2026-09-10T08:00:00+09:00',
    normalized,
    cursor: { page_index: 1 }
  });

  assert.equal(batch.contract_version, 'support-radar-ingestion-v1');
  assert.equal(batch.source_code, 'bizinfo');
  assert.equal(batch.items.length, 2);
  assert.deepEqual(batch.cursor, { page_index: 1 });
  assert.equal(SUPPORT_RADAR_INGESTION_CONTRACT.version, 'support-radar-ingestion-v1');
  assert.match(SUPPORT_RADAR_INGESTION_CONTRACT.principles.join(' '), /semantic AI interpretation is outside ingestion/);
});

test('common ingestion contract rejects duplicate IDs and incomplete ledger facts', () => {
  const normalized = normalizeBizinfoPayload(fixture);
  const batch = createSupportRadarIngestionBatch({
    source_code: 'bizinfo',
    fetched_at: '2026-09-10T08:00:00+09:00',
    normalized
  });

  const duplicate = structuredClone(batch);
  duplicate.items.push(structuredClone(duplicate.items[0]));
  assert.throws(() => validateSupportRadarIngestionBatch(duplicate), /INGESTION_DUPLICATE_SOURCE_NOTICE_ID/);

  const noRawPayload = structuredClone(batch);
  delete noRawPayload.items[0].occurrence.raw_payload;
  assert.throws(() => validateSupportRadarIngestionBatch(noRawPayload), /INGESTION_RAW_PAYLOAD_REQUIRED/);

  assert.throws(() => createSupportRadarIngestionBatch({
    source_code: 'BizInfo!',
    fetched_at: '2026-09-10T08:00:00+09:00',
    normalized
  }), /INGESTION_SOURCE_CODE_INVALID/);
});

test('fixture normalizer and common contract are offline-only with no credentials or AI dependency', () => {
  for (const fileSource of [source, contractSource]) {
    assert.doesNotMatch(fileSource, /\bfetch\s*\(/);
    assert.doesNotMatch(fileSource, /Netlify\.env/);
    assert.doesNotMatch(fileSource, /crtfcKey/);
    assert.doesNotMatch(fileSource, /OPENAI|ANTHROPIC|CLAUDE|API_KEY/i);
  }
});
