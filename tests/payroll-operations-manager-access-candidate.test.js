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

test('read model exposes the server-generated payroll basis used by accounting and lock commands', () => {
  assert.match(candidate, /basis_json := public\.private_current_payroll_basis\(month_row\.id,run_row\.id\)/i);
  assert.match(candidate, /'payroll_basis',basis_json/i);
  assert.match(candidate, /'payroll_basis',null/i);
  assert.match(candidate, /'payroll_basis_fingerprint',c\.payroll_basis_fingerprint/i);
  assert.match(candidate, /'adjusted_gross_basis',c\.adjusted_gross_basis/i);
});

test('generic payroll access audit contains identifiers and operation facts, not payroll amounts or employee names', () => {
  assert.match(candidate, /payroll_month_viewed/);
  const auditCalls = [...candidate.matchAll(/perform public\.private_append_audit\([\s\S]*?\n\s*\);/gi)].map((match) => match[0]);
  assert.ok(auditCalls.length >= 2, 'candidate should audit both denied and successful payroll access');

  for (const auditCall of auditCalls) {
    assert.doesNotMatch(auditCall, /gross_pay_preview/);
    assert.doesNotMatch(auditCall, /hourly_rate/);
    assert.doesNotMatch(auditCall, /display_name/);
    assert.doesNotMatch(auditCall, /deduction/i);
  }
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

test('state-changing payroll RPC definitions remain outside the read-access candidate', () => {
  assert.match(candidate, /any state-changing payroll RPC definition/i);
  assert.doesNotMatch(candidate, /create or replace function public\.lock_payroll_month/i);
  assert.doesNotMatch(candidate, /create or replace function public\.apply_payroll_carryover/i);
  assert.doesNotMatch(candidate, /create or replace function public\.confirm_payroll_accounting/i);
});
