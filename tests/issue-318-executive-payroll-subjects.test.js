'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const payrollCore = require('../supabase/functions/payroll-calculate/runtime/payroll-calculate-core.js');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260921223000_issue_318_executive_payroll_subjects.sql'),
  'utf8'
);
const monthlyPersistence = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260921224500_issue_318_monthly_salary_persistence.sql'),
  'utf8'
);
const runSchemaReconcile = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260921225000_issue_318_statutory_run_schema_reconcile.sql'),
  'utf8'
);
const legacyMonthlyPersistence = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260921225500_issue_318_legacy_monthly_persistence.sql'),
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


test('non-attendance monthly executive calculates full monthly salary without attendance rows', () => {
  const result = payrollCore.calculateMonthlySalaryResult({
    employee: {
      employeeId: 'TJ-EXEC',
      hiredAt: '2026-06-09',
      terminatedAt: null,
    },
    year: 2026,
    month: 8,
    terms: [{
      employeeId: 'TJ-EXEC',
      effectiveFrom: '2026-06-09',
      effectiveTo: null,
      payType: 'monthly',
      monthlySalary: 3200000,
    }],
    attendanceRecords: [],
  });

  assert.equal(result.rateStatus, 'monthly_salary');
  assert.equal(result.grossPayPreview, 3200000);
  assert.equal(result.unresolvedCount, 0);
  assert.equal(result.actualWorkHours, 0);
});


test('trusted persistence accepts monthly salary results and keeps review rows fail-closed', () => {
  assert.match(monthlyPersistence, /'monthly_salary'/);
  assert.match(monthlyPersistence, /'monthly_salary_review_required'/);
  assert.match(monthlyPersistence, /rate_status in \('single_rate','monthly_salary'\)/i);
  assert.match(monthlyPersistence, /gross_pay_preview is null[\s\S]*rate_status in \('single_rate','monthly_salary'\)/i);
});


test('statutory run fingerprint column exists on clean databases before linted persistence use', () => {
  assert.match(runSchemaReconcile, /add column if not exists statutory_input_fingerprint text/i);
  assert.match(runSchemaReconcile, /payroll_calculation_runs_statutory_input_fingerprint_check/i);
});


test('legacy service-role persistence overload accepts monthly salary too', () => {
  assert.match(legacyMonthlyPersistence, /'monthly_salary'/);
  assert.match(legacyMonthlyPersistence, /'monthly_salary_review_required'/);
  assert.match(legacyMonthlyPersistence, /grant execute on function public\.private_persist_payroll_calculation/i);
  assert.match(legacyMonthlyPersistence, /to service_role/i);
  assert.match(legacyMonthlyPersistence, /from public,anon,authenticated/i);
});
