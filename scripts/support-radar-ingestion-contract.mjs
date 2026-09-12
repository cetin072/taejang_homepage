import { createHash } from 'node:crypto';

const SOURCE_CODE = /^[a-z][a-z0-9_]{1,59}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CONTENT_HASH_BASIS_VERSION = 'support-radar-material-v1';

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

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function materialHashInput(item) {
  return {
    occurrence: {
      source_notice_id: item?.occurrence?.source_notice_id ?? null,
      source_url: item?.occurrence?.source_url ?? null,
      raw_title: item?.occurrence?.raw_title ?? null
    },
    notice: item?.notice ?? null,
    source_summary: item?.source_summary ?? null,
    application_url: item?.application_url ?? null,
    application_period_raw: item?.application_period_raw ?? null,
    hashtags: item?.hashtags ?? [],
    documents: item?.documents ?? []
  };
}

export function computeSupportRadarItemContentHash(item) {
  assertObject(item, 'INGESTION_ITEM_INVALID');
  const canonical = JSON.stringify(canonicalize(materialHashInput(item)));
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function attachContentHash(item) {
  return {
    ...item,
    content_hash: computeSupportRadarItemContentHash(item),
    content_hash_basis_version: CONTENT_HASH_BASIS_VERSION
  };
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

function validateContentHash(item) {
  if (!SHA256.test(clean(item.content_hash))) throw new Error('INGESTION_CONTENT_HASH_INVALID');
  if (item.content_hash_basis_version !== CONTENT_HASH_BASIS_VERSION) {
    throw new Error('INGESTION_CONTENT_HASH_BASIS_UNSUPPORTED');
  }
  if (item.content_hash !== computeSupportRadarItemContentHash(item)) {
    throw new Error('INGESTION_CONTENT_HASH_MISMATCH');
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
    validateContentHash(item);
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
    items: (Array.isArray(normalized.items) ? normalized.items : []).map(attachContentHash),
    rejected: Array.isArray(normalized.rejected) ? normalized.rejected : []
  };
  return validateSupportRadarIngestionBatch(batch);
}

export const SUPPORT_RADAR_INGESTION_CONTRACT = Object.freeze({
  version: 'support-radar-ingestion-v1',
  content_hash_basis_version: CONTENT_HASH_BASIS_VERSION,
  authoritative_fields: Object.freeze([
    'source_code',
    'fetched_at',
    'cursor',
    'source_meta',
    'items',
    'rejected'
  ]),
  item_freshness_fields: Object.freeze([
    'content_hash',
    'content_hash_basis_version'
  ]),
  principles: Object.freeze([
    'source adapter normalizes facts only',
    'invalid source items are rejected, not invented',
    'content hash covers normalized material facts, not volatile raw payload metadata',
    'raw payload remains available separately for provenance',
    'semantic AI interpretation is outside ingestion',
    'delivery and alerts are outside ingestion'
  ])
});
