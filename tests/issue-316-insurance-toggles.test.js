'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260921102000_issue_316_simple_insurance_toggles.sql'),
  'utf8'
);
const employeeUi = fs.readFileSync(
  path.join(root, 'app/assets/employee-management.js'),
  'utf8'
);
const statutory = fs.readFileSync(
  path.join(root, 'app/assets/payroll-statutory-deductions.js'),
  'utf8'
);
const edgeStatutory = fs.readFileSync(
  path.join(root, 'supabase/functions/payroll-calculate/runtime/payroll-statutory-deductions.js'),
  'utf8'
);

test('Issue 316 adds effective-dated per-employee deduction overrides', () => {
  assert.match(migration, /national_pension_deduction_override boolean/i);
  assert.match(migration, /health_insurance_deduction_override boolean/i);
  assert.match(migration, /employment_insurance_deduction_override boolean/i);
  assert.match(migration, /effective_to=effective_start-1/i);
  assert.match(migration, /operator-toggle:/i);
});

test('Issue 316 exposes guarded operations-manager read/write RPCs instead of browser table access', () => {
  assert.match(migration, /create or replace function public\.get_employee_insurance_deduction_settings/i);
  assert.match(migration, /create or replace function public\.set_employee_insurance_deduction_settings/i);
  assert.match(migration, /not public\.private_payroll_operator_allowed\(\)/i);
  assert.match(migration, /grant execute on function public\.set_employee_insurance_deduction_settings/i);
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete|all)\s+on\s+public\.payroll_statutory_profiles\s+to\s+authenticated/i);
});

test('Issue 316 feeds toggles into the existing server-only statutory RPC without changing its signature', () => {
  assert.match(migration, /create or replace function public\\.private_get_payroll_statutory_input\s*\(\s*p_payroll_month date/i);
  assert.doesNotMatch(migration, /rename to private_get_payroll_statutory_input_pre316/i);
  assert.match(migration, /national_pension_deduction_override/i);
  assert.match(migration, /health_insurance_deduction_override/i);
  assert.match(migration, /employment_insurance_deduction_override/i);
});

test('operator UI stays simple: month plus pension, health and employment ON/OFF only', () => {
  assert.match(employeeUi, /4대보험 급여공제 ON\/OFF/);
  assert.match(employeeUi, /국민연금/);
  assert.match(employeeUi, /건강보험/);
  assert.match(employeeUi, /고용보험/);
  assert.match(employeeUi, /산재보험은 회사 부담 항목이라 근로자 급여에서 공제하지 않습니다/);
  assert.match(employeeUi, /노무사가 알려준 적용 여부를 그대로 입력합니다/);
  assert.match(employeeUi, /get_employee_insurance_deduction_settings/);
  assert.match(employeeUi, /set_employee_insurance_deduction_settings/);
  assert.doesNotMatch(employeeUi, /의료급여수급자.*생계급여|생계급여.*의료급여수급자/);
});

test('explicit switches are authoritative while legacy profiles keep the prior age/eligibility path', () => {
  assert.match(statutory, /hasNationalPensionOverride/);
  assert.match(statutory, /hasHealthInsuranceOverride/);
  assert.match(statutory, /hasEmploymentInsuranceOverride/);
  assert.match(statutory, /taxableRemuneration/);
  assert.equal(statutory, edgeStatutory);
});
