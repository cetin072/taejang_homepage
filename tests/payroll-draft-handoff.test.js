const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const sql = read('supabase/migrations/20260918090350_payroll_draft_handoff.sql');
const nav = read('app/assets/role-navigation-priority.js');
const page = read('app/payroll/handoff.html');
const contract = read('docs/planning/PAYROLL_DRAFT_HANDOFF_CONTRACT_V1.md');

test('approved contract uses external payroll draft identity as authoritative handoff source', () => {
  assert.match(sql, /external_draft_id/i);
  assert.match(sql, /external_draft_revision/i);
  assert.match(sql, /payroll_period/i);
  assert.match(sql, /source_fingerprint/i);
  assert.match(sql, /source_generated_at|generated_at/i);
  assert.match(sql, /confirmed_attendance_ref/i);
  assert.match(sql, /confirmed_attendance_version/i);
  assert.match(sql, /employee_count/i);
  assert.match(sql, /gross[^\n,]*(summary|amount)|(summary|amount)[^\n,]*gross/i);
  assert.match(sql, /(unresolved|review_required|exception)_?count/i);

  assert.doesNotMatch(sql, /calculation_run_id\s+uuid\s+not\s+null/i);
  assert.match(contract, /외부 급여초안.*authoritative|authoritative.*외부 급여초안/i);
  assert.match(contract, /internal calculation run.*optional|optional.*internal calculation run/i);
});

test('approved six-state workflow is preserved exactly and includes rejection', () => {
  for (const state of ['draft', 'lead_review', 'submitted', 'changes_requested', 'rejected', 'approved']) {
    assert.match(sql, new RegExp("['\"]" + state + "['\"]", 'i'));
  }
  assert.doesNotMatch(sql, /submitted_to_operations|operations_approved/i);
});

test('duplicate and revision semantics are keyed by external draft revision', () => {
  assert.match(sql, /external_draft_id/i);
  assert.match(sql, /external_draft_revision/i);
  assert.match(sql, /unique[\s\S]{0,400}payroll_period[\s\S]{0,400}external_draft_id[\s\S]{0,400}external_draft_revision|unique index[\s\S]{0,400}payroll_period[\s\S]{0,400}external_draft_id[\s\S]{0,400}external_draft_revision/i);

  assert.match(contract, /changes_requested[\s\S]*revision.*반드시 증가/i);
  assert.match(contract, /rejected[\s\S]*동일 revision.*terminal/i);
});

test('handoff review is restricted to actual operations managers after the approved role change', () => {
  const migration = read('supabase/migrations/20261016033659_lead_compensation_access_denial.sql');
  const reviewerHelper = migration.match(/create or replace function public\.private_payroll_handoff_reviewer_allowed\(\)[\s\S]*?\$\$;/i)?.[0] || '';
  assert.doesNotMatch(reviewerHelper, /promotion_lead/i);
  assert.match(reviewerHelper, /operations_manager/i);
  assert.match(reviewerHelper, /private_actual_role_codes/);
  assert.match(reviewerHelper, /private_actor_can\('payroll.handoff.review'\)/);
  assert.match(migration, /delete from public.role_capability_grants/);
  assert.doesNotMatch(migration, /(?:update|delete from) public\.(?:payroll_|employees|profiles|audit)/);
  assert.match(sql, /payroll\.handoff\.approve/i);
});

test('audit contract records explicit state transition and external draft identity', () => {
  assert.match(sql, /from_state/i);
  assert.match(sql, /to_state/i);
  assert.match(sql, /external_draft_id/i);
  assert.match(sql, /external_draft_revision/i);
  assert.match(sql, /reason|note/i);

  const auditCalls = [...sql.matchAll(/perform public\.private_append_audit\([\s\S]*?\n\s*\);/gi)].map(match => match[0]);
  assert.ok(auditCalls.length >= 4);
  for (const call of auditCalls) {
    assert.doesNotMatch(call, /employee_uuid|resident|bank_account|disability|health/i);
  }
});

test('retired handoff URL is inert and navigation cannot restore the removed feature', () => {
  assert.match(page, /외부 급여 초안 기능이 종료되었습니다/);
  assert.match(page, /href="\.\.\/"/);
  assert.doesNotMatch(page, /<script|<form|<button|payroll-draft-handoff/);
  for (const file of ['role-navigation-priority.js', 'dashboard-shell.js', 'platform-navigation-registry.js', 'capability-ui-gates.js']) {
    assert.doesNotMatch(read('app/assets/' + file), /payroll\.handoff|payroll\/handoff|외부 급여초안/);
  }
  for (const extension of ['js', 'css']) {
    assert.equal(fs.existsSync(path.join(root, 'app/assets/payroll-draft-handoff.' + extension)), false);
  }
});

test('separate payroll project has a protected pull/read decision contract', () => {
  assert.match(sql, /external_draft_id/i);
  assert.match(sql, /external_draft_revision/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /approved|changes_requested|rejected/i);

  assert.match(sql, /create or replace function public\.[a-z0-9_]*(decision|result|status)[a-z0-9_]*\(/i);
  assert.match(sql, /grant execute on function public\.[a-z0-9_]*(decision|result|status)[a-z0-9_]*\([^;]*\) to authenticated/i);
});

test('approval is non-payment and cannot lock/finalize payroll', () => {
  assert.doesNotMatch(sql, /update public\.payroll_months[\s\S]{0,500}status\s*=\s*'locked'/i);
  assert.doesNotMatch(sql, /\b(?:send_payment|execute_payment|bank_transfer|payroll_lock)\s*\(/i);
  assert.match(contract, /approved.*실제 송금|실제 송금.*approved/i);
});
