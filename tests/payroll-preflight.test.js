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

function input(overrides = {}) {
  return {
    employees: [employee()],
    terms: [term()],
    attendanceRecords: [],
    cutoffDate: '2026-09-25',
    holidays: [],
    ...overrides,
  };
}

test('clean payroll inputs pass preflight', () => {
  const result = preflight.validatePayrollInput(input({
    attendanceRecords: [
      { sourceKey: 'SRC-1', employeeId: 'TJ-TEST-0001', date: '2026-09-01', autoDecision: '기록완전' },
    ],
  }));

  assert.equal(result.ok, true);
  assert.equal(result.calculationAllowed, true);
  assert.equal(result.issueCount, 0);
});

test('duplicate employee/day attendance fails closed before last-write-wins can occur', () => {
  const result = preflight.validatePayrollInput(input({
    attendanceRecords: [
      { sourceKey: 'SRC-1', employeeId: 'TJ-TEST-0001', date: '2026-09-01' },
      { sourceKey: 'SRC-2', employeeId: 'TJ-TEST-0001', date: '2026-09-01' },
    ],
  }));

  assert.equal(result.calculationAllowed, false);
  assert.ok(result.issues.some((item) => item.code === 'attendance_day_duplicate'));
});

test('duplicate source key is a critical import/audit issue', () => {
  const result = preflight.validatePayrollInput(input({
    attendanceRecords: [
      { sourceKey: 'SRC-DUP', employeeId: 'TJ-TEST-0001', date: '2026-09-01' },
      { sourceKey: 'SRC-DUP', employeeId: 'TJ-TEST-0001', date: '2026-09-02' },
    ],
  }));

  assert.equal(result.calculationAllowed, false);
  assert.ok(result.issues.some((item) => item.code === 'attendance_source_key_duplicate'));
});

test('employee and term references must resolve to the same employee source of truth', () => {
  const result = preflight.validatePayrollInput(input({
    terms: [term({ employeeId: 'TJ-TEST-9999' })],
  }));

  assert.equal(result.calculationAllowed, false);
  assert.ok(result.issues.some((item) => item.code === 'employment_term_employee_unmatched'));
});

test('confirmed correction without a valid confirmed hour is blocked', () => {
  const result = preflight.validatePayrollInput(input({
    attendanceRecords: [
      {
        sourceKey: 'SRC-1',
        employeeId: 'TJ-TEST-0001',
        date: '2026-09-01',
        reviewStatus: 'confirmed',
        confirmedHours: null,
      },
    ],
  }));

  assert.equal(result.calculationAllowed, false);
  assert.ok(result.issues.some((item) => item.code === 'confirmed_hours_invalid'));
});

test('impossible cutoff date is blocked before JavaScript can normalize it', () => {
  const result = preflight.validatePayrollInput(input({ cutoffDate: '2026-02-31' }));

  assert.equal(result.calculationAllowed, false);
  assert.ok(result.issues.some((item) => item.code === 'payroll_cutoff_date_invalid'));
});

test('invalid or duplicate holiday dates are blocked before payroll calculation', () => {
  const invalid = preflight.validatePayrollInput(input({
    holidays: [{ date: '2026-09-31', paid: true }],
  }));
  assert.equal(invalid.calculationAllowed, false);
  assert.ok(invalid.issues.some((item) => item.code === 'payroll_holiday_date_invalid'));

  const duplicate = preflight.validatePayrollInput(input({
    holidays: [
      { date: '2026-09-24', paid: true },
      { date: '2026-09-24', paid: false },
    ],
  }));
  assert.equal(duplicate.calculationAllowed, false);
  assert.ok(duplicate.issues.some((item) => item.code === 'payroll_holiday_date_duplicate'));
});

test('calendar context may include valid adjacent-month dates for cross-month weekly rules', () => {
  const result = preflight.validatePayrollInput(input({
    cutoffDate: '2026-08-31',
    holidays: [
      { date: '2026-08-31', paid: true },
      { date: '2026-10-01', paid: true },
    ],
  }));

  assert.equal(result.calculationAllowed, true);
});

test('operator exceptions contain business labels without names or sensitive identifiers', () => {
  const validation = preflight.validatePayrollInput(input({
    terms: [
      term({ effectiveTo: '2026-08-24' }),
      term({ effectiveFrom: '2026-08-24', dailyScheduledHours: 4 }),
    ],
  }));
  const items = preflight.operatorExceptionItems(validation);
  const overlap = items.find((item) => item.type === 'employment_term_overlap');

  assert.ok(overlap);
  assert.match(overlap.operatorLabel, /적용기간 겹침/);
  assert.equal(overlap.employeeId, 'TJ-TEST-0001');
  assert.doesNotMatch(JSON.stringify(items), /full_name|resident_registration|disability|bank_account/i);
});
