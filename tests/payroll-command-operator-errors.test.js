const test = require('node:test');
const assert = require('node:assert/strict');

const commandApi = require('../app/assets/payroll-command.js');

function baseService() {
  return {
    async calculateAndPersistProvisional(input) {
      return { runId: 'RUN-1', month: input.month, reusedExistingRun: false };
    },
    async getPayrollMonthSnapshot(month) {
      return {
        month,
        latestRun: {
          runId: 'RUN-1',
          month,
          summary: { grossPayPreviewStatus: 'complete', grossPayPreview: 100000 },
        },
        payrollAmounts: {
          baseGrossPay: 100000,
          incomingAdjustmentStatus: 'none',
          incomingAdjustmentCount: 0,
          orphanApplicationCount: 0,
          appliedAdjustmentAmount: 0,
          grossPayWithAdjustments: 100000,
        },
        adjustments: [],
        incomingAdjustments: [],
        monthState: { month, status: 'provisional' },
      };
    },
    async saveAccountingComparison(input) {
      return input;
    },
    async replaceCarryoverAdjustments({ adjustments }) {
      return adjustments;
    },
    async applyIncomingCarryover(input) {
      return { month: input.month, runId: 'RUN-1', code: 'carryover_applied' };
    },
    async evaluateFinalization() {
      return { allowed: true, blockers: [] };
    },
    async lockPayrollMonth(input) {
      return { month: input.month, status: 'locked' };
    },
  };
}

function validCalculationInput() {
  return {
    month: '2026-09',
    cutoffDate: '2026-09-25',
    employees: [{ employeeId: 'TJ-TEST-0001', hiredAt: '2026-06-09', terminatedAt: null }],
    terms: [{
      employeeId: 'TJ-TEST-0001',
      effectiveFrom: '2026-06-09',
      effectiveTo: null,
      dailyScheduledHours: 3,
      hourlyRate: 10320,
    }],
    attendanceRecords: [],
    holidays: [],
  };
}

function reconciliationResult(hours) {
  return {
    employeeId: 'TJ-TEST-0001',
    dayRows: [{ date: '2026-09-28', payableHours: hours }],
    weeklyHoliday: {
      weeks: [{ weekStart: '2026-09-28', weekEnd: '2026-10-04', payableHours: hours }],
    },
  };
}

test('locked-month calculation becomes an operator message instead of a raw service exception', async () => {
  const service = baseService();
  service.calculateAndPersistProvisional = async () => {
    const error = new Error('month_locked:2026-09');
    error.code = 'month_locked';
    throw error;
  };
  const command = commandApi.createPayrollCommand({ service });

  const result = await command.calculateProvisional(validCalculationInput());

  assert.equal(result.ok, false);
  assert.equal(result.code, 'month_locked');
  assert.match(result.message, /이미 확정된 급여월/);
  assert.doesNotMatch(result.message, /month_locked/i);
});

test('accounting-basis race becomes re-comparison work instead of a raw service exception', async () => {
  const service = baseService();
  service.saveAccountingComparison = async () => {
    const error = new Error('accounting_basis_incomplete');
    error.code = 'accounting_basis_incomplete';
    error.blockers = ['adjusted_payroll_basis_incomplete'];
    throw error;
  };
  const command = commandApi.createPayrollCommand({ service });

  const result = await command.saveAccountingComparison({
    month: '2026-10',
    confirmed: true,
    differenceCount: 0,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'accounting_comparison_blocked');
  assert.match(result.message, /최신 급여 가안/);
  assert.deepEqual(result.blockers, ['adjusted_payroll_basis_incomplete']);
  assert.doesNotMatch(result.message, /accounting_basis/i);
});

test('locked-month carryover reconciliation is explained as non-editable work', async () => {
  const service = baseService();
  service.replaceCarryoverAdjustments = async () => {
    const error = new Error('month_locked:2026-09');
    error.code = 'month_locked';
    throw error;
  };
  const command = commandApi.createPayrollCommand({ service });
  const provisional = reconciliationResult(3);
  const final = reconciliationResult(0);

  const result = await command.reconcileCarryover({
    month: '2026-09',
    provisionalRun: { month: '2026-09', runId: 'RUN-1', employees: [provisional] },
    finalEmployeeResults: { 'TJ-TEST-0001': final },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'month_locked');
  assert.match(result.message, /이월조정/);
  assert.doesNotMatch(result.message, /month_locked/i);
});

test('locked-month carryover review is explained instead of throwing a technical error', async () => {
  const service = baseService();
  service.getPayrollMonthSnapshot = async (month) => ({
    month,
    adjustments: [{
      adjustmentId: 'ADJ-1',
      employeeId: 'TJ-TEST-0001',
      sourceMonth: month,
      targetMonth: '2026-10',
      sourceDate: '2026-09-28',
      category: 'work_hours',
      status: 'pending_next_month',
    }],
  });
  service.replaceCarryoverAdjustments = async () => {
    const error = new Error('month_locked:2026-09');
    error.code = 'month_locked';
    throw error;
  };
  const command = commandApi.createPayrollCommand({ service });

  const result = await command.reviewCarryover({
    month: '2026-09',
    reviewAll: true,
    approvedByUser: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'month_locked');
  assert.match(result.message, /확인상태/);
  assert.doesNotMatch(result.message, /month_locked/i);
});

test('already-locked finalization race stays non-destructive and operator-readable', async () => {
  const service = baseService();
  service.lockPayrollMonth = async () => {
    const error = new Error('month_locked:2026-09');
    error.code = 'month_locked';
    throw error;
  };
  const command = commandApi.createPayrollCommand({ service });

  const result = await command.finalizeMonth({ month: '2026-09', approvedByUser: true });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'month_locked');
  assert.match(result.message, /이미 확정된 급여월/);
  assert.doesNotMatch(result.message, /month_locked/i);
});
