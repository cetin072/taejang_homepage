const SHA256 = /^[a-f0-9]{64}$/;

function clean(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function assertObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function isValidDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function dateOnlyFact(value, precision, field) {
  const date = clean(value) || null;
  const normalizedPrecision = clean(precision) || 'unknown';
  if (!date) return null;
  if (normalizedPrecision !== 'date') {
    throw new Error(`PHASE1_MAP_${field.toUpperCase()}_PRECISION_UNSUPPORTED`);
  }
  if (!isValidDateOnly(date)) {
    throw new Error(`PHASE1_MAP_${field.toUpperCase()}_DATE_INVALID`);
  }
  return {
    value: date,
    precision: 'date',
    target_column: field === 'application_start' ? 'application_start_at' : 'deadline_at',
    action: 'defer',
    reason: 'DATE_ONLY_MUST_NOT_BE_INVENTED_AS_TIMESTAMPTZ'
  };
}

export function buildSupportRadarPhase1WriteCandidate(item, { fetched_at = null } = {}) {
  assertObject(item, 'PHASE1_MAP_ITEM_REQUIRED');
  assertObject(item.occurrence, 'PHASE1_MAP_OCCURRENCE_REQUIRED');
  assertObject(item.notice, 'PHASE1_MAP_NOTICE_REQUIRED');
  if (!clean(item.occurrence.source_notice_id)) throw new Error('PHASE1_MAP_SOURCE_NOTICE_ID_REQUIRED');
  if (!clean(item.occurrence.source_url)) throw new Error('PHASE1_MAP_SOURCE_URL_REQUIRED');
  if (!clean(item.notice.title)) throw new Error('PHASE1_MAP_NOTICE_TITLE_REQUIRED');
  if (!SHA256.test(clean(item.content_hash))) throw new Error('PHASE1_MAP_CONTENT_HASH_INVALID');
  if (!clean(item.content_hash_basis_version)) throw new Error('PHASE1_MAP_CONTENT_HASH_BASIS_REQUIRED');
  if (!Array.isArray(item.notice.target_regions)) throw new Error('PHASE1_MAP_TARGET_REGIONS_ARRAY_REQUIRED');
  if (!Array.isArray(item.notice.categories)) throw new Error('PHASE1_MAP_CATEGORIES_ARRAY_REQUIRED');
  if (!Array.isArray(item.documents)) throw new Error('PHASE1_MAP_DOCUMENTS_ARRAY_REQUIRED');

  const applicationStart = dateOnlyFact(
    item.notice.application_start_date,
    item.notice.application_start_precision,
    'application_start'
  );
  const deadline = dateOnlyFact(
    item.notice.deadline_date,
    item.notice.deadline_precision,
    'deadline'
  );

  const ingestionMetadata = {
    contract_version: 'support-radar-phase1-map-v1',
    fetched_at: clean(fetched_at) || null,
    content_hash_basis_version: clean(item.content_hash_basis_version),
    source_published_raw: clean(item.occurrence.source_published_raw) || null,
    source_summary: clean(item.source_summary) || null,
    application_url: clean(item.application_url) || null,
    application_period_raw: clean(item.application_period_raw) || null,
    hashtags: Array.isArray(item.hashtags) ? clone(item.hashtags) : [],
    date_facts: {
      application_start: applicationStart,
      deadline
    }
  };

  const rawPayload = clone(item.occurrence.raw_payload ?? {});
  const occurrenceRawPayload = {
    ...rawPayload,
    _support_radar_ingestion: ingestionMetadata
  };

  return {
    contract_version: 'support-radar-phase1-map-v1',
    source_code: clean(item.source_code) || null,
    support_notice: {
      title: clean(item.notice.title),
      managing_organization: clean(item.notice.managing_organization) || null,
      implementing_organization: clean(item.notice.implementing_organization) || null,
      canonical_url: clean(item.notice.canonical_url) || clean(item.occurrence.source_url),
      target_regions: clone(item.notice.target_regions),
      categories: clone(item.notice.categories),
      eligibility_summary: clean(item.notice.eligibility_summary) || null,
      application_process_summary: clean(item.notice.application_process_summary) || null,
      contact_summary: clean(item.notice.contact_summary) || null
    },
    support_notice_occurrence: {
      source_notice_id: clean(item.occurrence.source_notice_id),
      source_url: clean(item.occurrence.source_url),
      raw_title: clean(item.occurrence.raw_title) || clean(item.notice.title),
      raw_payload: occurrenceRawPayload,
      content_hash: clean(item.content_hash)
    },
    support_documents: item.documents.map(document => {
      assertObject(document, 'PHASE1_MAP_DOCUMENT_INVALID');
      if (!clean(document.source_url)) throw new Error('PHASE1_MAP_DOCUMENT_URL_REQUIRED');
      return {
        document_type: clean(document.document_type) || 'attachment',
        original_filename: clean(document.original_filename) || null,
        source_url: clean(document.source_url),
        content_hash: clean(document.content_hash) || null
      };
    }),
    deferred_fields: [applicationStart, deadline].filter(Boolean),
    ledger_requirements: {
      preserve_content_hash_basis_version: true,
      preserve_ingestion_run_and_cursor: true,
      preserve_rejected_item_counts: true
    },
    safety: {
      database_write_performed: false,
      timestamp_invention_performed: false,
      semantic_ai_used: false
    }
  };
}

export const SUPPORT_RADAR_PHASE1_MAP_CONTRACT = Object.freeze({
  version: 'support-radar-phase1-map-v1',
  principles: Object.freeze([
    'map only fields that exist in the current Phase 1 schema',
    'preserve source-only facts inside occurrence provenance until an authoritative column exists',
    'do not coerce date-only source facts into timestamp columns',
    'reject calendar-invalid date-only facts even when their string shape is valid',
    'content hash basis, run, cursor, and reject history require an ingestion ledger boundary',
    'mapping performs no database mutation and no semantic AI judgment'
  ])
});
