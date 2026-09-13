#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBizinfoStagingPilotOfflinePlan } from '../scripts/support-radar-bizinfo-offline-pipeline.mjs';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

assert.ok(apiUrl, 'SUPABASE_URL or API_URL is required');
assert.ok(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY or SERVICE_ROLE_KEY is required');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'support-radar-bizinfo-sample.json'),
  'utf8'
));

let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); assertions += 1; };

async function api(pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { ok: response.ok, status: response.status, data };
}

async function rpc(name, parameters) {
  return api(`/rest/v1/rpc/${name}`, { method: 'POST', body: parameters });
}

async function single(pathname, message) {
  const result = await api(pathname);
  check(result.ok, `${message}: request failed ${result.status} ${JSON.stringify(result.data)}`);
  check(Array.isArray(result.data), `${message}: expected array response`);
  equal(result.data.length, 1, `${message}: expected exactly one row`);
  return result.data[0];
}

function beginParameters(plan, cursorBefore = plan.ledger_plan.begin_run_input.cursor_before) {
  const input = plan.ledger_plan.begin_run_input;
  return {
    p_source_code: input.source_code,
    p_stream_key: input.stream_key,
    p_started_at: input.started_at,
    p_request_public: input.request_public,
    p_cursor_before: cursorBefore,
    p_batch_contract_version: input.batch_contract_version,
    p_content_hash_basis_version: input.content_hash_basis_version,
    p_delta_contract_version: input.delta_contract_version
  };
}

async function beginRun(plan, cursorBefore = plan.ledger_plan.begin_run_input.cursor_before) {
  const result = await rpc('support_ingestion_begin_run_v1', beginParameters(plan, cursorBefore));
  check(result.ok, `begin ingestion run failed: ${result.status} ${JSON.stringify(result.data)}`);
  check(typeof result.data === 'string' && /^[0-9a-f-]{36}$/i.test(result.data), 'begin ingestion returns run UUID');
  return result.data;
}

async function applyPlan(runId, writePlan) {
  const result = await rpc('support_ingestion_apply_item_checked_v1', {
    p_run_id: runId,
    p_candidate: writePlan.candidate
  });
  check(result.ok, `apply prepared item failed: ${result.status} ${JSON.stringify(result.data)}`);
  equal(result.data?.source_notice_id, writePlan.source_notice_id, 'writer preserves source notice id');
  return result.data;
}

async function finishRun(plan, runId) {
  const preview = plan.ledger_plan.finish_run_preview;
  check(preview.success_allowed_by_cursor, 'fixture cursor is eligible for successful finalization');
  const result = await rpc('support_ingestion_finish_run_v1', {
    p_run_id: runId,
    p_finished_at: preview.finished_at,
    p_cursor_after: preview.cursor_after,
    p_success: true,
    p_retryable: null,
    p_error_code: null,
    p_error_summary: null
  });
  check(result.ok, `finish ingestion run failed: ${result.status} ${JSON.stringify(result.data)}`);
  equal(result.data?.status, 'succeeded', 'run finalizes successfully');
  return result.data;
}

const firstPlan = buildBizinfoStagingPilotOfflinePlan({
  payload: fixture,
  started_at: '2026-09-13T15:30:00+09:00',
  fetched_at: '2026-09-13T15:30:05+09:00',
  finished_at: '2026-09-13T15:30:10+09:00',
  page_index: 1,
  page_unit: 20,
  stream_key: 'ci-offline-pipeline',
  request_filters: { searchLclasId: '03', hashtags: '경남' }
});

equal(firstPlan.operational_summary.network_used, false, 'offline pilot performs no external network access');
equal(firstPlan.operational_summary.database_write_performed, false, 'offline pilot itself performs no DB mutation');
equal(firstPlan.operational_summary.credential_accepted, false, 'offline pilot accepts no external credential');
equal(firstPlan.ledger_plan.item_write_plans.length, 2, 'fixture produces two prepared write candidates');

const firstRunId = await beginRun(firstPlan);
const firstApplyResults = [];
for (const writePlan of firstPlan.ledger_plan.item_write_plans) {
  firstApplyResults.push(await applyPlan(firstRunId, writePlan));
}
equal(firstApplyResults[0].delta_status, 'new', 'first item is new on first DB replay');
equal(firstApplyResults[1].delta_status, 'new', 'second item is new on first DB replay');
const firstFinish = await finishRun(firstPlan, firstRunId);
equal(firstFinish.insert_count, 2, 'first run records two inserts');
equal(firstFinish.rejected_items, 0, 'first run records no rejected items');

