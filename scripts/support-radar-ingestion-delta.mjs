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

/**
 * Compare two normalized occurrences of the same source notice.
 * This does not decide semantic importance; it only reports deterministic source change state.
 */
export function classifySupportRadarItemDelta(previousItem, currentItem) {
  if (previousItem === null || previousItem === undefined) {
    const current = validateFingerprintedItem(currentItem, 'DELTA_CURRENT');
    return {
      status: 'new',
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
    source_notice_id: current.sourceNoticeId,
    previous_content_hash: previous.hash,
    current_content_hash: current.hash,
    content_hash_basis_version: current.basis,
    requires_rebaseline: false,
    requires_re_evaluation: true
  };
}

/**
 * Build a deterministic pagination cursor without assuming an undocumented remote page limit.
 * `reported_total_count` is optional because some sources may omit or distrust it.
 */
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
    const consumedUpperBound = (pageIndex - 1) * pageUnit + itemCount;
    hasMore = consumedUpperBound < totalCount;
    state = hasMore ? 'more' : 'complete';
    nextPageIndex = hasMore ? pageIndex + 1 : null;
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
  principles: Object.freeze([
    'same source notice id plus same material hash means unchanged',
    'same source notice id plus different material hash means changed',
    'hash basis changes require rebaseline rather than pretending content changed',
    'changed or new source facts require deterministic re-evaluation eligibility',
    'pagination does not assume undocumented remote page limits'
  ])
});
