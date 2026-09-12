const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260912000429_payroll_statutory_service_input.sql'),
  'utf8'
);

test('statutory payroll input is a server-only security-definer RPC', () => {
  assert.match(migration, /create or replace function public\.private_get_payroll_statutory_input/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /revoke all on function public\.private_get_payroll_statutory_input\(date\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.private_get_payroll_statutory_input\(date\) to service_role/i);
});

test('statutory input exposes calculation fields but excludes direct identity and sensitive HR detail', () => {
  assert.match(migration, /national_pension_status/i);
  assert.match(migration, /pension_standard_monthly_income/i);
  assert.match(migration, /health_monthly_remuneration/i);
  assert.match(migration, /rounding_method/i);
  assert.doesNotMatch(migration, /resident_registration_number|rrn_plaintext|bank_account|disability_detail|tax_dependent_count|livelihood_recipient_status/i);
});

test('statutory input is effective-dated for both rate rules and employee profiles', () => {
  assert.match(migration, /r\.effective_from <= month_end/i);
  assert.match(migration, /r\.effective_to is null or r\.effective_to >= month_start/i);
  assert.match(migration, /p\.effective_from <= month_end/i);
  assert.match(migration, /p\.effective_to is null or p\.effective_to >= month_start/i);
});
