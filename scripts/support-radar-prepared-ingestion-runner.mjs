const PILOT_PLAN_VERSION = 'support-radar-bizinfo-staging-pilot-offline-v1';

function clean(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function assertObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
}

function rpcSucceeded(result) {
  return Boolean(result && result.ok === true);
}

function safeFailure(stage) {
  const codes = {
    apply_item: ['PREPARED_ITEM_WRITE_FAILED', 'prepared ingestion runner failed while applying an item'],
    record_reject: ['PREPARED_REJECT_WRITE_FAILED', 'prepared ingestion runner failed while recording a rejected item'],
    pilot_policy: ['PILOT_POLICY_BLOCKED', 'prepared ingestion pilot policy blocked successful cursor finalization'],
    source_reject: ['PILOT_SOURCE_ITEM_REJECTED', 'one or more source items were rejected during the prepared ingestion pilot']
  };
  return codes[stage] || ['PREPARED_INGESTION_FAILED', 'prepared ingestion runner failed'];
}

function validatePlan(plan) {
  assertObject(plan, 'PREPARED_INGESTION_PLAN_REQUIRED');
  if (plan.contract_version !== PILOT_PLAN_VERSION) throw new Error('PREPARED_INGESTION_PLAN_VERSION_UNSUPPORTED');
  assertObject(plan.ledger_plan, 'PREPARED_INGESTION_LEDGER_PLAN_REQUIRED');
  assertObject(plan.ledger_plan.begin_run_input, 'PREPARED_INGESTION_BEGIN_INPUT_REQUIRED');
  if (!Array.isArray(plan.ledger_plan.item_write_plans)) throw new Error('PREPARED_INGESTION_ITEM_PLANS_ARRAY_REQUIRED');
  if (!Array.isArray(plan.ledger_plan.reject_plans)) throw new Error('PREPARED_INGESTION_REJECT_PLANS_ARRAY_REQUIRED');
  assertObject(plan.ledger_plan.finish_run_preview, 'PREPARED_INGESTION_FINISH_PREVIEW_REQUIRED');
  assertObject(plan.operational_summary, 'PREPARED_INGESTION_OPERATIONAL_SUMMARY_REQUIRED');

  if (
    plan.operational_summary.network_used !== false
    || plan.operational_summary.credential_accepted !== false
    || plan.operational_summary.database_write_performed !== false
    || plan.operational_summary.rule_engine_executed !== false
    || plan.operational_summary.ai_used !== false
    || plan.operational_summary.production_touched !== false
  ) {
    throw new Error('PREPARED_INGESTION_SAFETY_FLAGS_INVALID');
  }

  const begin = plan.ledger_plan.begin_run_input;
  if (clean(begin.source_code) !== 'bizinfo') throw new Error('PREPARED_INGESTION_SOURCE_UNSUPPORTED');
  if (!clean(begin.stream_key)) throw new Error('PREPARED_INGESTION_STREAM_KEY_REQUIRED');
  if (!clean(begin.started_at)) throw new Error('PREPARED_INGESTION_STARTED_AT_REQUIRED');

  return plan;
}

function beginParameters(plan) {
  const input = plan.ledger_plan.begin_run_input;
  return {
    p_source_code: input.source_code,
    p_stream_key: input.stream_key,
    p_started_at: input.started_at,
    p_request_public: input.request_public,
    p_cursor_before: input.cursor_before,
    p_batch_contract_version: input.batch_contract_version,
    p_content_hash_basis_version: input.content_hash_basis_version,
    p_delta_contract_version: input.delta_contract_version
  };
}

function finishParameters(plan, runId, success, failure = null) {
  const preview = plan.ledger_plan.finish_run_preview;
  return {
    p_run_id: runId,
    p_finished_at: preview.finished_at,
    p_cursor_after: success ? preview.cursor_after : null,
    p_success: success,
    p_retryable: success ? null : true,
    p_error_code: success ? null : failure.code,
    p_error_summary: success ? null : failure.summary
  };
}

