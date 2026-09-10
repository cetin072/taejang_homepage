const SOURCE_CODE = /^[a-z][a-z0-9_]{1,59}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const FORBIDDEN_SECRET_KEY = /(secret|password|token|api[_-]?key|crtfcKey)/i;

function clean(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function assertObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
}

function validIsoInstant(value) {
  const raw = clean(value);
  if (!raw) return false;
  return Number.isFinite(Date.parse(raw)) && /(?:Z|[+-]\d{2}:\d{2})$/.test(raw);
}

function assertNoSecretValues(value, path = 'request') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretValues(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_SECRET_KEY.test(key)) throw new Error(`INGESTION_RUN_SECRET_FIELD_FORBIDDEN:${path}.${key}`);
    assertNoSecretValues(entry, `${path}.${key}`);
  }
}

function validateRunBase(run) {
  assertObject(run, 'INGESTION_RUN_REQUIRED');
  if (!RUN_ID.test(clean(run.run_id))) throw new Error('INGESTION_RUN_ID_INVALID');
  if (!SOURCE_CODE.test(clean(run.source_code))) throw new Error('INGESTION_RUN_SOURCE_CODE_INVALID');
  if (!validIsoInstant(run.started_at)) throw new Error('INGESTION_RUN_STARTED_AT_INVALID');
  if (!['running', 'succeeded', 'failed'].includes(run.status)) throw new Error('INGESTION_RUN_STATUS_INVALID');
  assertObject(run.request, 'INGESTION_RUN_REQUEST_REQUIRED');
  assertNoSecretValues(run.request);
}

export function startSupportRadarIngestionRun({
  run_id,
  source_code,
  started_at,
  request,
  cursor_before = null
}) {
  const run = {
    contract_version: 'support-radar-ingestion-run-v1',
    run_id: clean(run_id),
    source_code: clean(source_code),
    status: 'running',
    started_at: clean(started_at),
    finished_at: null,
    request: request && typeof request === 'object' && !Array.isArray(request) ? structuredClone(request) : request,
    cursor_before: cursor_before === undefined ? null : structuredClone(cursor_before),
    cursor_after: null,
    batch_contract_version: null,
    content_hash_basis_version: null,
    delta_contract_version: null,
    counts: null,
    retryable: null,
    error_code: null,
    error_summary: null
  };
  validateRunBase(run);
  return run;
}

export function completeSupportRadarIngestionRun(run, {
  finished_at,
  batch,
  delta_plan,
  cursor_after = null
}) {
  validateRunBase(run);
  if (run.status !== 'running') throw new Error('INGESTION_RUN_NOT_RUNNING');
  if (!validIsoInstant(finished_at)) throw new Error('INGESTION_RUN_FINISHED_AT_INVALID');
  if (Date.parse(finished_at) < Date.parse(run.started_at)) throw new Error('INGESTION_RUN_FINISHED_BEFORE_START');
  assertObject(batch, 'INGESTION_RUN_BATCH_REQUIRED');
  assertObject(delta_plan, 'INGESTION_RUN_DELTA_PLAN_REQUIRED');
  if (!Array.isArray(batch.items) || !Array.isArray(batch.rejected)) throw new Error('INGESTION_RUN_BATCH_COUNTS_INVALID');
  assertObject(delta_plan.counts, 'INGESTION_RUN_DELTA_COUNTS_REQUIRED');

  return {
    ...structuredClone(run),
    status: 'succeeded',
    finished_at: clean(finished_at),
    cursor_after: cursor_after === undefined ? null : structuredClone(cursor_after),
    batch_contract_version: clean(batch.contract_version) || null,
    content_hash_basis_version: clean(batch.items[0]?.content_hash_basis_version) || null,
    delta_contract_version: clean(delta_plan.contract_version) || null,
    counts: {
      fetched_items: batch.items.length,
      rejected_items: batch.rejected.length,
      insert: Number(delta_plan.counts.insert || 0),
      touch_seen: Number(delta_plan.counts.touch_seen || 0),
      update_material_facts: Number(delta_plan.counts.update_material_facts || 0),
      rebaseline: Number(delta_plan.counts.rebaseline || 0),
      requires_re_evaluation: Number(delta_plan.requires_re_evaluation_count || 0)
    },
    retryable: false,
    error_code: null,
    error_summary: null
  };
}

export function failSupportRadarIngestionRun(run, {
  finished_at,
  error_code,
  error_summary,
  retryable,
  cursor_after = null
}) {
  validateRunBase(run);
  if (run.status !== 'running') throw new Error('INGESTION_RUN_NOT_RUNNING');
  if (!validIsoInstant(finished_at)) throw new Error('INGESTION_RUN_FINISHED_AT_INVALID');
  if (Date.parse(finished_at) < Date.parse(run.started_at)) throw new Error('INGESTION_RUN_FINISHED_BEFORE_START');
  const code = clean(error_code);
  const summary = clean(error_summary);
  if (!code) throw new Error('INGESTION_RUN_ERROR_CODE_REQUIRED');
  if (!summary) throw new Error('INGESTION_RUN_ERROR_SUMMARY_REQUIRED');
  if (typeof retryable !== 'boolean') throw new Error('INGESTION_RUN_RETRYABLE_REQUIRED');

  return {
    ...structuredClone(run),
    status: 'failed',
    finished_at: clean(finished_at),
    cursor_after: cursor_after === undefined ? null : structuredClone(cursor_after),
    retryable,
    error_code: code,
    error_summary: summary.slice(0, 1000)
  };
}

export const SUPPORT_RADAR_INGESTION_RUN_CONTRACT = Object.freeze({
  version: 'support-radar-ingestion-run-v1',
  statuses: Object.freeze(['running', 'succeeded', 'failed']),
  principles: Object.freeze([
    'run records contain public request metadata only',
    'service keys and credential values are never ledger fields',
    'success records batch and delta contract provenance',
    'failure records retryability separately from the error summary',
    'cursor progression is explicit and never inferred from a failed run'
  ])
});
