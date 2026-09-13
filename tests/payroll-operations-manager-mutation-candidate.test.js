const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const candidatePath = path.join(root, 'prototypes/payroll-backend/operations_manager_mutation_candidate.sql');
const candidate = fs.readFileSync(candidatePath, 'utf8');

function functionBody(name) {
  const marker = `create or replace function public.${name}`;
  const start = candidate.toLowerCase().indexOf(marker.toLowerCase());
  assert.notEqual(start, -1, `${name} must exist in candidate`);
  const next = candidate.toLowerCase().indexOf('\ncreate or replace function public.', start + marker.length);
  return candidate.slice(start, next === -1 ? candidate.length : next);
}

test('mutation candidate remains rollback-only and outside real Supabase migrations', () => {
  assert.match(candidate, /Status: CANDIDATE ONLY\. ROLLBACK-ONLY/i);
  assert.match(candidate.trim(), /rollback;$/i);
  assert.equal(
    fs.existsSync(path.join(root, 'supabase/migrations/operations_manager_mutation_candidate.sql')),
    false,
    'candidate must not be promoted into executable migrations'
  );
});

test('every public mutation RPC requires the approved payroll operator server guard', () => {
  for (const name of [
    'apply_payroll_carryover',
    'confirm_payroll_accounting',
    'append_post_lock_payroll_correction',
    'lock_payroll_month',
  ]) {
    const body = functionBody(name);
    assert.match(body, /security definer/i, `${name} must be SECURITY DEFINER`);
    assert.match(body, /public\.private_require_payroll_operator\(\)/i, `${name} must require payroll operator`);
    assert.doesNotMatch(body, /current_user_has_role\('super_admin'\)/i);
    assert.doesNotMatch(body, /current_user_has_role\('ceo'\)/i);
  }
});

test('current payroll basis is rebuilt from persisted run and carryover applications on the server', () => {
  const body = functionBody('private_current_payroll_basis');
  assert.match(body, /public\.payroll_calculation_runs/i);
  assert.match(body, /public\.payroll_adjustments/i);
  assert.match(body, /public\.payroll_carryover_applications/i);
  assert.match(body, /pending_count/i);
  assert.match(body, /orphan_count/i);
  assert.match(body, /adjusted_gross/i);
  assert.match(body, /md5\(basis_payload::text\)/i);
  assert.match(body, /gross_pay_preview_status\s*=\s*'complete'/i);
  assert.match(body, /unresolved_item_count\s*=\s*0/i);
  assert.match(body, /rate_review_count\s*=\s*0/i);
});

test('carryover application is explicit, locked-source-only, current-run-only and idempotent', () => {
  const body = functionBody('apply_payroll_carryover');
  assert.match(body, /p_user_approved is not true/i);
  assert.match(body, /from public\.payroll_months[\s\S]*for update/i);
  assert.match(body, /target_month\.status = 'locked'/i);
  assert.match(body, /target_month\.latest_run_id <> p_expected_run_id/i);
  assert.match(body, /adjustment\.target_month <> target_month\.payroll_month/i);
  assert.match(body, /adjustment\.status not in \('reviewed','applied'\)/i);
  assert.match(body, /adjustment\.amount_status <> 'ready'/i);
  assert.match(body, /source_month\.status <> 'locked'/i);
  assert.match(body, /on conflict \(adjustment_id, applied_run_id\) do nothing/i);
  assert.match(body, /PAYROLL_CARRYOVER_IDEMPOTENCY_CONFLICT/i);
  assert.doesNotMatch(body, /update public\.payroll_adjustments/i);
});

test('accounting confirmation refuses stale caller basis and recomputes authoritative basis server-side', () => {
  const body = functionBody('confirm_payroll_accounting');
  assert.match(body, /p_user_confirmed is not true/i);
  assert.match(body, /from public\.payroll_months[\s\S]*for update/i);
  assert.match(body, /month_row\.latest_run_id <> p_expected_run_id/i);
  assert.match(body, /private_current_payroll_basis\(month_row\.id,month_row\.latest_run_id\)/i);
  assert.match(body, /pending_count/i);
  assert.match(body, /orphan_count/i);
  assert.match(body, /p_expected_basis_fingerprint <> current_fingerprint/i);
  assert.match(body, /p_expected_adjusted_gross is distinct from current_adjusted_gross/i);
  assert.match(body, /confirmed = true/i);
  assert.match(body, /stale = false/i);
});

