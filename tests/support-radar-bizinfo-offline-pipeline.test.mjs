import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildBizinfoStagingPilotOfflinePlan,
  SUPPORT_RADAR_BIZINFO_STAGING_PILOT_OFFLINE_CONTRACT
} from '../scripts/support-radar-bizinfo-offline-pipeline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'support-radar-bizinfo-sample.json'),
  'utf8'
));

function buildPlan(overrides = {}) {
  return buildBizinfoStagingPilotOfflinePlan({
    payload: fixture,
    started_at: '2026-09-13T15:00:00+09:00',
    fetched_at: '2026-09-13T15:00:05+09:00',
    finished_at: '2026-09-13T15:00:10+09:00',
    page_index: 1,
    page_unit: 20,
    request_filters: { searchLclasId: '03', hashtags: '경남' },
    ...overrides
  });
}

test('builds the full one-page staging pilot package without network, DB, Rule Engine or AI', () => {
  const plan = buildPlan();

  assert.equal(plan.contract_version, 'support-radar-bizinfo-staging-pilot-offline-v1');
  assert.deepEqual(plan.request_plan.public_params, {
    dataType: 'json',
    searchLclasId: '03',
    hashtags: '경남',
    pageUnit: '20',
    pageIndex: '1'
  });
  assert.equal(plan.normalized_meta.source_item_count, 2);
  assert.equal(plan.normalized_meta.reported_total_count, 2);
  assert.equal(plan.page_cursor.state, 'complete');
  assert.equal(plan.ledger_plan.item_write_plans.length, 2);
  assert.equal(plan.ledger_plan.reject_plans.length, 0);
  assert.equal(plan.ledger_plan.item_write_plans[0].expected_delta_status, 'new');
  assert.equal(plan.ledger_plan.item_write_plans[0].expected_write_action, 'insert');
  assert.equal(plan.delta_summary.requires_re_evaluation_count, 2);
  assert.equal(plan.ledger_plan.finish_run_preview.success_allowed_by_cursor, true);
  assert.equal(plan.ledger_plan.finish_run_preview.success_allowed_by_pilot_policy, true);

  const firstCandidate = plan.ledger_plan.item_write_plans[0].candidate;
  assert.equal(Object.hasOwn(firstCandidate.support_notice, 'application_start_at'), false);
  assert.equal(Object.hasOwn(firstCandidate.support_notice, 'deadline_at'), false);
  assert.equal(firstCandidate.safety.database_write_performed, false);

  assert.deepEqual(plan.operational_summary, {
    source_item_count: 2,
    accepted_item_count: 2,
    rejected_item_count: 0,
    planned_write_count: 2,
    requires_re_evaluation_source_notice_ids: ['PBLN_TEST_0001', 'PBLN_TEST_0002'],
    pagination_followup_required: false,
    manual_review_required: false,
    network_used: false,
    credential_accepted: false,
    database_write_performed: false,
    rule_engine_executed: false,
    ai_used: false,
    production_touched: false
  });
});

test('pagination uses raw source page count even when one source item is rejected', () => {
  const payload = structuredClone(fixture);
  delete payload.jsonArray.item[1].link;
  const plan = buildPlan({ payload });

  assert.equal(plan.normalized_meta.source_item_count, 2);
  assert.equal(plan.operational_summary.accepted_item_count, 1);
  assert.equal(plan.operational_summary.rejected_item_count, 1);
  assert.equal(plan.page_cursor.state, 'complete');
  assert.equal(plan.ledger_plan.reject_plans[0].item_index, 1);
  assert.equal(plan.ledger_plan.reject_plans[0].reason, 'MISSING_REQUIRED_FIELDS');
  assert.deepEqual(plan.ledger_plan.reject_plans[0].details.missing, ['source_url']);
  assert.equal(plan.ledger_plan.finish_run_preview.success_allowed_by_cursor, true);
  assert.equal(plan.ledger_plan.finish_run_preview.success_allowed_by_pilot_policy, false);
  assert.equal(plan.operational_summary.manual_review_required, true);
});

test('rejects secrets and unknown request controls before a pilot package is built', () => {
  assert.throws(
    () => buildPlan({ request_filters: { crtfcKey: 'do-not-accept' } }),
    /BIZINFO_PILOT_REQUEST_FILTER_FORBIDDEN:crtfcKey/
  );
  assert.throws(
    () => buildPlan({ request_filters: { pageUnit: 999 } }),
    /BIZINFO_PILOT_REQUEST_FILTER_FORBIDDEN:pageUnit/
  );
  assert.throws(
    () => buildPlan({ cursor_before: { contract_version: 'cursor-v1', token: 'do-not-store' } }),
    /BIZINFO_PILOT_CURSOR_BEFORE_UNSAFE/
  );
});

test('rejects credential-shaped Source provenance before producing DB write candidates', () => {
  const payload = structuredClone(fixture);
  payload.jsonArray.item[0].authorization = 'Bearer do-not-store';
  assert.throws(
    () => buildPlan({ payload }),
    /BIZINFO_PILOT_CANDIDATE_UNSAFE/
  );
});

test('keeps the approved staging pilot finite to page one and at most 20 source items', () => {
  assert.equal(SUPPORT_RADAR_BIZINFO_STAGING_PILOT_OFFLINE_CONTRACT.max_pages, 1);
  assert.equal(SUPPORT_RADAR_BIZINFO_STAGING_PILOT_OFFLINE_CONTRACT.max_page_unit, 20);
  assert.equal(SUPPORT_RADAR_BIZINFO_STAGING_PILOT_OFFLINE_CONTRACT.max_search_count, 20);
  assert.throws(() => buildPlan({ page_index: 2 }), /BIZINFO_PILOT_PAGE_INDEX_MUST_BE_ONE/);
  assert.throws(() => buildPlan({ page_unit: 21 }), /BIZINFO_PILOT_PAGE_UNIT_EXCEEDS_LIMIT/);
  assert.throws(
    () => buildPlan({ request_filters: { searchCnt: 21 } }),
    /BIZINFO_PILOT_SEARCH_COUNT_EXCEEDS_LIMIT/
  );
});

test('refuses previous delta material from a different Source', () => {
  assert.throws(
    () => buildPlan({ previous_items: [{ source_code: 'other_source' }] }),
    /BIZINFO_PILOT_PREVIOUS_SOURCE_MISMATCH/
  );
});

test('does not allow a contradictory page cursor to be presented as success-eligible', () => {
  const payload = structuredClone(fixture);
  payload.jsonArray.item[0].totCnt = '41';
  payload.jsonArray.item[1].totCnt = '41';

  const plan = buildPlan({ payload });
  assert.equal(plan.page_cursor.state, 'inconsistent');
  assert.equal(plan.ledger_plan.finish_run_preview.success_allowed_by_cursor, false);
  assert.equal(plan.ledger_plan.finish_run_preview.success_allowed_by_pilot_policy, false);
  assert.equal(plan.operational_summary.manual_review_required, true);
});

test('rejects impossible pilot timelines instead of inventing run chronology', () => {
  assert.throws(
    () => buildPlan({
      started_at: '2026-09-13T15:01:00+09:00',
      fetched_at: '2026-09-13T15:00:05+09:00'
    }),
    /BIZINFO_PILOT_TIMELINE_INVALID/
  );
});
