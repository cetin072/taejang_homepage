import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeBizinfoPayload } from '../scripts/support-radar-bizinfo-normalizer.mjs';
import { createSupportRadarIngestionBatch } from '../scripts/support-radar-ingestion-contract.mjs';
import { planSupportRadarBatchDelta } from '../scripts/support-radar-ingestion-delta.mjs';
import {
  completeSupportRadarIngestionRun,
  failSupportRadarIngestionRun,
  startSupportRadarIngestionRun,
  SUPPORT_RADAR_INGESTION_RUN_CONTRACT
} from '../scripts/support-radar-ingestion-run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'support-radar-bizinfo-sample.json'),
  'utf8'
));

function buildBatch(fetchedAt) {
  return createSupportRadarIngestionBatch({
    source_code: 'bizinfo',
    fetched_at: fetchedAt,
    normalized: normalizeBizinfoPayload(fixture)
  });
}

test('successful run records provenance and deterministic write counts', () => {
  const run = startSupportRadarIngestionRun({
    run_id: 'bizinfo:2026-09-10T18:00:00+09:00',
    source_code: 'bizinfo',
    started_at: '2026-09-10T18:00:00+09:00',
    request: {
      endpoint: 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do',
      public_params: { dataType: 'json', pageUnit: '20', pageIndex: '1' }
    },
    cursor_before: null
  });

  const batch = buildBatch('2026-09-10T18:00:03+09:00');
  const deltaPlan = planSupportRadarBatchDelta({
    current_items: batch.items,
    previous_items: []
  });

  const completed = completeSupportRadarIngestionRun(run, {
    finished_at: '2026-09-10T18:00:04+09:00',
    batch,
    delta_plan: deltaPlan,
    cursor_after: { page_index: 1, next_page_index: null, state: 'complete' }
  });

  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.batch_contract_version, 'support-radar-ingestion-v1');
  assert.equal(completed.content_hash_basis_version, 'support-radar-material-v1');
  assert.equal(completed.delta_contract_version, 'support-radar-reingestion-plan-v1');
  assert.deepEqual(completed.counts, {
    fetched_items: 2,
    rejected_items: 0,
    insert: 2,
    touch_seen: 0,
    update_material_facts: 0,
    rebaseline: 0,
    requires_re_evaluation: 2
  });
  assert.equal(completed.retryable, false);
  assert.equal(completed.error_code, null);
});

test('failed run keeps error and retryability separate and does not fake success provenance', () => {
  const run = startSupportRadarIngestionRun({
    run_id: 'bizinfo-run-002',
    source_code: 'bizinfo',
    started_at: '2026-09-10T18:10:00+09:00',
    request: {
      endpoint: 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do',
      public_params: { dataType: 'json', pageIndex: '2' }
    },
    cursor_before: { page_index: 1 }
  });

  const failed = failSupportRadarIngestionRun(run, {
    finished_at: '2026-09-10T18:10:02+09:00',
    error_code: 'SOURCE_TIMEOUT',
    error_summary: 'official source request timed out',
    retryable: true
  });

  assert.equal(failed.status, 'failed');
  assert.equal(failed.retryable, true);
  assert.equal(failed.error_code, 'SOURCE_TIMEOUT');
  assert.equal(failed.batch_contract_version, null);
  assert.equal(failed.delta_contract_version, null);
  assert.equal(failed.cursor_after, null);
});

test('run contract rejects credential-shaped request fields even before persistence', () => {
  assert.throws(() => startSupportRadarIngestionRun({
    run_id: 'bizinfo-run-secret',
    source_code: 'bizinfo',
    started_at: '2026-09-10T18:20:00+09:00',
    request: {
      endpoint: 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do',
      crtfcKey: 'should-never-be-stored'
    }
  }), /INGESTION_RUN_SECRET_FIELD_FORBIDDEN/);

  assert.throws(() => startSupportRadarIngestionRun({
    run_id: 'bizinfo-run-secret-meta',
    source_code: 'bizinfo',
    started_at: '2026-09-10T18:20:00+09:00',
    request: {
      endpoint: 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do',
      secret_parameter_name: 'crtfcKey'
    }
  }), /INGESTION_RUN_SECRET_FIELD_FORBIDDEN/);
});

test('run lifecycle rejects invalid time ordering and double-finalization', () => {
  const run = startSupportRadarIngestionRun({
    run_id: 'bizinfo-run-time',
    source_code: 'bizinfo',
    started_at: '2026-09-10T18:30:00+09:00',
    request: { endpoint: 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do', public_params: {} }
  });
  const batch = buildBatch('2026-09-10T18:30:01+09:00');
  const deltaPlan = planSupportRadarBatchDelta({ current_items: batch.items, previous_items: [] });

  assert.throws(() => completeSupportRadarIngestionRun(run, {
    finished_at: '2026-09-10T17:59:59+09:00',
    batch,
    delta_plan: deltaPlan
  }), /INGESTION_RUN_FINISHED_BEFORE_START/);

  const completed = completeSupportRadarIngestionRun(run, {
    finished_at: '2026-09-10T18:30:02+09:00',
    batch,
    delta_plan: deltaPlan
  });

  assert.throws(() => failSupportRadarIngestionRun(completed, {
    finished_at: '2026-09-10T18:31:00+09:00',
    error_code: 'SHOULD_NOT_APPLY',
    error_summary: 'already finished',
    retryable: false
  }), /INGESTION_RUN_NOT_RUNNING/);

  assert.deepEqual(SUPPORT_RADAR_INGESTION_RUN_CONTRACT.statuses, ['running', 'succeeded', 'failed']);
});
