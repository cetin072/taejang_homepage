const SHA256 = /^[a-f0-9]{64}$/;

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

function nonNegativeIntegerOrNull(value, code) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(code);
  return number;
}

function validateFingerprintedItem(item, prefix) {
  assertObject(item, `${prefix}_ITEM_REQUIRED`);
  const sourceNoticeId = clean(item?.occurrence?.source_notice_id);
  if (!sourceNoticeId) throw new Error(`${prefix}_SOURCE_NOTICE_ID_REQUIRED`);
  const hash = clean(item.content_hash);
  if (!SHA256.test(hash)) throw new Error(`${prefix}_CONTENT_HASH_INVALID`);
  const basis = clean(item.content_hash_basis_version);
  if (!basis) throw new Error(`${prefix}_CONTENT_HASH_BASIS_REQUIRED`);
  return { sourceNoticeId, hash, basis };
}

export function classifySupportRadarItemDelta(previousItem, currentItem) {
  if (previousItem === null || previousItem === undefined) {
    const current = validateFingerprintedItem(currentItem, 'DELTA_CURRENT');
    return {
      status: 'new',
      revision_kind: 'none',
      source_notice_id: current.sourceNoticeId,
      previous_content_hash: null,
      current_content_hash: current.hash,
      content_hash_basis_version: current.basis,
      requires_rebaseline: false,
      requires_re_evaluation: true
    };
  }

  const previous = validateFingerprintedItem(previousItem, 'DELTA_PREVIOUS');
  const current = validateFingerprintedItem(currentItem, 'DELTA_CURRENT');

  if (previous.sourceNoticeId !== current.sourceNoticeId) {
    throw new Error('DELTA_SOURCE_NOTICE_ID_MISMATCH');
  }

  if (previous.basis !== current.basis) {
    return {
      status: 'basis_changed',
      revision_kind: 'hash_contract_change',
      source_notice_id: current.sourceNoticeId,
      previous_content_hash: previous.hash,
      current_content_hash: current.hash,
      content_hash_basis_version: current.basis,
      previous_content_hash_basis_version: previous.basis,
      requires_rebaseline: true,
      requires_re_evaluation: true
    };
  }

  if (previous.hash === current.hash) {
    return {
      status: 'unchanged',
      revision_kind: 'none',
      source_notice_id: current.sourceNoticeId,
      previous_content_hash: previous.hash,
      current_content_hash: current.hash,
      content_hash_basis_version: current.basis,
      requires_rebaseline: false,
      requires_re_evaluation: false
    };
  }

  return {
    status: 'changed',
    revision_kind: 'same_source_id_material_change',
    source_notice_id: current.sourceNoticeId,
    previous_content_hash: previous.hash,
    current_content_hash: current.hash,
    content_hash_basis_version: current.basis,
    requires_rebaseline: false,
    requires_re_evaluation: true
  };
}

function deltaAction(status) {
  if (status === 'new') return 'insert';
  if (status === 'unchanged') return 'touch_seen';
  if (status === 'changed') return 'update_material_facts';
  if (status === 'basis_changed') return 'rebaseline';
  throw new Error('DELTA_STATUS_UNSUPPORTED');
}

