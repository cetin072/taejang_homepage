import {
  buildBizinfoPublicRequestPlan,
  normalizeBizinfoPayload
} from './support-radar-bizinfo-normalizer.mjs';
import {
  createSupportRadarIngestionBatch,
  SUPPORT_RADAR_INGESTION_CONTRACT
} from './support-radar-ingestion-contract.mjs';
import {
  buildSupportRadarPageCursor,
  planSupportRadarBatchDelta,
  SUPPORT_RADAR_DELTA_CONTRACT
} from './support-radar-ingestion-delta.mjs';
import { buildSupportRadarPhase1WriteCandidate } from './support-radar-ingestion-phase1-map.mjs';

const PILOT_MAX_PAGE_UNIT = 20;
const PILOT_MAX_SEARCH_COUNT = 20;
const PILOT_MAX_HASHTAGS_LENGTH = 200;
const ALLOWED_REQUEST_FILTERS = new Set(['searchCnt', 'searchLclasId', 'hashtags']);

function clean(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function assertObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
}

function positiveInteger(value, code) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(code);
  return number;
}

function validIsoInstant(value) {
  const raw = clean(value);
  if (!raw || !/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return false;
  return Number.isFinite(Date.parse(raw));
}

function requireInstant(value, code) {
  if (!validIsoInstant(value)) throw new Error(code);
  return clean(value);
}

function validateRequestFilters(filters) {
  assertObject(filters, 'BIZINFO_PILOT_REQUEST_FILTERS_OBJECT_REQUIRED');
  for (const key of Object.keys(filters)) {
    if (!ALLOWED_REQUEST_FILTERS.has(key)) {
      throw new Error(`BIZINFO_PILOT_REQUEST_FILTER_FORBIDDEN:${key}`);
    }
  }

  const result = structuredClone(filters);
  if (result.searchCnt !== null && result.searchCnt !== undefined && result.searchCnt !== '') {
    const searchCount = positiveInteger(result.searchCnt, 'BIZINFO_PILOT_SEARCH_COUNT_INVALID');
    if (searchCount > PILOT_MAX_SEARCH_COUNT) throw new Error('BIZINFO_PILOT_SEARCH_COUNT_EXCEEDS_LIMIT');
    result.searchCnt = searchCount;
  }
  if (clean(result.hashtags).length > PILOT_MAX_HASHTAGS_LENGTH) {
    throw new Error('BIZINFO_PILOT_HASHTAGS_TOO_LONG');
  }
  return result;
}

function validateCursorBefore(cursor) {
  if (cursor === null || cursor === undefined) return null;
  assertObject(cursor, 'BIZINFO_PILOT_CURSOR_BEFORE_OBJECT_REQUIRED');
  return structuredClone(cursor);
}

function validatePreviousItems(previousItems) {
  for (const item of previousItems) {
    if (clean(item?.source_code) !== 'bizinfo') {
      throw new Error('BIZINFO_PILOT_PREVIOUS_SOURCE_MISMATCH');
    }
  }
}

function rejectLedgerInput(rejected) {
  const details = { ...rejected };
  delete details.index;
  delete details.reason;
  delete details.source_notice_id;
  return {
    item_index: Number.isInteger(rejected.index) ? rejected.index : null,
    source_notice_id: clean(rejected.source_notice_id) || null,
    reason: clean(rejected.reason) || 'SOURCE_ITEM_REJECTED',
    details
  };
}

function buildWritePlans(batch, deltaPlan, fetchedAt) {
  const actionById = new Map(
    deltaPlan.actions.map(action => [action.source_notice_id, action])
  );

  return batch.items.map(item => {
    const sourceNoticeId = item.occurrence.source_notice_id;
    const action = actionById.get(sourceNoticeId);
    if (!action) throw new Error('BIZINFO_PILOT_DELTA_ACTION_MISSING');
    return {
      source_notice_id: sourceNoticeId,
      expected_delta_status: action.delta_status,
      expected_write_action: action.action,
      requires_re_evaluation: action.requires_re_evaluation,
      candidate: buildSupportRadarPhase1WriteCandidate(item, { fetched_at: fetchedAt })
    };
  });
}

/**
 * Builds the exact one-page Staging pilot package up to, but not including,
 * network access, secret handling, database mutation, Rule Engine execution or AI.
 */
export function buildBizinfoStagingPilotOfflinePlan({
  payload,
  previous_items = [],
  started_at,
  fetched_at,
  finished_at,
  page_index = 1,
  page_unit = 20,
  stream_key = 'default',
  cursor_before = null,
  request_filters = {}
}) {
  assertObject(payload, 'BIZINFO_PILOT_PAYLOAD_OBJECT_REQUIRED');
  if (!Array.isArray(previous_items)) throw new Error('BIZINFO_PILOT_PREVIOUS_ITEMS_ARRAY_REQUIRED');
  validatePreviousItems(previous_items);

  const pageIndex = positiveInteger(page_index, 'BIZINFO_PILOT_PAGE_INDEX_INVALID');
  const pageUnit = positiveInteger(page_unit, 'BIZINFO_PILOT_PAGE_UNIT_INVALID');
  if (pageIndex !== 1) throw new Error('BIZINFO_PILOT_PAGE_INDEX_MUST_BE_ONE');
  if (pageUnit > PILOT_MAX_PAGE_UNIT) throw new Error('BIZINFO_PILOT_PAGE_UNIT_EXCEEDS_LIMIT');

  const streamKey = clean(stream_key);
  if (!streamKey || streamKey.length > 120) throw new Error('BIZINFO_PILOT_STREAM_KEY_INVALID');

  const startedAt = requireInstant(started_at, 'BIZINFO_PILOT_STARTED_AT_INVALID');
  const fetchedAt = requireInstant(fetched_at, 'BIZINFO_PILOT_FETCHED_AT_INVALID');
  const finishedAt = requireInstant(finished_at, 'BIZINFO_PILOT_FINISHED_AT_INVALID');
  if (Date.parse(startedAt) > Date.parse(fetchedAt) || Date.parse(fetchedAt) > Date.parse(finishedAt)) {
    throw new Error('BIZINFO_PILOT_TIMELINE_INVALID');
  }

  const requestFilters = validateRequestFilters(request_filters);
  const cursorBefore = validateCursorBefore(cursor_before);
  const requestPlan = buildBizinfoPublicRequestPlan({
    ...requestFilters,
    dataType: 'json',
    pageUnit,
    pageIndex
  });

  const normalized = normalizeBizinfoPayload(payload);
  const batch = createSupportRadarIngestionBatch({
    source_code: 'bizinfo',
    fetched_at: fetchedAt,
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
    item_count: normalized.meta.source_item_count,
    reported_total_count: normalized.meta.reported_total_count
  });
  const writePlans = buildWritePlans(batch, deltaPlan, fetchedAt);
  const rejectPlans = batch.rejected.map(rejectLedgerInput);
  const successAllowedByCursor = pageCursor.state !== 'inconsistent';
  const paginationFollowupRequired = pageCursor.state === 'more' || pageCursor.state === 'unknown';

  return {
    contract_version: 'support-radar-bizinfo-staging-pilot-offline-v1',
    request_plan: requestPlan,
    normalized_meta: structuredClone(normalized.meta),
    page_cursor: pageCursor,
    delta_summary: {
      counts: structuredClone(deltaPlan.counts),
      requires_re_evaluation_count: deltaPlan.requires_re_evaluation_count
    },
    ledger_plan: {
      begin_run_input: {
        source_code: 'bizinfo',
        stream_key: streamKey,
        started_at: startedAt,
        request_public: requestPlan,
        cursor_before: cursorBefore,
        batch_contract_version: SUPPORT_RADAR_INGESTION_CONTRACT.version,
        content_hash_basis_version: SUPPORT_RADAR_INGESTION_CONTRACT.content_hash_basis_version,
        delta_contract_version: SUPPORT_RADAR_DELTA_CONTRACT.version
      },
      item_write_plans: writePlans,
      reject_plans: rejectPlans,
      finish_run_preview: {
        finished_at: finishedAt,
        cursor_after: pageCursor,
        success_allowed_by_cursor: successAllowedByCursor
      }
    },
    operational_summary: {
      source_item_count: normalized.meta.source_item_count,
      accepted_item_count: batch.items.length,
      rejected_item_count: batch.rejected.length,
      planned_write_count: writePlans.length,
      requires_re_evaluation_source_notice_ids: writePlans
        .filter(plan => plan.requires_re_evaluation)
        .map(plan => plan.source_notice_id),
      pagination_followup_required: paginationFollowupRequired,
      manual_review_required: batch.rejected.length > 0 || pageCursor.state === 'inconsistent' || pageCursor.state === 'unknown',
      network_used: false,
      credential_accepted: false,
      database_write_performed: false,
      rule_engine_executed: false,
      ai_used: false,
      production_touched: false
    }
  };
}

export const SUPPORT_RADAR_BIZINFO_STAGING_PILOT_OFFLINE_CONTRACT = Object.freeze({
  version: 'support-radar-bizinfo-staging-pilot-offline-v1',
  max_pages: 1,
  max_page_unit: PILOT_MAX_PAGE_UNIT,
  max_search_count: PILOT_MAX_SEARCH_COUNT,
  data_type: 'json',
  allowed_request_filters: Object.freeze([...ALLOWED_REQUEST_FILTERS]),
  principles: Object.freeze([
    'the pilot plan is single-page and finite',
    'credential-shaped or unknown request filters are rejected by allowlist before planning',
    'search count cannot exceed the one-page pilot item budget',
    'previous comparison items must belong to the BizInfo Source',
    'pagination uses raw source page item count rather than accepted normalized item count',
    'rejected items remain explicit ledger reject plans and do not silently disappear',
    'Phase 1 write candidates are prepared without database mutation',
    'Rule Engine execution, AI, live network access, secret handling and Production are outside this contract'
  ])
});
