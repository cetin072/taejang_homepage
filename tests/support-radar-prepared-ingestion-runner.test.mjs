import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildBizinfoStagingPilotOfflinePlan } from '../scripts/support-radar-bizinfo-offline-pipeline.mjs';
import { executePreparedSupportRadarIngestion } from '../scripts/support-radar-prepared-ingestion-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'support-radar-bizinfo-sample.json'),
  'utf8'
));

function planFor(payload = fixture) {
  return buildBizinfoStagingPilotOfflinePlan({
    payload,
    started_at: '2026-09-13T16:00:00+09:00',
    fetched_at: '2026-09-13T16:00:05+09:00',
    finished_at: '2026-09-13T16:00:10+09:00',
    page_index: 1,
    page_unit: 20,
    stream_key: 'runner-unit',
    request_filters: { searchLclasId: '03', hashtags: '경남' }
  });
}

function fakeRpc({ applyFailsAt = null, beginFails = false, rejectFails = false } = {}) {
  const calls = [];
  let applyCount = 0;
  const rpc = async (name, parameters) => {
    calls.push({ name, parameters });
    if (name === 'support_ingestion_begin_run_v1') {
      return beginFails ? { ok: false, status: 500 } : { ok: true, data: '11111111-1111-4111-8111-111111111111' };
    }
    if (name === 'support_ingestion_apply_item_checked_v1') {
      applyCount += 1;
      if (applyFailsAt === applyCount) return { ok: false, status: 500 };
      return { ok: true, data: { delta_status: 'new' } };
    }
    if (name === 'support_ingestion_record_reject_v1') {
      return rejectFails ? { ok: false, status: 500 } : { ok: true, data: '22222222-2222-4222-8222-222222222222' };
    }
    if (name === 'support_ingestion_finish_run_v1') {
      return {
        ok: true,
        data: {
          status: parameters.p_success ? 'succeeded' : 'failed',
          cursor_advanced: parameters.p_success
        }
      };
    }
    return { ok: false, status: 404 };
  };
  return { rpc, calls };
}

test('executes a safe prepared pilot plan in deterministic RPC order', async () => {
  const plan = planFor();
  const transport = fakeRpc();
  const result = await executePreparedSupportRadarIngestion(plan, transport);

  assert.equal(result.status, 'succeeded');
  assert.equal(result.cursor_advanced, true);
  assert.equal(result.applied_item_count, 2);
  assert.equal(result.recorded_reject_count, 0);
  assert.equal(result.rule_engine_executed, false);
  assert.equal(result.ai_used, false);
  assert.equal(result.production_touched, false);
  assert.deepEqual(transport.calls.map(call => call.name), [
    'support_ingestion_begin_run_v1',
    'support_ingestion_apply_item_checked_v1',
    'support_ingestion_apply_item_checked_v1',
    'support_ingestion_finish_run_v1'
  ]);
  const finish = transport.calls.at(-1).parameters;
  assert.equal(finish.p_success, true);
  assert.equal(finish.p_cursor_after.state, 'complete');
});

test('records rejects then fails closed without advancing cursor', async () => {
  const payload = structuredClone(fixture);
  delete payload.jsonArray.item[1].link;
  const plan = planFor(payload);
  assert.equal(plan.ledger_plan.reject_plans.length, 1);
  assert.equal(plan.ledger_plan.finish_run_preview.success_allowed_by_pilot_policy, false);

  const transport = fakeRpc();
  const result = await executePreparedSupportRadarIngestion(plan, transport);
  assert.equal(result.status, 'failed');
  assert.equal(result.failure_stage, 'source_reject');
  assert.equal(result.error_code, 'PILOT_SOURCE_ITEM_REJECTED');
  assert.equal(result.cursor_advanced, false);
  assert.equal(result.applied_item_count, 1);
  assert.equal(result.recorded_reject_count, 1);
  assert.deepEqual(transport.calls.map(call => call.name), [
    'support_ingestion_begin_run_v1',
    'support_ingestion_apply_item_checked_v1',
    'support_ingestion_record_reject_v1',
    'support_ingestion_finish_run_v1'
  ]);
  const finish = transport.calls.at(-1).parameters;
  assert.equal(finish.p_success, false);
  assert.equal(finish.p_cursor_after, null);
  assert.equal(finish.p_error_code, 'PILOT_SOURCE_ITEM_REJECTED');
});

test('finalizes partial item-write transport failure with fixed safe diagnostics', async () => {
  const transport = fakeRpc({ applyFailsAt: 1 });
  const result = await executePreparedSupportRadarIngestion(planFor(), transport);
  assert.equal(result.status, 'failed');
  assert.equal(result.failure_stage, 'apply_item');
  assert.equal(result.error_code, 'PREPARED_ITEM_WRITE_FAILED');
  const finish = transport.calls.at(-1).parameters;
  assert.equal(finish.p_success, false);
  assert.equal(finish.p_error_summary, 'prepared ingestion runner failed while applying an item');
  assert.equal(finish.p_cursor_after, null);
});

test('does not create a run when begin RPC fails', async () => {
  const transport = fakeRpc({ beginFails: true });
  await assert.rejects(
    executePreparedSupportRadarIngestion(planFor(), transport),
    /PREPARED_INGESTION_BEGIN_FAILED/
  );
  assert.deepEqual(transport.calls.map(call => call.name), ['support_ingestion_begin_run_v1']);
});

test('rejects plans whose offline safety flags were tampered with', async () => {
  const plan = planFor();
  plan.operational_summary.network_used = true;
  await assert.rejects(
    executePreparedSupportRadarIngestion(plan, fakeRpc()),
    /PREPARED_INGESTION_SAFETY_FLAGS_INVALID/
  );
});