export function planSupportRadarBatchDelta({ current_items, previous_items = [] }) {
  if (!Array.isArray(current_items)) throw new Error('DELTA_CURRENT_ITEMS_ARRAY_REQUIRED');
  if (!Array.isArray(previous_items)) throw new Error('DELTA_PREVIOUS_ITEMS_ARRAY_REQUIRED');

  const previousById = new Map();
  for (const item of previous_items) {
    const identity = validateFingerprintedItem(item, 'DELTA_PREVIOUS');
    if (previousById.has(identity.sourceNoticeId)) throw new Error('DELTA_PREVIOUS_DUPLICATE_SOURCE_NOTICE_ID');
    previousById.set(identity.sourceNoticeId, item);
  }

  const seenCurrent = new Set();
  const actions = current_items.map(item => {
    const current = validateFingerprintedItem(item, 'DELTA_CURRENT');
    if (seenCurrent.has(current.sourceNoticeId)) throw new Error('DELTA_CURRENT_DUPLICATE_SOURCE_NOTICE_ID');
    seenCurrent.add(current.sourceNoticeId);
    const delta = classifySupportRadarItemDelta(previousById.get(current.sourceNoticeId), item);
    return {
      source_notice_id: current.sourceNoticeId,
      action: deltaAction(delta.status),
      delta_status: delta.status,
      revision_kind: delta.revision_kind,
      requires_re_evaluation: delta.requires_re_evaluation,
      requires_rebaseline: delta.requires_rebaseline,
      previous_content_hash: delta.previous_content_hash,
      current_content_hash: delta.current_content_hash,
      content_hash_basis_version: delta.content_hash_basis_version
    };
  });

  const counts = {
    insert: 0,
    touch_seen: 0,
    update_material_facts: 0,
    rebaseline: 0
  };
  for (const action of actions) counts[action.action] += 1;

  return {
    contract_version: 'support-radar-reingestion-plan-v1',
    actions,
    counts,
    requires_re_evaluation_count: actions.filter(action => action.requires_re_evaluation).length
  };
}

export function buildSupportRadarPageCursor({
  page_index,
  page_unit,
  item_count,
  reported_total_count = null
}) {
  const pageIndex = positiveInteger(page_index, 'CURSOR_PAGE_INDEX_INVALID');
  const pageUnit = positiveInteger(page_unit, 'CURSOR_PAGE_UNIT_INVALID');
  const itemCount = nonNegativeIntegerOrNull(item_count, 'CURSOR_ITEM_COUNT_INVALID');
  if (itemCount === null) throw new Error('CURSOR_ITEM_COUNT_REQUIRED');
  if (itemCount > pageUnit) throw new Error('CURSOR_ITEM_COUNT_EXCEEDS_PAGE_UNIT');
  const totalCount = nonNegativeIntegerOrNull(reported_total_count, 'CURSOR_TOTAL_COUNT_INVALID');

  let state;
  let hasMore;
  let nextPageIndex = null;

  if (totalCount !== null) {
    const consumedBefore = (pageIndex - 1) * pageUnit;
    const consumedAfter = consumedBefore + itemCount;
    const impossibleOverflow = consumedAfter > totalCount;
    const shortPageBeforeReportedEnd = itemCount < pageUnit && consumedAfter < totalCount;

    if (impossibleOverflow || shortPageBeforeReportedEnd) {
      state = 'inconsistent';
      hasMore = null;
      nextPageIndex = null;
    } else {
      hasMore = consumedAfter < totalCount;
      state = hasMore ? 'more' : 'complete';
      nextPageIndex = hasMore ? pageIndex + 1 : null;
    }
  } else if (itemCount < pageUnit) {
    hasMore = false;
    state = 'complete';
  } else {
    hasMore = null;
    state = 'unknown';
    nextPageIndex = pageIndex + 1;
  }

  return {
    contract_version: 'support-radar-page-cursor-v1',
    page_index: pageIndex,
    page_unit: pageUnit,
    item_count: itemCount,
    reported_total_count: totalCount,
    state,
    has_more: hasMore,
    next_page_index: nextPageIndex
  };
}

export const SUPPORT_RADAR_DELTA_CONTRACT = Object.freeze({
  version: 'support-radar-delta-v1',
  statuses: Object.freeze(['new', 'unchanged', 'changed', 'basis_changed']),
  revision_kinds: Object.freeze(['none', 'same_source_id_material_change', 'hash_contract_change']),
  write_actions: Object.freeze(['insert', 'touch_seen', 'update_material_facts', 'rebaseline']),
  cursor_states: Object.freeze(['more', 'complete', 'unknown', 'inconsistent']),
  principles: Object.freeze([
    'same source notice id plus same material hash means unchanged',
    'same source notice id plus different material hash means a source revision candidate',
    'different source notice ids are not auto-linked as revisions',
    'hash basis changes require rebaseline rather than pretending source content changed',
    'changed or new source facts require deterministic re-evaluation eligibility',
    'write planning is deterministic and separate from database mutation',
    'pagination does not assume undocumented remote page limits',
    'pagination stops on contradictory total-count and page-shape signals'
  ])
});