async function callRpc(rpc, name, parameters) {
  try {
    return await rpc(name, parameters);
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

async function finalizeFailure(rpc, plan, runId, stage) {
  const [code, summary] = safeFailure(stage);
  const finish = await callRpc(
    rpc,
    'support_ingestion_finish_run_v1',
    finishParameters(plan, runId, false, { code, summary })
  );
  if (!rpcSucceeded(finish)) throw new Error('PREPARED_INGESTION_FAILURE_FINALIZATION_FAILED');
  return {
    contract_version: 'support-radar-prepared-ingestion-runner-v1',
    run_id: runId,
    status: 'failed',
    failure_stage: stage,
    error_code: code,
    cursor_advanced: false,
    applied_item_count: null,
    recorded_reject_count: null,
    database_write_attempted: true,
    rule_engine_executed: false,
    ai_used: false,
    production_touched: false
  };
}

/**
 * Execute a previously built, credential-free one-page BizInfo pilot plan.
 * The caller supplies the service-side RPC transport. This runner performs no fetch,
 * accepts no secret, invokes no Rule Engine/AI, and never targets Production by itself.
 */
export async function executePreparedSupportRadarIngestion(plan, { rpc } = {}) {
  validatePlan(plan);
  if (typeof rpc !== 'function') throw new Error('PREPARED_INGESTION_RPC_REQUIRED');

  const begin = await callRpc(rpc, 'support_ingestion_begin_run_v1', beginParameters(plan));
  if (!rpcSucceeded(begin) || !clean(begin.data)) throw new Error('PREPARED_INGESTION_BEGIN_FAILED');
  const runId = clean(begin.data);
  let appliedItemCount = 0;
  let recordedRejectCount = 0;

  for (const writePlan of plan.ledger_plan.item_write_plans) {
    assertObject(writePlan, 'PREPARED_INGESTION_ITEM_PLAN_INVALID');
    const result = await callRpc(rpc, 'support_ingestion_apply_item_checked_v1', {
      p_run_id: runId,
      p_candidate: writePlan.candidate
    });
    if (!rpcSucceeded(result)) return finalizeFailure(rpc, plan, runId, 'apply_item');
    appliedItemCount += 1;
  }

  for (const rejectPlan of plan.ledger_plan.reject_plans) {
    assertObject(rejectPlan, 'PREPARED_INGESTION_REJECT_PLAN_INVALID');
    const result = await callRpc(rpc, 'support_ingestion_record_reject_v1', {
      p_run_id: runId,
      p_item_index: rejectPlan.item_index,
      p_source_notice_id: rejectPlan.source_notice_id,
      p_reason: rejectPlan.reason,
      p_details: rejectPlan.details
    });
    if (!rpcSucceeded(result)) return finalizeFailure(rpc, plan, runId, 'record_reject');
    recordedRejectCount += 1;
  }

  if (!plan.ledger_plan.finish_run_preview.success_allowed_by_pilot_policy) {
    const stage = recordedRejectCount > 0 ? 'source_reject' : 'pilot_policy';
    const result = await finalizeFailure(rpc, plan, runId, stage);
    return {
      ...result,
      applied_item_count: appliedItemCount,
      recorded_reject_count: recordedRejectCount
    };
  }

  const finish = await callRpc(
    rpc,
    'support_ingestion_finish_run_v1',
    finishParameters(plan, runId, true)
  );
  if (!rpcSucceeded(finish) || finish.data?.status !== 'succeeded') {
    throw new Error('PREPARED_INGESTION_SUCCESS_FINALIZATION_FAILED');
  }

  return {
    contract_version: 'support-radar-prepared-ingestion-runner-v1',
    run_id: runId,
    status: 'succeeded',
    failure_stage: null,
    error_code: null,
    cursor_advanced: finish.data?.cursor_advanced === true,
    applied_item_count: appliedItemCount,
    recorded_reject_count: recordedRejectCount,
    database_write_attempted: true,
    rule_engine_executed: false,
    ai_used: false,
    production_touched: false
  };
}

export const SUPPORT_RADAR_PREPARED_INGESTION_RUNNER_CONTRACT = Object.freeze({
  version: 'support-radar-prepared-ingestion-runner-v1',
  accepted_plan_version: PILOT_PLAN_VERSION,
  principles: Object.freeze([
    'network fetch and credential handling remain outside the runner',
    'only a prevalidated one-page BizInfo pilot plan may execute',
    'accepted item candidates and rejects are written before run finalization',
    'any pilot-policy block finalizes the run as failed and does not advance cursor',
    'transport or item-write failures are finalized with fixed non-sensitive diagnostics when possible',
    'Rule Engine, AI and Production targeting are outside the runner'
  ])
});
