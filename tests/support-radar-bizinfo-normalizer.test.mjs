import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BIZINFO_API_ENDPOINT,
  buildBizinfoRequestPlan,
  normalizeBizinfoPayload,
  parseBizinfoApplicationPeriod,
  parseBizinfoCsv,
  stripBizinfoHtml
} from '../scripts/support-radar-bizinfo-normalizer.mjs';
import {
  computeSupportRadarItemContentHash,
  createSupportRadarIngestionBatch,
  SUPPORT_RADAR_INGESTION_CONTRACT,
  validateSupportRadarIngestionBatch
} from '../scripts/support-radar-ingestion-contract.mjs';
import {
  buildSupportRadarPageCursor,
  classifySupportRadarItemDelta,
  SUPPORT_RADAR_DELTA_CONTRACT
} from '../scripts/support-radar-ingestion-delta.mjs';
import { buildBizinfoDryRun, runBizinfoDryRunCli } from '../scripts/support-radar-bizinfo-dry-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixtures', 'support-radar-bizinfo-sample.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const sourcePath = path.join(__dirname, '..', 'scripts', 'support-radar-bizinfo-normalizer.mjs');
const source = fs.readFileSync(sourcePath, 'utf8');
const contractPath = path.join(__dirname, '..', 'scripts', 'support-radar-ingestion-contract.mjs');
const contractSource = fs.readFileSync(contractPath, 'utf8');
const deltaPath = path.join(__dirname, '..', 'scripts', 'support-radar-ingestion-delta.mjs');
const deltaSource = fs.readFileSync(deltaPath, 'utf8');
const dryRunPath = path.join(__dirname, '..', 'scripts', 'support-radar-bizinfo-dry-run.mjs');
const dryRunSource = fs.readFileSync(dryRunPath, 'utf8');

test('builds a public BizInfo request plan without accepting or embedding the service key', () => {
  const plan = buildBizinfoRequestPlan({
    dataType: 'json',
    searchCnt: 10,
    searchLclasId: '03',
    hashtags: '경남',
    pageUnit: 20,
    pageIndex: 2
  });
  assert.equal(plan.endpoint, BIZINFO_API_ENDPOINT);
  assert.deepEqual(plan.public_params, {
    dataType: 'json', searchCnt: '10', searchLclasId: '03', hashtags: '경남', pageUnit: '20', pageIndex: '2'
  });
  assert.equal(plan.requires_server_secret, true);
  assert.equal(plan.secret_parameter_name, 'crtfcKey');
  assert.equal(Object.prototype.hasOwnProperty.call(plan.public_params, 'crtfcKey'), false);
  assert.throws(() => buildBizinfoRequestPlan({ dataType: 'yaml' }), /BIZINFO_DATA_TYPE_INVALID/);
  assert.throws(() => buildBizinfoRequestPlan({ pageIndex: 0 }), /BIZINFO_PAGEINDEX_INVALID/);
});

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
  assert.equal(first.notice.application_start_precision, 'date');
  assert.equal(first.notice.deadline_date, '2026-09-30');
  assert.equal(first.notice.deadline_precision, 'date');
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
  const result = normalizeBizinfoPayload({ jsonArray: { item: [
    { pblancId: 'PBLN_TEST_BAD', pblancNm: 'URL 없는 공고' }, null
  ] } });
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
    raw: '20260901 ~ 20260930', start_date: '2026-09-01', end_date: '2026-09-30'
  });
  assert.deepEqual(parseBizinfoApplicationPeriod('수시 접수'), {
    raw: '수시 접수', start_date: null, end_date: null
  });
  assert.deepEqual(parseBizinfoApplicationPeriod('20260231 ~ 20260310'), {
    raw: '20260231 ~ 20260310', start_date: null, end_date: '2026-03-10'
  });
});

test('normalizes simple source text deterministically', () => {
  assert.equal(stripBizinfoHtml('<div>지원&nbsp;사업 &amp; 신청</div>'), '지원 사업 & 신청');
  assert.deepEqual(parseBizinfoCsv('경남, 인력,경남,,AI'), ['경남', '인력', 'AI']);
});

