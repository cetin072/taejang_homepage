const test = require('node:test');
const assert = require('node:assert/strict');

const commandApi = require('../app/assets/payroll-command.js');

function serviceWithSnapshot(snapshot) {
  return {
    async calculateAndPersistProvisional() { return {}; },
    async getPayrollMonthSnapshot() { return snapshot; },
    async saveAccountingComparison() { return {}; },
    async replaceCarryoverAdjustments() { return []; },
    async applyIncomingCarryover() { return {}; },
    async evaluateFinalization() { return { allowed: false, blockers: [] }; },
    async lockPayrollMonth() { return {}; },
  };
}

function lockedSnapshot() {
  const basis = 'a1b2c3d4';
  return {
    month: '2026-10',
    latestRun: {
      runId: 'RUN-OCT-1',
      version: 'payroll-engine-v2',
      generatedAt: '2026-10-25T07:00:00.000Z',
      summary: { employeeCount: 1, grossPayPreviewStatus: 'complete', grossPayPreview: 100000 },
    },
    monthState: { month: '2026-10', status: 'locked', lockedAt: '2026-10-31T07:00:00.000Z' },
    payrollAmounts: {
      baseGrossPay: 100000,
      incomingAdjustmentStatus: 'none',
      incomingAdjustmentCount: 0,
      orphanApplicationCount: 0,
      appliedAdjustmentAmount: 0,
      grossPayWithAdjustments: 100000,
      employees: [{
        employeeId: 'TJ-TEST-0001',
        baseGrossPay: 100000,
        carryoverAdjustmentAmount: 0,
        grossPayWithAdjustments: 100000,
      }],
    },
    adjustments: [],
    payrollBasisFingerprint: basis,
    accountingStatus: 'confirmed',
    accountingComparison: {
      confirmed: true,
      differenceCount: 0,
      payrollBasisFingerprint: basis,
      adjustedGrossBasis: 100000,
    },
  };
}

test('command returns locked payroll summary through a read-only operator boundary', async () => {
  const command = commandApi.createPayrollCommand({ service: serviceWithSnapshot(lockedSnapshot()) });

  const result = await command.getLockedOutput('2026-10');

  assert.equal(result.ok, true);
  assert.equal(result.code, 'payroll_locked_output_ready');
  assert.equal(result.output.status, 'locked');
  assert.equal(result.output.totals.adjustedGrossPay, 100000);
});

test('command translates pre-lock output request into business language instead of throwing', async () => {
  const snapshot = lockedSnapshot();
  snapshot.monthState = { month: '2026-10', status: 'ready' };
  const command = commandApi.createPayrollCommand({ service: serviceWithSnapshot(snapshot) });

  const result = await command.getLockedOutput('2026-10');

  assert.equal(result.ok, false);
  assert.equal(result.code, 'payroll_output_month_not_locked');
  assert.match(result.message, /급여 확정이 끝난 달/);
  assert.doesNotMatch(result.message, /payroll_output_/);
});

test('command blocks stale accounting output with a readable recheck message', async () => {
  const snapshot = lockedSnapshot();
  snapshot.accountingStatus = 'stale';
  const command = commandApi.createPayrollCommand({ service: serviceWithSnapshot(snapshot) });

  const result = await command.getLockedOutput('2026-10');

  assert.equal(result.ok, false);
  assert.equal(result.code, 'payroll_output_accounting_not_current');
  assert.match(result.message, /회계 대조/);
  assert.ok(result.blockers.includes('accounting_basis_not_current'));
});