test('post-lock correction appends a new reviewed adjustment and never rewrites locked source payroll', () => {
  const body = functionBody('append_post_lock_payroll_correction');
  assert.match(body, /p_user_approved is not true/i);
  assert.match(body, /source_month_row\.status <> 'locked'/i);
  assert.match(body, /target_month_row\.status = 'locked'/i);
  assert.match(body, /p_target_month <= p_source_month/i);
  assert.match(body, /difference_hours := p_after_hours - p_before_hours/i);
  assert.match(body, /difference_amount := round\(difference_hours \* p_source_hourly_rate,2\)/i);
  assert.match(body, /'post_lock'/i);
  assert.match(body, /'reviewed'/i);
  assert.match(body, /on conflict \(adjustment_key\) do nothing/i);
  assert.match(body, /PAYROLL_CORRECTION_IDEMPOTENCY_CONFLICT/i);
  assert.doesNotMatch(body, /update public\.payroll_months[\s\S]*source_month_row/i);
  assert.doesNotMatch(body, /update public\.payroll_calculation_runs/i);
});

test('month lock is an explicit atomic final gate that rechecks run, basis, accounting and carryover blockers', () => {
  const body = functionBody('lock_payroll_month');
  assert.match(body, /p_user_approved is not true/i);
  assert.match(body, /PAYROLL_LOCK_APPROVAL_NOTE_REQUIRED/i);
  assert.match(body, /from public\.payroll_months[\s\S]*for update/i);
  assert.match(body, /month_row\.latest_run_id <> p_expected_run_id/i);
  assert.match(body, /month_row\.unresolved_important_exceptions <> 0/i);
  assert.match(body, /run_row\.unresolved_item_count <> 0/i);
  assert.match(body, /run_row\.rate_review_count <> 0/i);
  assert.match(body, /run_row\.gross_pay_preview_status <> 'complete'/i);
  assert.match(body, /private_current_payroll_basis\(month_row\.id,month_row\.latest_run_id\)/i);
  assert.match(body, /p_expected_basis_fingerprint <> current_fingerprint/i);
  assert.match(body, /comparison\.confirmed is not true/i);
  assert.match(body, /comparison\.stale is true/i);
  assert.match(body, /comparison\.run_id <> month_row\.latest_run_id/i);
  assert.match(body, /comparison\.payroll_basis_fingerprint is distinct from current_fingerprint/i);
  assert.match(body, /a\.status = 'pending_next_month'/i);
  assert.match(body, /set status = 'locked'/i);
  assert.match(body, /locked_by = actor_id/i);
});

test('browser roles receive execute only on guarded mutation RPCs and no payroll table write grants', () => {
  assert.match(candidate, /grant execute on function public\.apply_payroll_carryover[\s\S]*to authenticated/i);
  assert.match(candidate, /grant execute on function public\.confirm_payroll_accounting[\s\S]*to authenticated/i);
  assert.match(candidate, /grant execute on function public\.append_post_lock_payroll_correction[\s\S]*to authenticated/i);
  assert.match(candidate, /grant execute on function public\.lock_payroll_month[\s\S]*to authenticated/i);
  assert.doesNotMatch(candidate, /grant\s+(?:select|insert|update|delete)\s+on\s+public\.payroll_/i);
  assert.doesNotMatch(candidate, /create\s+policy/i);
});

test('generic mutation audit avoids payroll amounts, employee names and Sensitive HR payloads', () => {
  const auditCalls = [...candidate.matchAll(/private_append_audit\([\s\S]*?\n\s*\);/gi)].map((match) => match[0]);
  assert.ok(auditCalls.length >= 4);
  for (const audit of auditCalls) {
    assert.doesNotMatch(audit, /gross_pay/i);
    assert.doesNotMatch(audit, /hourly_rate/i);
    assert.doesNotMatch(audit, /difference_amount/i);
    assert.doesNotMatch(audit, /display_name/i);
    assert.doesNotMatch(audit, /resident/i);
    assert.doesNotMatch(audit, /disability/i);
    assert.doesNotMatch(audit, /bank_/i);
  }
});

test('candidate contains no payment execution or privilege bypass', () => {
  assert.doesNotMatch(candidate, /create\s+role\s+payroll_operator/i);
  assert.doesNotMatch(candidate, /current_user_has_role\('super_admin'\)/i);
  assert.doesNotMatch(candidate, /service_role/i);
  assert.doesNotMatch(candidate, /bank_transfer/i);
  assert.doesNotMatch(candidate, /execute_payment/i);
});
