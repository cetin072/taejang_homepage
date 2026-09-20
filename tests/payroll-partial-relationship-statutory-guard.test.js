const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260921013000_issue_303_2026_statutory_july.sql'),
  'utf8'
);

test('partial-month employment reaches the statutory engine for per-insurance acquisition rules', () => {
  assert.match(migration, /e\.hired_on<=month_end/i);
  assert.match(migration, /e\.departed_on is null or e\.departed_on>=month_start/i);
  assert.doesNotMatch(migration, /e\.hired_on<=month_start/i);
  assert.doesNotMatch(migration, /e\.departed_on is null or e\.departed_on>=month_end/i);
});

test('historical statutory coverage uses reconciled facts without converting pending statuses', () => {
  assert.match(migration, /from public\.payroll_statutory_profiles p/i);
  assert.match(migration, /where p\.effective_from=date '2026-09-01'/i);
  assert.match(migration, /p\.national_pension_status/i);
  assert.match(migration, /p\.health_insurance_status/i);
  assert.match(migration, /p\.employment_insurance_status/i);
  assert.doesNotMatch(migration, /pending_review'\s*then\s*'enrolled/i);
});

test('server-only statutory input remains inaccessible to browser roles', () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path=''/i);
  assert.match(migration, /revoke all on function public\.private_get_payroll_statutory_input\(date\)/i);
  assert.match(migration, /grant execute on function public\.private_get_payroll_statutory_input\(date\)\s*to service_role/i);
});
