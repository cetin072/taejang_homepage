const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260911140500_payroll_statutory_profile_history.sql'),
  'utf8'
);

test('statutory rate rules are effective-dated configuration, not payroll JS constants', () => {
  assert.match(migration, /create table if not exists public\.payroll_statutory_rate_rules/i);
  assert.match(migration, /effective_from date not null/i);
  assert.match(migration, /unique \(rate_code, effective_from\)/i);
  assert.match(migration, /national_pension[\s\S]*0\.0475/i);
  assert.match(migration, /health_insurance[\s\S]*0\.03595/i);
  assert.match(migration, /long_term_care[\s\S]*0\.009448[\s\S]*0\.0719/i);
  assert.match(migration, /employment_insurance[\s\S]*0\.009/i);
});

test('employee statutory profile preserves effective-dated insurance eligibility and tax inputs', () => {
  assert.match(migration, /create table if not exists public\.payroll_statutory_profiles/i);
  assert.match(migration, /livelihood_recipient_status/i);
  assert.match(migration, /national_pension_status/i);
  assert.match(migration, /pension_standard_monthly_income/i);
  assert.match(migration, /health_monthly_remuneration/i);
  assert.match(migration, /tax_dependent_count/i);
  assert.match(migration, /withholding_rate_percent/i);
});

test('confirmed 6-8 month deductions can be imported as Golden history', () => {
  assert.match(migration, /create table if not exists public\.payroll_confirmed_deduction_history/i);
  assert.match(migration, /national_pension_employee/i);
  assert.match(migration, /health_insurance_employee/i);
  assert.match(migration, /long_term_care_employee/i);
  assert.match(migration, /employment_insurance_employee/i);
  assert.match(migration, /income_tax/i);
  assert.match(migration, /local_income_tax/i);
  assert.match(migration, /net_pay/i);
  assert.match(migration, /tax_office_confirmed/i);
});

test('sensitive statutory tables are fail-closed to browser roles', () => {
  assert.match(migration, /alter table public\.payroll_statutory_profiles enable row level security/i);
  assert.match(migration, /alter table public\.payroll_confirmed_deduction_history enable row level security/i);
  assert.match(migration, /revoke all on[\s\S]*public\.payroll_statutory_profiles[\s\S]*public\.payroll_confirmed_deduction_history[\s\S]*from public, anon, authenticated/i);
});

test('raw resident registration number is deliberately outside this table', () => {
  assert.doesNotMatch(migration, /resident_registration_number|rrn_plaintext|jumin_number/i);
  assert.match(migration, /Raw resident registration numbers are NOT stored here/i);
});
