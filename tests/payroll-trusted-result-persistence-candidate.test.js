const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const candidatePath = path.join(root, 'prototypes/payroll-backend/trusted_result_persistence_candidate.sql');
const candidate = fs.readFileSync(candidatePath, 'utf8');
const executableSql = candidate
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

test('trusted result persistence candidate is rollback-only and browser-inaccessible', () => {
  assert.match(candidate, /Status: CANDIDATE ONLY\. ROLLBACK-ONLY/i);
  assert.match(candidate.trim(), /rollback;$/i);
  assert.match(candidate, /revoke all on function public\.private_persist_payroll_calculation/i);
  assert.doesNotMatch(executableSql, /grant\s+execute\s+on\s+function\s+public\.private_persist_payroll_calculation[\s\S]*authenticated/i);
  assert.doesNotMatch(executableSql, /grant\s+execute\s+on\s+function\s+public\.private_persist_payroll_calculation[\s\S]*anon/i);
  assert.doesNotMatch(executableSql, /grant\s+execute\s+on\s+function\s+public\.private_persist_payroll_calculation[\s\S]*public/i);
});

test('internal persistence revalidates original active operations_manager actor', () => {
  assert.match(candidate, /create or replace function public\.private_payroll_actor_allowed\(p_actor_id uuid\)/i);
  assert.match(candidate, /from public\.profiles p[\s\S]*join public\.profile_roles pr[\s\S]*join public\.roles r/i);
  assert.match(candidate, /p\.account_status = 'active'/i);
  assert.match(candidate, /pr\.revoked_at is null/i);
  assert.match(candidate, /r\.active/i);
  assert.match(candidate, /r\.code = 'operations_manager'/i);
  assert.doesNotMatch(candidate, /r\.code = 'super_admin'/i);
  assert.match(candidate, /PAYROLL_INTERNAL_ACTOR_FORBIDDEN/i);
});

test('month row is locked before canonical input is rebuilt and stale calculation is rejected', () => {
  const lockIndex = candidate.indexOf('for update;');
  const rebuildIndex = candidate.indexOf('private_build_payroll_calculation_input');
  assert.ok(lockIndex >= 0 && rebuildIndex > lockIndex, 'month must be locked before input is rebuilt');
  assert.match(candidate, /current_input_fingerprint := canonical_input ->> 'input_basis_fingerprint'/i);
  assert.match(candidate, /p_expected_input_basis_fingerprint <> current_input_fingerprint/i);
  assert.match(candidate, /PAYROLL_CALCULATION_INPUT_STALE/i);
  assert.match(candidate, /PAYROLL_MONTH_LOCKED/i);
});

test('complete aggregate cannot contain unresolved or rate-review facts and review totals stay hidden', () => {
  assert.match(candidate, /p_gross_pay_preview_status = 'complete'[\s\S]*p_gross_pay_preview is null[\s\S]*p_unresolved_item_count <> 0[\s\S]*p_rate_review_count <> 0/i);
  assert.match(candidate, /PAYROLL_COMPLETE_RESULT_INCONSISTENT/i);
  assert.match(candidate, /p_gross_pay_preview_status = 'review_required' and p_gross_pay_preview is not null/i);
  assert.match(candidate, /PAYROLL_REVIEW_TOTAL_MUST_BE_WITHHELD/i);
});

test('employee results are count-consistent, unique and limited to canonical employee UUIDs', () => {
  assert.match(candidate, /jsonb_array_length\(p_employee_results\)/i);
  assert.match(candidate, /PAYROLL_EMPLOYEE_RESULT_COUNT_MISMATCH/i);
  assert.match(candidate, /count\(distinct \(item ->> 'employee_uuid'\)\)/i);
  assert.match(candidate, /PAYROLL_DUPLICATE_EMPLOYEE_RESULT/i);
  assert.match(candidate, /jsonb_array_elements\(canonical_input -> 'employees'\)/i);
  assert.match(candidate, /PAYROLL_RESULT_EMPLOYEE_NOT_CANONICAL/i);
});

test('employee result object rejects unknown fields and sensitive calculation detail', () => {
  assert.match(candidate, /UNKNOWN_PAYROLL_EMPLOYEE_RESULT_FIELD/i);
  assert.match(candidate, /calculation_detail/i);
  assert.match(candidate, /UNSAFE_PAYROLL_CALCULATION_DETAIL/i);
  assert.match(candidate, /display\[_-\]\?name|full\[_-\]\?name|resident|registration|disability|health|consultation|bank|clock/i);
});

test('same calculation identity reuses a run only when persisted aggregate is identical', () => {
  assert.match(candidate, /payroll_month_id = month_row\.id[\s\S]*calculation_version = p_calculation_version[\s\S]*input_fingerprint = current_input_fingerprint[\s\S]*cutoff_date = p_cutoff_date/i);
  assert.match(candidate, /PAYROLL_CALCULATION_IDEMPOTENCY_CONFLICT/i);
  assert.match(candidate, /reused := true/i);
  assert.match(candidate, /PAYROLL_REUSED_RUN_RESULT_INTEGRITY_ERROR/i);
});

test('new run persists run, employee rows and latest pointer in one protected function transaction', () => {
  assert.match(candidate, /insert into public\.payroll_calculation_runs/i);
  assert.match(candidate, /insert into public\.payroll_employee_results/i);
  assert.match(candidate, /update public\.payroll_months[\s\S]*latest_run_id=run_row\.id/i);
  assert.match(candidate, /update public\.payroll_accounting_comparisons[\s\S]*stale=true[\s\S]*latest_run_changed/i);
});

test('generic persistence audit excludes payroll values and employee identities', () => {
  const auditCalls = [...candidate.matchAll(/private_append_audit\([\s\S]*?\n\s*\);/gi)].map((m) => m[0]);
  assert.equal(auditCalls.length, 1);
  const audit = auditCalls[0];
  assert.match(audit, /payroll_calculation_persisted/i);
  assert.match(audit, /run_id/i);
  assert.match(audit, /employee_count/i);
  assert.doesNotMatch(audit, /gross_pay_preview/i);
  assert.doesNotMatch(audit, /hourly_rate/i);
  assert.doesNotMatch(audit, /display_name/i);
  assert.doesNotMatch(audit, /employee_uuid/i);
});

test('candidate includes no payment execution, bank fields or broad direct table grants', () => {
  assert.doesNotMatch(executableSql, /bank_(?:account|number)/i);
  assert.doesNotMatch(executableSql, /resident[_-]?registration/i);
  assert.doesNotMatch(executableSql, /grant\s+(?:select|insert|update|delete)\s+on\s+public\.payroll_/i);
  assert.doesNotMatch(executableSql, /transfer[_-]?payment/i);
});