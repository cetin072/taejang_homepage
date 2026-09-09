const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const candidatePath = path.join(root, 'prototypes/payroll-backend/outgoing_adjustment_review_candidate.sql');
const candidate = fs.readFileSync(candidatePath, 'utf8');

test('outgoing adjustment review candidate is rollback-only and guarded by payroll operator approval', () => {
  assert.match(candidate, /Status: CANDIDATE ONLY\. ROLLBACK-ONLY/i);
  assert.match(candidate.trim(), /rollback;$/i);
  assert.match(candidate, /private_require_payroll_operator\(\)/i);
  assert.match(candidate, /p_user_approved is not true/i);
  assert.match(candidate, /PAYROLL_ADJUSTMENT_REVIEW_APPROVAL_REQUIRED/i);
});

test('only pending cutoff-reconciliation adjustments are reviewable', () => {
  assert.match(candidate, /adjustment\.status <> 'pending_next_month'/i);
  assert.match(candidate, /PAYROLL_ADJUSTMENT_NOT_REVIEWABLE/i);
  assert.match(candidate, /adjustment\.correction_kind <> 'cutoff_reconciliation'/i);
  assert.match(candidate, /PAYROLL_POST_LOCK_ADJUSTMENT_ALREADY_REVIEWED/i);
});

test('stale expected status is rejected before mutation', () => {
  assert.match(candidate, /adjustment\.status <> p_expected_status/i);
  assert.match(candidate, /PAYROLL_ADJUSTMENT_STATUS_STALE/i);
  assert.match(candidate, /for update/i);
});

test('reviewed decision requires a ready authoritative amount', () => {
  assert.match(candidate, /p_decision='reviewed'/i);
  assert.match(candidate, /adjustment\.amount_status <> 'ready'/i);
  assert.match(candidate, /adjustment\.source_hourly_rate is null/i);
  assert.match(candidate, /adjustment\.difference_amount is null/i);
  assert.match(candidate, /PAYROLL_ADJUSTMENT_AMOUNT_REVIEW_REQUIRED/i);
});

test('cancellation requires a human reason and cannot happen after application', () => {
  assert.match(candidate, /PAYROLL_ADJUSTMENT_CANCELLATION_REASON_REQUIRED/i);
  assert.match(candidate, /from public\.payroll_carryover_applications ca[\s\S]*ca\.adjustment_id=adjustment\.id/i);
  assert.match(candidate, /PAYROLL_APPLIED_ADJUSTMENT_IMMUTABLE/i);
});

test('source and target month state prevent review from rewriting locked payroll state', () => {
  assert.match(candidate, /source_month\.status='locked'/i);
  assert.match(candidate, /PAYROLL_SOURCE_MONTH_ALREADY_LOCKED/i);
  assert.match(candidate, /target_month\.status='locked'/i);
  assert.match(candidate, /PAYROLL_TARGET_MONTH_ALREADY_LOCKED/i);
});

test('review changes only adjustment review fields, not amount or work-hour facts', () => {
  const updateBlocks = [...candidate.matchAll(/update public\.payroll_adjustments[\s\S]*?where id=adjustment\.id;/gi)].map((m) => m[0]);
  assert.equal(updateBlocks.length, 2);
  for (const block of updateBlocks) {
    assert.doesNotMatch(block, /difference_amount\s*=/i);
    assert.doesNotMatch(block, /difference_hours\s*=/i);
    assert.doesNotMatch(block, /source_hourly_rate\s*=/i);
    assert.doesNotMatch(block, /before_hours\s*=/i);
    assert.doesNotMatch(block, /after_hours\s*=/i);
  }
});

test('generic review audit records identifiers and decision without payroll amounts', () => {
  const auditCalls = [...candidate.matchAll(/private_append_audit\([\s\S]*?\n\s*\);/gi)].map((m) => m[0]);
  assert.equal(auditCalls.length, 1);
  const audit = auditCalls[0];
  assert.match(audit, /adjustment_id/i);
  assert.match(audit, /source_month/i);
  assert.match(audit, /target_month/i);
  assert.match(audit, /decision/i);
  assert.doesNotMatch(audit, /difference_amount/i);
  assert.doesNotMatch(audit, /source_hourly_rate/i);
  assert.doesNotMatch(audit, /employee_uuid/i);
});