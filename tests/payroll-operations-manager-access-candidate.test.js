const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const candidatePath = path.join(root, 'prototypes/payroll-backend/operations_manager_access_candidate.sql');
const candidate = fs.readFileSync(candidatePath, 'utf8');

test('approved payroll candidate authorizes only active operations_manager accounts', () => {
  assert.match(candidate, /current_profile_is_active\(\)[\s\S]*current_user_has_role\('operations_manager'\)/i);
  assert.doesNotMatch(candidate, /current_user_has_role\('super_admin'\)/i);
  assert.doesNotMatch(candidate, /current_user_has_role\('ceo'\)/i);
  assert.doesNotMatch(candidate, /create\s+role\s+payroll_operator/i);
});

test('candidate keeps payroll tables fail-closed and exposes only a guarded RPC to authenticated', () => {
  assert.match(candidate, /revoke all on[\s\S]*public\.payroll_months[\s\S]*from public, anon, authenticated/i);
  assert.match(candidate, /revoke all on function public\.get_payroll_operator_month_context\(date\) from public, anon, authenticated/i);
  assert.match(candidate, /grant execute on function public\.get_payroll_operator_month_context\(date\) to authenticated/i);
  assert.doesNotMatch(candidate, /grant\s+(?:select|insert|update|delete)\s+on\s+public\.payroll_/i);
  assert.doesNotMatch(candidate, /create\s+policy/i);
});

test('read RPC rejects invalid months and unauthorized callers inside the server boundary', () => {
  assert.match(candidate, /INVALID_PAYROLL_MONTH/);
  assert.match(candidate, /not public\.private_payroll_operator_allowed\(\)/i);
  assert.match(candidate, /PAYROLL_ACCESS_FORBIDDEN/);
  assert.match(candidate, /PAYROLL_LATEST_RUN_INTEGRITY_ERROR/);
});

test('authorized read model resolves names transiently without joining sensitive HR sources', () => {
  assert.match(candidate, /join public\.employees e on e\.id=r\.employee_uuid/i);
  assert.match(candidate, /join public\.people p on p\.id=e\.person_id/i);
  assert.match(candidate, /'display_name',p\.full_name/i);
  assert.doesNotMatch(candidate, /employee_photos/i);
  assert.doesNotMatch(candidate, /resident[_-]?registration/i);
  assert.doesNotMatch(candidate, /disability/i);
  assert.doesNotMatch(candidate, /bank[_-]?(?:account|number)/i);
  assert.doesNotMatch(candidate, /consultation/i);
});

test('generic payroll access audit contains identifiers and operation facts, not payroll amounts or employee names', () => {
  assert.match(candidate, /payroll_month_viewed/);
  assert.match(candidate, /jsonb_build_object\([\s\S]*'payroll_month',p_payroll_month[\s\S]*'run_id',month_row\.latest_run_id[\s\S]*\)/i);

  const auditTail = candidate.slice(candidate.indexOf('-- Generic audit intentionally'));
  assert.doesNotMatch(auditTail, /gross_pay_preview/);
  assert.doesNotMatch(auditTail, /hourly_rate/);
  assert.doesNotMatch(auditTail, /display_name/);
  assert.doesNotMatch(auditTail, /deduction/i);
});

test('candidate remains rollback-only outside real Supabase migrations', () => {
  assert.match(candidate, /Status: CANDIDATE ONLY/i);
  assert.match(candidate.trim(), /rollback;$/i);
  assert.equal(
    fs.existsSync(path.join(root, 'supabase/migrations/operations_manager_access_candidate.sql')),
    false,
    'candidate must not be promoted into executable migrations'
  );
});

test('state-changing payroll RPCs remain absent until transaction tests are implemented', () => {
  assert.match(candidate, /any state-changing payroll RPC/i);
  assert.doesNotMatch(candidate, /create or replace function public\.lock_payroll_month/i);
  assert.doesNotMatch(candidate, /create or replace function public\.apply_payroll_carryover/i);
  assert.doesNotMatch(candidate, /create or replace function public\.confirm_payroll_accounting/i);
});