test('wraps a source adapter result in a source-neutral ingestion contract', () => {
  const normalized = normalizeBizinfoPayload(fixture);
  const batch = createSupportRadarIngestionBatch({
    source_code: 'bizinfo', fetched_at: '2026-09-10T08:00:00+09:00', normalized, cursor: { page_index: 1 }
  });
  assert.equal(batch.contract_version, 'support-radar-ingestion-v1');
  assert.equal(batch.source_code, 'bizinfo');
  assert.equal(batch.items.length, 2);
  assert.deepEqual(batch.cursor, { page_index: 1 });
  assert.match(batch.items[0].content_hash, /^[a-f0-9]{64}$/);
  assert.equal(batch.items[0].content_hash_basis_version, 'support-radar-material-v1');
  assert.equal(SUPPORT_RADAR_INGESTION_CONTRACT.version, 'support-radar-ingestion-v1');
  assert.match(SUPPORT_RADAR_INGESTION_CONTRACT.principles.join(' '), /semantic AI interpretation is outside ingestion/);
});

test('content fingerprint ignores volatile raw payload metadata but changes for material facts', () => {
  const normalized = normalizeBizinfoPayload(fixture);
  const firstBatch = createSupportRadarIngestionBatch({
    source_code: 'bizinfo', fetched_at: '2026-09-10T08:00:00+09:00', normalized
  });

  const volatileOnlyFixture = structuredClone(fixture);
  volatileOnlyFixture.jsonArray.item[0].viewCnt = '99999';
  volatileOnlyFixture.jsonArray.item[0].temporaryFetchMarker = 'later-run';
  const volatileBatch = createSupportRadarIngestionBatch({
    source_code: 'bizinfo',
    fetched_at: '2026-09-10T12:00:00+09:00',
    normalized: normalizeBizinfoPayload(volatileOnlyFixture)
  });
  assert.equal(volatileBatch.items[0].content_hash, firstBatch.items[0].content_hash);

  const changedFixture = structuredClone(fixture);
  changedFixture.jsonArray.item[0].trgetNm = '장애인 고용 중소기업 및 사회적기업';
  const changedBatch = createSupportRadarIngestionBatch({
    source_code: 'bizinfo',
    fetched_at: '2026-09-10T12:00:00+09:00',
    normalized: normalizeBizinfoPayload(changedFixture)
  });
  assert.notEqual(changedBatch.items[0].content_hash, firstBatch.items[0].content_hash);
  assert.equal(computeSupportRadarItemContentHash(changedBatch.items[0]), changedBatch.items[0].content_hash);
});

test('common ingestion contract rejects duplicate IDs, incomplete facts, and tampered fingerprints', () => {
  const normalized = normalizeBizinfoPayload(fixture);
  const batch = createSupportRadarIngestionBatch({
    source_code: 'bizinfo', fetched_at: '2026-09-10T08:00:00+09:00', normalized
  });
  const duplicate = structuredClone(batch);
  duplicate.items.push(structuredClone(duplicate.items[0]));
  assert.throws(() => validateSupportRadarIngestionBatch(duplicate), /INGESTION_DUPLICATE_SOURCE_NOTICE_ID/);

  const noRawPayload = structuredClone(batch);
  delete noRawPayload.items[0].occurrence.raw_payload;
  assert.throws(() => validateSupportRadarIngestionBatch(noRawPayload), /INGESTION_RAW_PAYLOAD_REQUIRED/);

  const tampered = structuredClone(batch);
  tampered.items[0].notice.title = '사후 변조된 제목';
  assert.throws(() => validateSupportRadarIngestionBatch(tampered), /INGESTION_CONTENT_HASH_MISMATCH/);

  assert.throws(() => createSupportRadarIngestionBatch({
    source_code: 'BizInfo!', fetched_at: '2026-09-10T08:00:00+09:00', normalized
  }), /INGESTION_SOURCE_CODE_INVALID/);
});

