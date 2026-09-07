const test = require('node:test');
const assert = require('node:assert/strict');

const outputApi = require('../app/assets/payroll-output.js');

function lockedSnapshot(overrides = {}) {
  const basis = 'a1b2c3d4';
  return {
    month: '2026-10',
    latestRun: {
      runId: 'RUN-OCT-1',
      version: 'payroll-engine-v2',
      generatedAt: '2026-10-25T07:00:00.000Z',
      summary: {
        employeeCount: 2,
        grossPayPreviewStatus: 'complete',
        grossPayPreview: 200000,
      },
    },
    monthState: {
      month: '2026-10',
      status: 'locked',
      lockedAt: '2026-10-31T07:00:00.000Z',
      approvedBy: 'anonymous-operator',
      approvalNote: 'regression only',
    },
    payrollAmounts: {
      baseGrossPay: 200000,
      incomingAdjustmentStatus: 'complete',
      incomingAdjustmentCount: 1,
      orphanApplicationCount: 0,
      appliedAdjustmentAmount: -10000,
      grossPayWithAdjustments: 190000,
      employees: [
        {
          employeeId: 'TJ-TEST-0002',
          baseGrossPay: 100000,
          carryoverAdjustmentAmount: 0,
          grossPayWithAdjustments: 100000,
          fullName: 'SHOULD-NOT-EXPORT',
          bankAccount: 'SHOULD-NOT-EXPORT',
        },
        {
          employeeId: 'TJ-TEST-0001',
          baseGrossPay: 100000,
          carryoverAdjustmentAmount: -10000,
          grossPayWithAdjustments: 90000,
          residentRegistrationNumber: 'SHOULD-NOT-EXPORT',
        },
      ],
    },
    incomingAdjustments: [],
    adjustments: [
      { adjustmentId: 'OUT-1', status: 'reviewed' },
    ],
    payrollBasisFingerprint: basis,
    accountingStatus: 'confirmed',
    accountingComparison: {
      confirmed: true,
      differenceCount: 0,
      payrollBasisFingerprint: basis,
      adjustedGrossBasis: 190000,
    },
    ...overrides,
  };
}

test('locked and accounting-current payroll produces a deterministic safe output summary', () => {
  const result = outputApi.buildLockedPayrollOutput(lockedSnapshot());

  assert.equal(result.schemaVersion, 'payroll-locked-output-v1');
  assert.equal(result.status, 'locked');
  assert.equal(result.month, '2026-10');
  assert.equal(result.totals.employeeCount, 2);
  assert.equal(result.totals.baseGrossPay, 200000);
  assert.equal(result.totals.carryoverAdjustmentAmount, -10000);
  assert.equal(result.totals.adjustedGrossPay, 190000);
  assert.equal(result.accounting.adjustedGrossBasis, 190000);
  assert.deepEqual(result.employees.map((row) => row.employeeId), ['TJ-TEST-0001', 'TJ-TEST-0002']);
});

test('output strips names, bank accounts, resident numbers and unrelated sensitive HR fields', () => {
  const result = outputApi.buildLockedPayrollOutput(lockedSnapshot());
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /SHOULD-NOT-EXPORT/);
  assert.doesNotMatch(serialized, /fullName|bankAccount|residentRegistration|disability/i);
  assert.deepEqual(Object.keys(result.employees[0]).sort(), [
    'adjustedGrossPay',
    'baseGrossPay',
    'carryoverAdjustmentAmount',
    'employeeId',
  ]);
});

test('unlocked month cannot generate a final payroll output', () => {
  const snapshot = lockedSnapshot({
    monthState: { month: '2026-10', status: 'ready' },
  });

  assert.throws(
    () => outputApi.buildLockedPayrollOutput(snapshot),
    (error) => error && error.code === 'payroll_output_month_not_locked'
  );
});

test('stale accounting basis blocks output even when the month is already locked', () => {
  const snapshot = lockedSnapshot({
    accountingStatus: 'stale',
  });

  assert.throws(
    () => outputApi.buildLockedPayrollOutput(snapshot),
    (error) => error && error.code === 'payroll_output_accounting_not_current'
  );
});

test('different accounting gross basis blocks output instead of exporting conflicting totals', () => {
  const snapshot = lockedSnapshot();
  snapshot.accountingComparison.adjustedGrossBasis = 180000;

  assert.throws(
    () => outputApi.buildLockedPayrollOutput(snapshot),
    (error) => error && error.code === 'payroll_output_basis_mismatch'
  );
});

test('CSV export contains only safe employee payroll columns and preserves adjustments', () => {
  const output = outputApi.buildLockedPayrollOutput(lockedSnapshot());
  const csv = outputApi.buildLockedPayrollCsv(output);

  assert.match(csv, /^employee_id,base_gross_pay,prior_month_adjustment,adjusted_gross_pay/m);
  assert.match(csv, /TJ-TEST-0001,100000,-10000,90000/);
  assert.match(csv, /TJ-TEST-0002,100000,0,100000/);
  assert.doesNotMatch(csv, /SHOULD-NOT-EXPORT/);
});
