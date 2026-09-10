import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeBizinfoPayload } from '../scripts/support-radar-bizinfo-normalizer.mjs';
import { createSupportRadarIngestionBatch } from '../scripts/support-radar-ingestion-contract.mjs';
import {
  buildSupportRadarPageCursor,
  planSupportRadarBatchDelta,
  SUPPORT_RADAR_DELTA_CONTRACT
} from '../scripts/support-radar-ingestion-delta.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'support-radar-bizinfo-sample.json'),
  'utf8'
));

function makeBatch(payload, fetchedAt) {
  return createSupportRadarIngestionBatch({
    source_code: 'bizinfo',
    fetched_at: fetchedAt,
    normalized: normalizeBizinfoPayload(payload)
  });
}

test('reingestion plan separates new, unchanged and materially changed notices without DB writes', () => {
  const baseline = makeBatch(fixture, '2026-09-10T08:00:00+09:00');

  const laterPayload = structuredClone(fixture);
  laterPayload.jsonArray.item[0].viewCnt = '12345';
  laterPayload.jsonArray.item[1].trgetNm = '중소기업 및 농업회사법인';
  laterPayload.jsonArray.item.push({
    pblancId: 'PBLN_TEST_0003',
    pblancNm: '2026년 신규 원예설비 지원 예시',
    pblancUrl: 'https://www.bizinfo.go.kr/web/example/view.do?pblancId=PBLN_TEST_0003',
    jrsdInsttNm: '테스트 기관',
    reqstBeginEndDe: '20260910 ~ 20261010',
    trgetNm: '농업회사법인',
    hashTags: '경남,원예'
  });

  const current = makeBatch(laterPayload, '2026-09-10T15:00:00+09:00');
  const plan = planSupportRadarBatchDelta({
    current_items: current.items,
    previous_items: baseline.items
  });

  assert.equal(plan.contract_version, 'support-radar-reingestion-plan-v1');
  assert.deepEqual(plan.counts, {
    insert: 1,
    touch_seen: 1,
    update_material_facts: 1,
    rebaseline: 0
  });
  assert.equal(plan.requires_re_evaluation_count, 2);

  const first = plan.actions.find(action => action.source_notice_id === 'PBLN_TEST_0001');
  const second = plan.actions.find(action => action.source_notice_id === 'PBLN_TEST_0002');
  const third = plan.actions.find(action => action.source_notice_id === 'PBLN_TEST_0003');

  assert.equal(first.action, 'touch_seen');
  assert.equal(first.revision_kind, 'none');
  assert.equal(first.requires_re_evaluation, false);

  assert.equal(second.action, 'update_material_facts');
  assert.equal(second.revision_kind, 'same_source_id_material_change');
  assert.equal(second.requires_re_evaluation, true);

  assert.equal(third.action, 'insert');
  assert.equal(third.revision_kind, 'none');
  assert.equal(third.requires_re_evaluation, true);
});

test('hash-basis changes are rebaseline operations rather than fake source edits', () => {
  const baseline = makeBatch(fixture, '2026-09-10T08:00:00+09:00');
  const currentItem = structuredClone(baseline.items[0]);
  currentItem.content_hash_basis_version = 'support-radar-material-v2';

  const plan = planSupportRadarBatchDelta({
    current_items: [currentItem],
    previous_items: [baseline.items[0]]
  });

  assert.equal(plan.actions[0].action, 'rebaseline');
  assert.equal(plan.actions[0].delta_status, 'basis_changed');
  assert.equal(plan.actions[0].revision_kind, 'hash_contract_change');
  assert.equal(plan.actions[0].requires_rebaseline, true);
  assert.equal(plan.actions[0].requires_re_evaluation, true);
});

test('different source notice IDs are not silently treated as a revision relationship', () => {
  const baseline = makeBatch(fixture, '2026-09-10T08:00:00+09:00');
  const newItem = structuredClone(baseline.items[0]);
  newItem.occurrence.source_notice_id = 'PBLN_TEST_REPOST_0001';

  const plan = planSupportRadarBatchDelta({
    current_items: [newItem],
    previous_items: baseline.items
  });

  assert.equal(plan.actions[0].action, 'insert');
  assert.equal(plan.actions[0].delta_status, 'new');
  assert.equal(plan.actions[0].revision_kind, 'none');
});

test('reingestion plan rejects duplicate ledger snapshots instead of choosing one silently', () => {
  const baseline = makeBatch(fixture, '2026-09-10T08:00:00+09:00');
  assert.throws(() => planSupportRadarBatchDelta({
    current_items: [baseline.items[0]],
    previous_items: [baseline.items[0], structuredClone(baseline.items[0])]
  }), /DELTA_PREVIOUS_DUPLICATE_SOURCE_NOTICE_ID/);

  assert.throws(() => planSupportRadarBatchDelta({
    current_items: [baseline.items[0], structuredClone(baseline.items[0])],
    previous_items: []
  }), /DELTA_CURRENT_DUPLICATE_SOURCE_NOTICE_ID/);
});

test('pagination cursor is conservative when total count is absent', () => {
  const fullPage = buildSupportRadarPageCursor({
    page_index: 1,
    page_unit: 20,
    item_count: 20
  });
  assert.equal(fullPage.state, 'unknown');
  assert.equal(fullPage.has_more, null);
  assert.equal(fullPage.next_page_index, 2);

  const shortPage = buildSupportRadarPageCursor({
    page_index: 2,
    page_unit: 20,
    item_count: 3
  });
  assert.equal(shortPage.state, 'complete');
  assert.equal(shortPage.has_more, false);
  assert.equal(shortPage.next_page_index, null);

  assert.match(SUPPORT_RADAR_DELTA_CONTRACT.principles.join(' '), /database mutation/);
});

test('pagination stops automatic continuation when total count contradicts page shape', () => {
  const prematureShortPage = buildSupportRadarPageCursor({
    page_index: 1,
    page_unit: 20,
    item_count: 7,
    reported_total_count: 41
  });
  assert.equal(prematureShortPage.state, 'inconsistent');
  assert.equal(prematureShortPage.has_more, null);
  assert.equal(prematureShortPage.next_page_index, null);

  const overflow = buildSupportRadarPageCursor({
    page_index: 3,
    page_unit: 20,
    item_count: 2,
    reported_total_count: 41
  });
  assert.equal(overflow.state, 'inconsistent');
  assert.equal(overflow.next_page_index, null);

  const validFinalPage = buildSupportRadarPageCursor({
    page_index: 3,
    page_unit: 20,
    item_count: 1,
    reported_total_count: 41
  });
  assert.equal(validFinalPage.state, 'complete');
  assert.equal(validFinalPage.has_more, false);

  assert.deepEqual(SUPPORT_RADAR_DELTA_CONTRACT.cursor_states, ['more', 'complete', 'unknown', 'inconsistent']);
});