test('classifies repeated source notices as new, unchanged, changed, or hash-basis changed', () => {
  const baseline = createSupportRadarIngestionBatch({
    source_code: 'bizinfo',
    fetched_at: '2026-09-10T08:00:00+09:00',
    normalized: normalizeBizinfoPayload(fixture)
  }).items[0];

  const newResult = classifySupportRadarItemDelta(null, baseline);
  assert.equal(newResult.status, 'new');
  assert.equal(newResult.requires_re_evaluation, true);

  const unchanged = structuredClone(baseline);
  unchanged.occurrence.raw_payload.viewCnt = 'later-runtime-value';
  const unchangedResult = classifySupportRadarItemDelta(baseline, unchanged);
  assert.equal(unchangedResult.status, 'unchanged');
  assert.equal(unchangedResult.requires_re_evaluation, false);

  const changedFixture = structuredClone(fixture);
  changedFixture.jsonArray.item[0].reqstMthPapersCn = '온라인 신청 후 추가 확인서 제출';
  const changed = createSupportRadarIngestionBatch({
    source_code: 'bizinfo',
    fetched_at: '2026-09-10T13:00:00+09:00',
    normalized: normalizeBizinfoPayload(changedFixture)
  }).items[0];
  const changedResult = classifySupportRadarItemDelta(baseline, changed);
  assert.equal(changedResult.status, 'changed');
  assert.equal(changedResult.requires_re_evaluation, true);

  const basisChanged = structuredClone(changed);
  basisChanged.content_hash_basis_version = 'support-radar-material-v2';
  const basisResult = classifySupportRadarItemDelta(baseline, basisChanged);
  assert.equal(basisResult.status, 'basis_changed');
  assert.equal(basisResult.requires_rebaseline, true);

  const otherId = structuredClone(baseline);
  otherId.occurrence.source_notice_id = 'PBLN_TEST_DIFFERENT';
  assert.throws(() => classifySupportRadarItemDelta(baseline, otherId), /DELTA_SOURCE_NOTICE_ID_MISMATCH/);
  assert.deepEqual(SUPPORT_RADAR_DELTA_CONTRACT.statuses, ['new', 'unchanged', 'changed', 'basis_changed']);
});

test('builds pagination cursor without assuming undocumented remote page limits', () => {
  assert.deepEqual(buildSupportRadarPageCursor({
    page_index: 1, page_unit: 20, item_count: 20, reported_total_count: 41
  }), {
    contract_version: 'support-radar-page-cursor-v1',
    page_index: 1,
    page_unit: 20,
    item_count: 20,
    reported_total_count: 41,
    state: 'more',
    has_more: true,
    next_page_index: 2
  });

  assert.equal(buildSupportRadarPageCursor({
    page_index: 3, page_unit: 20, item_count: 1, reported_total_count: 41
  }).state, 'complete');

  const unknownFullPage = buildSupportRadarPageCursor({
    page_index: 2, page_unit: 20, item_count: 20
  });
  assert.equal(unknownFullPage.state, 'unknown');
  assert.equal(unknownFullPage.has_more, null);
  assert.equal(unknownFullPage.next_page_index, 3);

  const unknownPartialPage = buildSupportRadarPageCursor({
    page_index: 2, page_unit: 20, item_count: 7
  });
  assert.equal(unknownPartialPage.state, 'complete');
  assert.equal(unknownPartialPage.next_page_index, null);

  assert.throws(() => buildSupportRadarPageCursor({
    page_index: 1, page_unit: 20, item_count: 21
  }), /CURSOR_ITEM_COUNT_EXCEEDS_PAGE_UNIT/);
});

test('offline dry run produces the same validated ingestion batch without network or DB writes', () => {
  const batch = buildBizinfoDryRun(fixture, {
    fetched_at: '2026-09-10T08:00:00+09:00', cursor: { page_index: 1 }
  });
  assert.equal(batch.contract_version, 'support-radar-ingestion-v1');
  assert.equal(batch.items.length, 2);
  assert.deepEqual(batch.cursor, { page_index: 1 });

  let stdout = '';
  let stderr = '';
  const status = runBizinfoDryRunCli([
    '--input', fixturePath,
    '--fetched-at', '2026-09-10T08:00:00+09:00',
    '--page-index', '1'
  ], {
    stdout: { write: value => { stdout += value; } },
    stderr: { write: value => { stderr += value; } }
  });
  assert.equal(status, 0);
  assert.equal(stderr, '');
  const cliBatch = JSON.parse(stdout);
  assert.equal(cliBatch.source_code, 'bizinfo');
  assert.equal(cliBatch.items.length, 2);
});

test('fixture path remains offline-only with no credential values or AI dependency', () => {
  for (const fileSource of [source, contractSource, deltaSource, dryRunSource]) {
    assert.doesNotMatch(fileSource, /\bfetch\s*\(/);
    assert.doesNotMatch(fileSource, /Netlify\.env/);
    assert.doesNotMatch(fileSource, /OPENAI|ANTHROPIC|CLAUDE|API_KEY/i);
  }
  assert.match(source, /secret_parameter_name:\s*'crtfcKey'/);
  assert.doesNotMatch(source, /crtfcKey\s*[:=]\s*['"][A-Za-z0-9_-]{8,}/);
});
