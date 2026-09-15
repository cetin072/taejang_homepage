const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260912033000_payroll_partial_relationship_statutory_guard.sql'),
  'utf8'
);

test('partial-month employment is withheld from automatic statutory profile input', () => {
  assert.match(migration, /e\.hired_on <= month_start/i);
  assert.match(migration, /e\.departed_on is null or e\.departed_on >= month_end/i);
  assert.doesNotMatch(migration, /e\.hired_on <= month_end/i);
  assert.doesNotMatch(migration, /e\.departed_on is null or e\.departed_on >= month_start/i);
});

test('guard stays server-only and does not introduce operator input', () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /revoke all on function public\.private_get_payroll_statutory_input\(date\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.private_get_payroll_statutory_input\(date\) to service_role/i);
  assert.doesNotMatch(migration, /insert into public\.payroll_statutory_profiles|update public\.payroll_statutory_profiles/i);
});
