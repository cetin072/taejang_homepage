import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  simulateBizinfoIngestionPage,
  SUPPORT_RADAR_BIZINFO_SIMULATION_CONTRACT
} from '../scripts/support-radar-bizinfo-simulation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'support-radar-bizinfo-sample.json'),
  'utf8'
));

function simulate(payload, previousItems = []) {
  return simulateBizinfoIngestionPage({
    payload,
    previous_items: previousItems,
    run_id: 'bizinfo-sim-20260910-184800-01',
    started_at: '2026-09-10T18:48:00+09:00',
    fetched_at: '2026-09-10T18:48:01+09:00',
    finished_at: '2026-09-10T18:48:02+09:00',
    page_index: 1,
    page_unit: 20,
    request_filters: { hashtags: '경남', searchLclasId: '03' }
  });
}

test('offline simulation composes request, normalization, fingerprints, delta, cursor and run record', () => {
  const result = simulate(fixture);

  assert.equal(result.contract_version, 'support-radar-bizinfo-simulation-v1');
  assert.equal(result.request_plan.public_params.dataType, 'json');
  assert.equal(result.request_plan.public_params.pageUnit, '20');
  assert.equal(result.request_plan.public_params.pageIndex, '1');
  assert.equal(result.request_plan.public_params.hashtags, '경남');
  assert.equal(result.request_plan.secret_parameter_name, 'crtfcKey');

  assert.equal(result.batch.items.length, 2);
  assert.match(result.batch.items[0].content_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.delta_plan.counts, {
    insert: 2,
    touch_seen: 0,
    update_material_facts: 0,
    rebaseline: 0
  });
  assert.equal(result.page_cursor.state, 'complete');
  assert.equal(result.run.status, 'succeeded');
  assert.equal(result.operational_summary.next_action, 'page_sequence_complete');
  assert.deepEqual(result.operational_summary.requires_re_evaluation_source_notice_ids, [
    'PBLN_TEST_0001',
    'PBLN_TEST_0002'
  ]);
  assert.equal(result.operational_summary.live_connection_used, false);
  assert.equal(result.operational_summary.database_write_used, false);
  assert.equal(result.operational_summary.ai_used, false);
});

test('ledger run request excludes secret metadata even though public request plan declares secret parameter name', () => {
  const result = simulate(fixture);
  assert.equal(result.request_plan.secret_parameter_name, 'crtfcKey');
  assert.equal(Object.prototype.hasOwnProperty.call(result.run.request, 'secret_parameter_name'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.run.request.public_params, 'crtfcKey'), false);
});

test('second simulation only queues materially changed source notices for re-evaluation', () => {
  const baseline = simulate(fixture);
  const later = structuredClone(fixture);
  later.jsonArray.item[0].viewCnt = '777';
  later.jsonArray.item[1].trgetNm = '중소기업 및 농업회사법인';

  const result = simulateBizinfoIngestionPage({
    payload: later,
    previous_items: baseline.batch.items,
    run_id: 'bizinfo-sim-20260910-190000-02',
    started_at: '2026-09-10T19:00:00+09:00',
    fetched_at: '2026-09-10T19:00:01+09:00',
    finished_at: '2026-09-10T19:00:02+09:00',
    page_index: 1,
    page_unit: 20,
    request_filters: { hashtags: '경남' }
  });

  assert.deepEqual(result.delta_plan.counts, {
    insert: 0,
    touch_seen: 1,
    update_material_facts: 1,
    rebaseline: 0
  });
  assert.deepEqual(result.operational_summary.requires_re_evaluation_source_notice_ids, ['PBLN_TEST_0002']);
});

test('simulation surfaces contradictory pagination as manual inspection instead of auto-continuing', () => {
  const inconsistent = structuredClone(fixture);
  inconsistent.jsonArray.item = [inconsistent.jsonArray.item[0]];
  inconsistent.jsonArray.item[0].totCnt = '41';
  inconsistent.jsonArray.totCnt = '41';

  const result = simulateBizinfoIngestionPage({
    payload: inconsistent,
    previous_items: [],
    run_id: 'bizinfo-sim-20260910-191000-03',
    started_at: '2026-09-10T19:10:00+09:00',
    fetched_at: '2026-09-10T19:10:01+09:00',
    finished_at: '2026-09-10T19:10:02+09:00',
    page_index: 1,
    page_unit: 20
  });

  assert.equal(result.page_cursor.state, 'inconsistent');
  assert.equal(result.page_cursor.next_page_index, null);
  assert.equal(result.operational_summary.next_action, 'inspect_source_pagination_before_continuing');
  assert.deepEqual(SUPPORT_RADAR_BIZINFO_SIMULATION_CONTRACT.stages, [
    'public_request_plan',
    'normalize',
    'fingerprint',
    'delta_plan',
    'page_cursor',
    'run_record'
  ]);
});

test('simulation accepts only explicit public filter keys and rejects credential-shaped or unknown inputs', () => {
  assert.deepEqual(SUPPORT_RADAR_BIZINFO_SIMULATION_CONTRACT.allowed_request_filters, [
    'searchCnt',
    'searchLclasId',
    'hashtags'
  ]);

  assert.throws(() => simulateBizinfoIngestionPage({
    payload: fixture,
    previous_items: [],
    run_id: 'bizinfo-sim-secret',
    started_at: '2026-09-10T19:20:00+09:00',
    fetched_at: '2026-09-10T19:20:01+09:00',
    finished_at: '2026-09-10T19:20:02+09:00',
    request_filters: { crtfcKey: 'must-not-be-accepted' }
  }), /SIMULATION_REQUEST_FILTER_FORBIDDEN:crtfcKey/);

  assert.throws(() => simulateBizinfoIngestionPage({
    payload: fixture,
    previous_items: [],
    run_id: 'bizinfo-sim-unknown-filter',
    started_at: '2026-09-10T19:20:00+09:00',
    fetched_at: '2026-09-10T19:20:01+09:00',
    finished_at: '2026-09-10T19:20:02+09:00',
    request_filters: { undocumentedParam: 'value' }
  }), /SIMULATION_REQUEST_FILTER_FORBIDDEN:undocumentedParam/);
});
