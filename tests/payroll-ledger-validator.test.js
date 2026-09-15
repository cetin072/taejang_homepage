const test = require('node:test');
const assert = require('node:assert/strict');

const validator = require('../app/assets/payroll-ledger-validator.js');

function employee(overrides = {}) {
  return {
    employee_uuid: 'uuid-1',
    employee_id: 'T001',
    rate_status: 'single_rate',
    actual_work_hours: 72,
    unresolved_count: 0,
    gross_pay_preview: 900000,
    statutory_deduction_preview: 80000,
    net_pay_preview: 820000,
    statutory_status: 'complete',
    attendance_days: { '2026-08-03': { hours: 3 } },
    ...overrides,
  };
}

test('valid payroll ledger passes arithmetic and uniqueness checks', () => {
  const result = validator.validatePayrollLedgerContext({
    latest_run: { employee_count: 1 },
    employees: [employee()],
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.errorCount, 0);
  assert.equal(result.warningCount, 0);
  assert.match(validator.summaryText(result), /검증 정상/);
});

test('ledger detects duplicate employees and net-pay arithmetic mismatch', () => {
  const result = validator.validatePayrollLedgerContext({
    latest_run: { employee_count: 2 },
    employees: [
      employee(),
      employee({ employee_uuid: 'uuid-2', net_pay_preview: 810000 }),
    ],
  });
  assert.equal(result.status, 'error');
  assert.ok(result.issues.some(item => item.code === 'employee_id_duplicate'));
  assert.ok(result.issues.some(item => item.code === 'net_pay_arithmetic_mismatch'));
});

test('ledger detects calculation-run employee count mismatch', () => {
  const result = validator.validatePayrollLedgerContext({
    latest_run: { employee_count: 23 },
    employees: [employee()],
  });
  assert.equal(result.status, 'error');
  assert.ok(result.issues.some(item => item.code === 'employee_count_mismatch'));
});

test('monthly salary row does not require attendance detail or hourly rate', () => {
  const result = validator.validatePayrollLedgerContext({
    latest_run: { employee_count: 1 },
    employees: [employee({
      rate_status: 'monthly_salary',
      actual_work_hours: 0,
      attendance_days: {},
      gross_pay_preview: 3900000,
      statutory_deduction_preview: 0,
      net_pay_preview: 3900000,
    })],
  });
  assert.equal(result.status, 'ok');
});

test('hourly employee with worked hours but no attendance detail raises a warning', () => {
  const result = validator.validatePayrollLedgerContext({
    latest_run: { employee_count: 1 },
    employees: [employee({ attendance_days: {} })],
  });
  assert.equal(result.status, 'review');
  assert.ok(result.issues.some(item => item.code === 'attendance_detail_missing_for_hourly_employee'));
});
