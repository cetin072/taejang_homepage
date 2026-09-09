const SOURCE_CODE = /^[a-z][a-z0-9_]{1,59}$/;

function clean(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function assertObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
}

function validIsoInstant(value) {
  const raw = clean(value);
  if (!raw) return false;
  const time = Date.parse(raw);
  return Number.isFinite(time) && /(?:Z|[+-]\d{2}:\d{2})$/.test(raw);
}

function validateOccurrence(occurrence) {
  assertObject(occurrence, 'INGESTION_OCCURRENCE_REQUIRED');
  if (!clean(occurrence.source_notice_id)) throw new Error('INGESTION_SOURCE_NOTICE_ID_REQUIRED');
  if (!clean(occurrence.source_url)) throw new Error('INGESTION_SOURCE_URL_REQUIRED');
  if (!clean(occurrence.raw_title)) throw new Error('INGESTION_RAW_TITLE_REQUIRED');
  assertObject(occurrence.raw_payload, 'INGESTION_RAW_PAYLOAD_REQUIRED');
}

function validateNotice(notice) {
  assertObject(notice, 'INGESTION_NOTICE_REQUIRED');
  if (!clean(notice.title)) throw new Error('INGESTION_NOTICE_TITLE_REQUIRED');
  if (!Array.isArray(notice.target_regions)) throw new Error('INGESTION_TARGET_REGIONS_ARRAY_REQUIRED');
  if (!Array.isArray(notice.categories)) throw new Error('INGESTION_CATEGORIES_ARRAY_REQUIRED');
}

function validateDocuments(documents) {
  if (!Array.isArray(documents)) throw new Error('INGESTION_DOCUMENTS_ARRAY_REQUIRED');
  for (const document of documents) {
    assertObject(document, 'INGESTION_DOCUMENT_INVALID');
    if (!clean(document.source_url)) throw new Error('INGESTION_DOCUMENT_URL_REQUIRED');
  }
}

export function validateSupportRadarIngestionBatch(batch) {
  assertObject(batch, 'INGESTION_BATCH_REQUIRED');
  if (!SOURCE_CODE.test(clean(batch.source_code))) throw new Error('INGESTION_SOURCE_CODE_INVALID');
  if (!validIsoInstant(batch.fetched_at)) throw new Error('INGESTION_FETCHED_AT_INVALID');
  if (!Array.isArray(batch.items)) throw new Error('INGESTION_ITEMS_ARRAY_REQUIRED');
  if (!Array.isArray(batch.rejected)) throw new Error('INGESTION_REJECTED_ARRAY_REQUIRED');

  const ids = new Set();
  batch.items.forEach(item => {
    assertObject(item, 'INGESTION_ITEM_INVALID');
    validateOccurrence(item.occurrence);
    validateNotice(item.notice);
    validateDocuments(item.documents);
    const id = clean(item.occurrence.source_notice_id);
    if (ids.has(id)) throw new Error('INGESTION_DUPLICATE_SOURCE_NOTICE_ID');
    ids.add(id);
  });

  return batch;
}

export function createSupportRadarIngestionBatch({ source_code, fetched_at, normalized, cursor = null }) {
  assertObject(normalized, 'INGESTION_NORMALIZED_PAYLOAD_REQUIRED');
  const batch = {
    contract_version: 'support-radar-ingestion-v1',
    source_code: clean(source_code),
    fetched_at: clean(fetched_at),
    cursor: cursor === undefined ? null : cursor,
    source_meta: normalized.meta && typeof normalized.meta === 'object' && !Array.isArray(normalized.meta)
      ? normalized.meta
      : {},
    items: Array.isArray(normalized.items) ? normalized.items : [],
    rejected: Array.isArray(normalized.rejected) ? normalized.rejected : []
  };
  return validateSupportRadarIngestionBatch(batch);
}

export const SUPPORT_RADAR_INGESTION_CONTRACT = Object.freeze({
  version: 'support-radar-ingestion-v1',
  authoritative_fields: Object.freeze([
    'source_code',
    'fetched_at',
    'cursor',
    'source_meta',
    'items',
    'rejected'
  ]),
  principles: Object.freeze([
    'source adapter normalizes facts only',
    'invalid source items are rejected, not invented',
    'semantic AI interpretation is outside ingestion',
    'delivery/alerts are outside ingestion'
  ])
});
