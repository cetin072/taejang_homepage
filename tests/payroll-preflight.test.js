const test = require('node:test');
const assert = require('node:assert/strict');

const preflight = require('../app/assets/payroll-preflight.js');

function employee(overrides = {}) {
  return {
    employeeId: 'TJ-TEST-0001',
    hiredAt: '2026-06-09',
    terminatedAt: null,
    ...overrides,
  };
}

function term(overrides = {}) {
  return {
    employeeId: 'TJ-TEST-0001',
    effectiveFrom: '2026-06-09',
    effectiveTo: null,
    dailyScheduledHours: 3,
    hourlyRate: 10320,
    ...overrides,
  };
}

test('clean payroll inputs pass preflight', () => {
  const result = preflight.validatePayrollInput({
    employees: [employee()],
    terms: [term()],
    attendanceRecords: [
      { sourceKey: 'SRC-1', employeeId: 'TJ-TEST-0001', date: '2026-09-01', autoDecision: '기록완전' },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.calculationAllowed, true);
  assert.equal(result.issueCount, 0);
});

test('duplicate employee/day attendance fails closed before last-write-wins can occur', () => {
  const result = preflight.validatePayrollInput({
    employees: [employee()],
    terms: [term()],
    attendanceRecords: [
      { sourceKey: 'SRC-1', employeeId: 'TJ-TEST-0001', date: '2026-09-01' },
      { sourceKey: 'SRC-2', employeeId: 'TJ-TEST-0001', date: '2026-09-01' },
    ],
  });

  assert.equal(result.calculationAllowed, false);
  assert.ok(result.issues.some((item) => item.code === 'attendance_day_duplicate'));
});

test('duplicate source key is a critical import/audit issue', () => {
  const result = preflight.validatePayrollInput({
    employees: [employee()],
    terms: [term()],
    attendanceRecords: [
      { sourceKey: 'SRC-DUP', employeeId: 'TJ-TEST-0001', date: '2026-09-01' },
      { sourceKey: 'SRC-DUP', employeeId: 'TJ-TEST-0001', date: '2026-09-02' },
    ],
  });

  assert.equal(result.calculationAllowed, false);
  assert.ok(result.issues.some((item) => item.code === 'attendance_source_key_duplicate'));
});

test('employee and term references must resolve to the same employee source of truth', () => {
  const result = preflight.validatePayrollInput({
    employees: [employee()],
    terms: [term({ employeeId: 'TJ-TEST-9999' })],
    attendanceRecords: [],
  });

  assert.equal(result.calculationAllowed, false);
  assert.ok(result.issues.some((item) => item.code === 'employment_term_employee_unmatched'));
});

test('confirmed correction without a valid confirmed hour is blocked', () => {
  const result = preflight.validatePayrollInput({
    employees: [employee()],
    terms: [term()],
    attendanceRecords: [
      {
        sourceKey: 'SRC-1',
        employeeId: 'TJ-TEST-0001',
        date: '2026-09-01',
        reviewStatus: 'confirmed',
        confirmedHours: null,
      },
    ],
  });

  assert.equal(result.calculationAllowed, false);
  assert.ok(result.issues.some((item) => item.code === 'confirmed_hours_invalid'));
});

test('operator exceptions contain business labels without names or sensitive identifiers', () => {
  const validation = preflight.validatePayrollInput({
    employees: [employee()],
    terms: [
      term({ effectiveTo: '2026-08-24' }),
      term({ effectiveFrom: '2026-08-24', dailyScheduledHours: 4 }),
    ],
    attendanceRecords: [],
  });
  const items = preflight.operatorExceptionItems(validation);
  const overlap = items.find((item) => item.type === 'employment_term_overlap');

  assert.ok(overlap);
  assert.match(overlap.operatorLabel, /적용기간 겹침/);
  assert.equal(overlap.employeeId, 'TJ-TEST-0001');
  assert.doesNotMatch(JSON.stringify(items), /full_name|resident_registration|disability|bank_account/i);
});
