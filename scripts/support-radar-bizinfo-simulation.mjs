import { buildBizinfoRequestPlan, normalizeBizinfoPayload } from './support-radar-bizinfo-normalizer.mjs';
import { createSupportRadarIngestionBatch } from './support-radar-ingestion-contract.mjs';
import {
  buildSupportRadarPageCursor,
  planSupportRadarBatchDelta
} from './support-radar-ingestion-delta.mjs';
import {
  completeSupportRadarIngestionRun,
  startSupportRadarIngestionRun
} from './support-radar-ingestion-run.mjs';

function clean(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function positiveInteger(value, code) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(code);
  return number;
}

function safeRunRequest(requestPlan) {
  return {
    endpoint: requestPlan.endpoint,
    public_params: structuredClone(requestPlan.public_params)
  };
}

function nextActionForCursor(cursor) {
  if (cursor.state === 'more') return 'fetch_next_page_when_live_connection_is_approved';
  if (cursor.state === 'unknown') return 'verify_next_page_when_live_connection_is_approved';
  if (cursor.state === 'inconsistent') return 'inspect_source_pagination_before_continuing';
  return 'page_sequence_complete';
}

/**
 * End-to-end offline simulation of one BizInfo page.
 * No network call, database mutation, AI call, or secret value is accepted here.
 */
export function simulateBizinfoIngestionPage({
  payload,
  previous_items = [],
  run_id,
  started_at,
  fetched_at,
  finished_at,
  page_index = 1,
  page_unit = 20,
  request_filters = {}
}) {
  const pageIndex = positiveInteger(page_index, 'SIMULATION_PAGE_INDEX_INVALID');
  const pageUnit = positiveInteger(page_unit, 'SIMULATION_PAGE_UNIT_INVALID');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('SIMULATION_PAYLOAD_REQUIRED');
  if (!Array.isArray(previous_items)) throw new Error('SIMULATION_PREVIOUS_ITEMS_ARRAY_REQUIRED');
  if (!request_filters || typeof request_filters !== 'object' || Array.isArray(request_filters)) {
    throw new Error('SIMULATION_REQUEST_FILTERS_OBJECT_REQUIRED');
  }

  const requestPlan = buildBizinfoRequestPlan({
    ...request_filters,
    dataType: 'json',
    pageUnit,
    pageIndex
  });

  const run = startSupportRadarIngestionRun({
    run_id: clean(run_id),
    source_code: 'bizinfo',
    started_at,
    request: safeRunRequest(requestPlan),
    cursor_before: { page_index: pageIndex, page_unit: pageUnit }
  });

  const normalized = normalizeBizinfoPayload(payload);
  const batch = createSupportRadarIngestionBatch({
    source_code: 'bizinfo',
    fetched_at,
    normalized,
    cursor: { page_index: pageIndex, page_unit: pageUnit }
  });

  const deltaPlan = planSupportRadarBatchDelta({
    current_items: batch.items,
    previous_items
  });

  const pageCursor = buildSupportRadarPageCursor({
    page_index: pageIndex,
    page_unit: pageUnit,
    item_count: batch.items.length,
    reported_total_count: normalized.meta.reported_total_count
  });

  const completedRun = completeSupportRadarIngestionRun(run, {
    finished_at,
    batch,
    delta_plan: deltaPlan,
    cursor_after: pageCursor
  });

  return {
    contract_version: 'support-radar-bizinfo-simulation-v1',
    request_plan: requestPlan,
    normalized_meta: structuredClone(normalized.meta),
    batch,
    delta_plan: deltaPlan,
    page_cursor: pageCursor,
    run: completedRun,
    operational_summary: {
      next_action: nextActionForCursor(pageCursor),
      requires_re_evaluation_source_notice_ids: deltaPlan.actions
        .filter(action => action.requires_re_evaluation)
        .map(action => action.source_notice_id),
      rejected_count: batch.rejected.length,
      live_connection_used: false,
      database_write_used: false,
      ai_used: false
    }
  };
}

export const SUPPORT_RADAR_BIZINFO_SIMULATION_CONTRACT = Object.freeze({
  version: 'support-radar-bizinfo-simulation-v1',
  stages: Object.freeze([
    'public_request_plan',
    'normalize',
    'fingerprint',
    'delta_plan',
    'page_cursor',
    'run_record'
  ]),
  principles: Object.freeze([
    'simulation accepts source payload directly and performs no fetch',
    'service key parameter name may appear in request plan but never in the ledger run request',
    'database writes are outside the simulation',
    'AI interpretation is outside the simulation',
    'pagination contradictions become an explicit operational action'
  ])
});
