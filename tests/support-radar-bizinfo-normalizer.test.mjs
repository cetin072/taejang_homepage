import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BIZINFO_API_ENDPOINT,
  buildBizinfoPublicRequestPlan,
  normalizeBizinfoPayload,
  parseBizinfoApplicationPeriod,
  parseBizinfoCsv,
  stripBizinfoHtml
} from '../scripts/support-radar-bizinfo-normalizer.mjs';
import { createSupportRadarIngestionBatch } from '../scripts/support-radar-ingestion-contract.mjs';
import { buildSupportRadarPhase1WriteCandidate } from '../scripts/support-radar-ingestion-phase1-map.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'support-radar-bizinfo-sample.json'),
  'utf8'
));

test('builds only documented public BizInfo request parameters', () => {
  const plan = buildBizinfoPublicRequestPlan({
    dataType: 'json',
    searchCnt: 10,
    searchLclasId: '03',
    hashtags: '경남,인력',
    pageUnit: 20,
    pageIndex: 2
  });
  assert.equal(plan.endpoint, BIZINFO_API_ENDPOINT);
  assert.deepEqual(plan.public_params, {
    dataType: 'json',
    searchCnt: '10',
    searchLclasId: '03',
    hashtags: '경남,인력',
    pageUnit: '20',
    pageIndex: '2'
  });
  assert.equal(Object.keys(plan).length, 2);
  assert.deepEqual(buildBizinfoPublicRequestPlan({ dataType: 'rss' }).public_params, { dataType: 'rss' });
  assert.throws(() => buildBizinfoPublicRequestPlan({ dataType: 'xml' }), /BIZINFO_DATA_TYPE_INVALID/);
  assert.throws(() => buildBizinfoPublicRequestPlan({ searchLclasId: '08' }), /BIZINFO_SEARCH_LCLAS_ID_INVALID/);
  assert.throws(() => buildBizinfoPublicRequestPlan({ pageIndex: 0 }), /BIZINFO_PAGEINDEX_INVALID/);
});

test('normalizes current documented BizInfo response fields and fallback fields', () => {
  const normalized = normalizeBizinfoPayload(fixture);
  assert.equal(normalized.source_code, 'bizinfo');
  assert.equal(normalized.meta.title, '기업마당 지원사업정보');
  assert.equal(normalized.meta.reported_total_count, 2);
  assert.equal(normalized.meta.source_item_count, 2);
  assert.equal(normalized.items.length, 2);
  assert.deepEqual(normalized.rejected, []);

  const first = normalized.items[0];
  assert.equal(first.occurrence.source_notice_id, 'PBLN_TEST_0001');
  assert.equal(first.notice.managing_organization, '테스트 중앙기관');
  assert.equal(first.notice.implementing_organization, '테스트 수행기관');
  assert.equal(first.notice.application_start_date, '2026-09-01');
  assert.equal(first.notice.deadline_date, '2026-09-30');
  assert.equal(first.notice.application_start_precision, 'date');
  assert.equal(first.notice.deadline_precision, 'date');
  assert.deepEqual(first.notice.target_regions, ['경남']);
  assert.deepEqual(first.notice.categories, ['인력']);
  assert.equal(first.documents.length, 2);

  const fallback = normalized.items[1];
  assert.equal(fallback.occurrence.source_notice_id, 'PBLN_TEST_0002');
  assert.equal(fallback.notice.managing_organization, '테스트 지원기관');
  assert.equal(fallback.notice.implementing_organization, null);
  assert.deepEqual(fallback.notice.categories, ['기술']);
  assert.equal(fallback.application_url, null);
});

test('preserves current BizInfo regional hashtags used by live notices', () => {
  const payload = {
    jsonArray: {
      item: [{
        pblancId: 'PBLN_REGION_FIXTURE',
        pblancNm: '지역 태그 검증 공고',
        pblancUrl: 'https://www.bizinfo.go.kr/example/PBLN_REGION_FIXTURE',
        hashTags: '전남광주,전남,광주,경남,기술'
      }]
    }
  };
  const normalized = normalizeBizinfoPayload(payload);
  assert.deepEqual(normalized.items[0].notice.target_regions, ['전남광주', '전남', '광주', '경남']);
});

test('does not invent total count when source does not report one', () => {
  const payload = structuredClone(fixture);
  delete payload.jsonArray.item[0].totCnt;
  delete payload.jsonArray.item[1].totCnt;
  assert.equal(normalizeBizinfoPayload(payload).meta.reported_total_count, null);
});

test('rejects malformed source items while preserving raw page shape for pagination', () => {
  const result = normalizeBizinfoPayload({ jsonArray: { item: [
    { pblancId: 'PBLN_BAD', pblancNm: 'URL 없는 테스트 공고' },
    null
  ] } });
  assert.equal(result.meta.source_item_count, 2);
  assert.equal(result.items.length, 0);
  assert.equal(result.rejected.length, 2);
  assert.deepEqual(result.rejected[0].missing, ['source_url']);
  assert.equal(result.rejected[1].reason, 'ITEM_NOT_OBJECT');
});

test('keeps application periods at source date precision', () => {
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

test('normalizes source text deterministically', () => {
  assert.equal(stripBizinfoHtml('<div>지원&nbsp;사업 &amp; 신청</div>'), '지원 사업 & 신청');
  assert.deepEqual(parseBizinfoCsv('경남, 인력,경남,,AI'), ['경남', '인력', 'AI']);
});

test('verified BizInfo output reaches Phase 1 mapping boundary without DB writes', () => {
  const normalized = normalizeBizinfoPayload(fixture);
  const batch = createSupportRadarIngestionBatch({
    source_code: 'bizinfo',
    fetched_at: '2026-09-13T01:50:00+09:00',
    normalized,
    cursor: { page_index: 1, page_unit: 20 }
  });
  const candidate = buildSupportRadarPhase1WriteCandidate(batch.items[0], {
    fetched_at: batch.fetched_at
  });
  assert.equal(candidate.support_notice.title, normalized.items[0].notice.title);
  assert.equal(candidate.support_notice_occurrence.source_notice_id, 'PBLN_TEST_0001');
  assert.equal(candidate.safety.database_write_performed, false);
  assert.equal(candidate.deferred_fields.length, 2);
});