const firstRun = await single(
  `/rest/v1/support_ingestion_runs?id=eq.${encodeURIComponent(firstRunId)}&select=status,insert_count,touch_seen_count,rejected_items,requires_re_evaluation_count,cursor_after`,
  'first ingestion run ledger'
);
equal(firstRun.status, 'succeeded', 'run ledger stores succeeded status');
equal(firstRun.insert_count, 2, 'run ledger stores insert count');
equal(firstRun.requires_re_evaluation_count, 2, 'run ledger stores deterministic re-evaluation count');
equal(firstRun.cursor_after?.state, 'complete', 'run ledger stores complete page cursor');

const firstOccurrence = await single(
  '/rest/v1/support_notice_occurrences?source_notice_id=eq.PBLN_TEST_0001&select=id,notice_id,source_notice_id,content_hash_basis_version,last_ingestion_run_id,raw_payload',
  'first BizInfo occurrence'
);
equal(firstOccurrence.last_ingestion_run_id, firstRunId, 'occurrence points to latest ingestion attempt');
equal(firstOccurrence.content_hash_basis_version, 'support-radar-material-v1', 'occurrence stores hash basis version');
equal(firstOccurrence.raw_payload?._support_radar_ingestion?.application_period_raw, '20260901 ~ 20260930', 'occurrence preserves source date provenance');

const firstNotice = await single(
  `/rest/v1/support_notices?id=eq.${encodeURIComponent(firstOccurrence.notice_id)}&select=id,title,application_start_at,deadline_at,target_regions,categories`,
  'first authoritative Phase 1 notice'
);
equal(firstNotice.title, '2026년 경남 작업환경 개선 지원사업 예시', 'Phase 1 notice receives normalized title');
equal(firstNotice.application_start_at, null, 'date-only application start does not invent a timestamp');
equal(firstNotice.deadline_at, null, 'date-only deadline does not invent a timestamp');
check(Array.isArray(firstNotice.target_regions) && firstNotice.target_regions.includes('경남'), 'Phase 1 notice preserves target region');

const documents = await api(
  `/rest/v1/support_documents?occurrence_id=eq.${encodeURIComponent(firstOccurrence.id)}&select=id,source_url,original_filename`
);
check(documents.ok, `document query failed: ${documents.status} ${JSON.stringify(documents.data)}`);
equal(documents.data?.length, 2, 'first occurrence stores both attachment metadata rows');

const bizinfoSource = await single('/rest/v1/support_sources?code=eq.bizinfo&select=id', 'BizInfo source');
const sourceState = await single(
  `/rest/v1/support_ingestion_source_state?source_id=eq.${encodeURIComponent(bizinfoSource.id)}&stream_key=eq.ci-offline-pipeline&select=cursor,last_successful_run_id`,
  'BizInfo source cursor state'
);
equal(sourceState.last_successful_run_id, firstRunId, 'source state advances only to successful run');
equal(sourceState.cursor?.state, 'complete', 'source state stores authoritative successful cursor');

const secondPlan = buildBizinfoStagingPilotOfflinePlan({
  payload: fixture,
  started_at: '2026-09-13T15:31:00+09:00',
  fetched_at: '2026-09-13T15:31:05+09:00',
  finished_at: '2026-09-13T15:31:10+09:00',
  page_index: 1,
  page_unit: 20,
  stream_key: 'ci-offline-pipeline',
  cursor_before: sourceState.cursor,
  request_filters: { searchLclasId: '03', hashtags: '경남' }
});

const secondRunId = await beginRun(secondPlan, sourceState.cursor);
const secondApplyResults = [];
for (const writePlan of secondPlan.ledger_plan.item_write_plans) {
  secondApplyResults.push(await applyPlan(secondRunId, writePlan));
}
equal(secondApplyResults[0].delta_status, 'unchanged', 'identical first item replays as unchanged');
equal(secondApplyResults[1].delta_status, 'unchanged', 'identical second item replays as unchanged');
const secondFinish = await finishRun(secondPlan, secondRunId);
equal(secondFinish.insert_count, 0, 'identical replay inserts no new notices');
equal(secondFinish.touch_seen_count, 2, 'identical replay records two touch_seen events');
equal(secondFinish.requires_re_evaluation_count, 0, 'ordinary identical replay does not request reevaluation');

const noticeCount = await api('/rest/v1/support_notice_occurrences?source_notice_id=in.(PBLN_TEST_0001,PBLN_TEST_0002)&select=id');
check(noticeCount.ok, `occurrence count query failed: ${noticeCount.status} ${JSON.stringify(noticeCount.data)}`);
equal(noticeCount.data?.length, 2, 'idempotent replay preserves exactly two source occurrences');

const documentReplay = await api(
  `/rest/v1/support_documents?occurrence_id=eq.${encodeURIComponent(firstOccurrence.id)}&select=id`
);
check(documentReplay.ok, `document replay query failed: ${documentReplay.status} ${JSON.stringify(documentReplay.data)}`);
equal(documentReplay.data?.length, 2, 'idempotent replay does not duplicate identical documents');

console.log(`Support Radar ingestion pipeline integration passed (${assertions} assertions).`);
