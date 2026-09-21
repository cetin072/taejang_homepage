'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260921223000_issue_318_executive_payroll_subjects.sql'),
  'utf8'
);

test('Issue 318 registers final-ledger executive recipients as non-attendance monthly payroll employees', () => {
  assert.match(migration, /'이영희',date '2026-06-09',null,ceo_position_id,false/i);
  assert.match(migration, /'김형철',date '2026-06-09',null,executive_position_id,false/i);
  assert.match(migration, /'monthly'[\s\S]*3200000::numeric/i);
  assert.match(migration, /'monthly'[\s\S]*4500000::numeric/i);
  assert.match(migration, /attendance_required[\s\S]*pay_type='monthly'/i);
});

test('Issue 318 payroll input includes monthly employees even when attendance is not required', () => {
  assert.match(migration, /e\.attendance_required\s+or exists\(/i);
  assert.match(migration, /monthly_term\.pay_type='monthly'/i);
  assert.match(migration, /private_payroll_confirmed_attendance_readiness/i);
});

test('Issue 318 preserves August confirmed insurance defaults for both executives', () => {
  assert.match(migration, /이영희'[\s\S]*3200000::numeric,0::numeric,46730::numeric,6140::numeric,0::numeric,52870::numeric,3147130::numeric/i);
  assert.match(migration, /김형철'[\s\S]*4500000::numeric,213750::numeric,161770::numeric,21250::numeric,0::numeric,396770::numeric,4103230::numeric/i);
  assert.match(migration, /health_monthly_remuneration[\s\S]*1300000::numeric/i);
  assert.match(migration, /national_pension_deduction_override[\s\S]*health_insurance_deduction_override[\s\S]*employment_insurance_deduction_override/i);
});

test('Issue 318 keeps the uploaded final ledger as traceable source of truth', () => {
  assert.match(migration, /태장8월급여대장\.수정4명\.xlsx/);
  assert.match(migration, /e04f25e4876c36ca2b7f22790f66319bbd330ceaf4e90f1de9482d6f933cc42a/);
  assert.match(migration, /historical_reconciliation/);
  assert.match(migration, /payroll_ledger_confirmed/);
});
