const test = require('node:test');
const assert = require('node:assert/strict');

const commandApi = require('../app/assets/payroll-command.js');

function makeService() {
  const calls = [];
  return {
    calls,
    async calculateAndPersistProvisional(input) {
      calls.push(['calculate', input]);
      return { runId: 'RUN-1', month: input.month, reusedExistingRun: false };
    },
    async getPayrollMonthSnapshot(month) {
      calls.push(['get', month]);
      return { month, latestRun: { runId: 'RUN-1', month }, adjustments: [] };
    },
    async saveAccountingComparison(input) {
      calls.push(['accounting', input]);
      return input;
    },
    async replaceCarryoverAdjustments(input) {
      calls.push(['carryover', input]);
      return input.adjustments;
    },
    async applyIncomingCarryover(input) {
      calls.push(['apply-incoming', input]);
      return {
        month: input.month,
        runId: 'RUN-1',
        code: 'carryover_applied',
        applicationCount: 1,
      };
    },
    async evaluateFinalization(month) {
      calls.push(['evaluate', month]);
      return { allowed: true, blockers: [] };
    },
    async lockPayrollMonth(input) {
      calls.push(['lock', input]);
      return { month: input.month, status: 'locked' };
    },
  };
}

function validInput() {
  return {
    month: '2026-09',
    cutoffDate: '2026-09-25',
    employees: [
      { employeeId: 'TJ-TEST-0001', hiredAt: '2026-06-09', terminatedAt: null },
    ],
    terms: [
      {
        employeeId: 'TJ-TEST-0001',
        effectiveFrom: '2026-06-09',
        effectiveTo: null,
        dailyScheduledHours: 3,
        hourlyRate: 10320,
      },
    ],
    attendanceRecords: [],
    holidays: [],
  };
}

function reconciliationResult({ dayHours = 3, weeklyHours = 3 } = {}) {
  return {
    employeeId: 'TJ-TEST-0001',
    dayRows: [{ date: '2026-09-28', payableHours: dayHours }],
    weeklyHoliday: {
      weeks: [{ weekStart: '2026-09-28', weekEnd: '2026-10-04', payableHours: weeklyHours }],
    },
  };
}

function provisionalRun(result) {
  return { month: '2026-09', runId: 'RUN-1', employees: [result] };
}

function pendingAdjustment(overrides = {}) {
  return {
    adjustmentId: 'ADJ-1',
    employeeId: 'TJ-TEST-0001',
    sourceMonth: '2026-09',
    targetMonth: '2026-10',
    sourceDate: '2026-09-28',
    category: 'work_hours',
    beforeHours: 3,
    afterHours: 0,
    differenceHours: -3,
    status: 'pending_next_month',
    ...overrides,
  };
}

function completeAccountingSnapshot(overrides = {}) {
  return {
    month: '2026-10',
    latestRun: {
      runId: 'RUN-1',
      month: '2026-10',
      summary: {
        grossPayPreviewStatus: 'complete',
        grossPayPreview: 100000,
      },
    },
    payrollAmounts: {
      baseGrossPay: 100000,
      incomingAdjustmentStatus: 'none',
      incomingAdjustmentCount: 0,
      appliedAdjustmentAmount: 0,
      grossPayWithAdjustments: 100000,
    },
    adjustments: [],
    incomingAdjustments: [],
    monthState: { month: '2026-10', status: 'provisional' },
    ...overrides,
  };
}

test('critical preflight issue blocks calculation service call and returns operator exceptions', async () => {
  const service = makeService();
  const command = commandApi.createPayrollCommand({ service });
  const input = validInput();
  input.terms = [
    { ...input.terms[0], effectiveTo: '2026-08-24' },
    { ...input.terms[0], effectiveFrom: '2026-08-24', dailyScheduledHours: 4 },
  ];

  const result = await command.calculateProvisional(input);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'payroll_preflight_failed');
  assert.equal(service.calls.filter(([name]) => name === 'calculate').length, 0);
  assert.ok(result.exceptions.some((item) => item.operatorLabel.includes('적용기간 겹침')));
});

test('clean preflight calls calculation service exactly once', async () => {
  const service = makeService();
  const command = commandApi.createPayrollCommand({ service });

  const result = await command.calculateProvisional(validInput());

  assert.equal(result.ok, true);
  assert.equal(result.code, 'provisional_calculated');
  assert.equal(service.calls.filter(([name]) => name === 'calculate').length, 1);
});

test('confirmed accounting is blocked until incoming carryover is applied to adjusted gross', async () => {
  const service = makeService();
  service.getPayrollMonthSnapshot = async () => completeAccountingSnapshot({
    payrollAmounts: {
      baseGrossPay: 100000,
      incomingAdjustmentStatus: 'review_required',
      incomingAdjustmentCount: 1,
      appliedAdjustmentAmount: null,
      grossPayWithAdjustments: null,
    },
  });
  const command = commandApi.createPayrollCommand({ service });

  const result = await command.saveAccountingComparison({
    month: '2026-10',
    confirmed: true,
    differenceCount: 0,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'accounting_comparison_blocked');
  assert.ok(result.blockers.includes('incoming_carryover_not_applied'));
  assert.ok(result.blockers.includes('adjusted_gross_not_ready'));
  assert.equal(service.calls.filter(([name]) => name === 'accounting').length, 0);
});

test('confirmed accounting proceeds only after adjusted gross is ready', async () => {
  const service = makeService();
  service.getPayrollMonthSnapshot = async () => completeAccountingSnapshot({
    payrollAmounts: {
      baseGrossPay: 100000,
      incomingAdjustmentStatus: 'complete',
      incomingAdjustmentCount: 1,
      appliedAdjustmentAmount: -30960,
      grossPayWithAdjustments: 69040,
    },
  });
  const command = commandApi.createPayrollCommand({ service });

  const result = await command.saveAccountingComparison({
    month: '2026-10',
    confirmed: true,
    differenceCount: 0,
  });

  assert.equal(result.confirmed, true);
  assert.equal(service.calls.filter(([name]) => name === 'accounting').length, 1);
});

test('carryover command persists both day and weekly-holiday differences', async () => {
  const service = makeService();
  const command = commandApi.createPayrollCommand({ service });
  const provisional = reconciliationResult({ dayHours: 3, weeklyHours: 3 });
  const final = reconciliationResult({ dayHours: 0, weeklyHours: 0 });

  const result = await command.reconcileCarryover({
    month: '2026-09',
    provisionalRun: provisionalRun(provisional),
    finalEmployeeResults: { 'TJ-TEST-0001': final },
  });

  assert.equal(result.ok, true);
  assert.equal(result.adjustmentCount, 2);
  assert.deepEqual(result.adjustments.map((row) => row.category).sort(), ['weekly_holiday', 'work_hours']);
  assert.ok(result.adjustments.every((row) => row.targetMonth === '2026-10'));
  assert.equal(service.calls.filter(([name]) => name === 'carryover').length, 1);
});

test('carryover command refuses incomplete final reconciliation without persisting partial adjustments', async () => {
  const service = makeService();
  const command = commandApi.createPayrollCommand({ service });
  const provisional = reconciliationResult();
  const final = reconciliationResult();
  final.weeklyHoliday.weeks[0].payableHours = null;

  const result = await command.reconcileCarryover({
    month: '2026-09',
    provisionalRun: provisionalRun(provisional),
    finalEmployeeResults: { 'TJ-TEST-0001': final },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'final_reconciliation_incomplete');
  assert.equal(service.calls.filter(([name]) => name === 'carryover').length, 0);
});

test('carryover review never mutates state without explicit approval', async () => {
  const service = makeService();
  service.getPayrollMonthSnapshot = async (month) => ({ month, adjustments: [pendingAdjustment()] });
  const command = commandApi.createPayrollCommand({ service });

  const result = await command.reviewCarryover({
    month: '2026-09',
    reviewAll: true,
    approvedByUser: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'carryover_review_approval_required');
  assert.equal(service.calls.filter(([name]) => name === 'carryover').length, 0);
});

test('explicit reviewAll marks pending carryover reviewed but does not execute payment', async () => {
  const service = makeService();
  service.getPayrollMonthSnapshot = async (month) => ({
    month,
    adjustments: [pendingAdjustment(), pendingAdjustment({ adjustmentId: 'ADJ-2', status: 'applied' })],
  });
  const command = commandApi.createPayrollCommand({ service });

  const result = await command.reviewCarryover({
    month: '2026-09',
    reviewAll: true,
    approvedByUser: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, 'carryover_reviewed');
  assert.equal(result.reviewedCount, 1);
  assert.equal(result.adjustments.find((row) => row.adjustmentId === 'ADJ-1').status, 'reviewed');
  assert.equal(result.adjustments.find((row) => row.adjustmentId === 'ADJ-2').status, 'applied');
  assert.equal(service.calls.filter(([name]) => name === 'carryover').length, 1);
});

test('unknown carryover adjustment id fails closed without persistence', async () => {
  const service = makeService();
  service.getPayrollMonthSnapshot = async (month) => ({ month, adjustments: [pendingAdjustment()] });
  const command = commandApi.createPayrollCommand({ service });

  const result = await command.reviewCarryover({
    month: '2026-09',
    adjustmentIds: ['DOES-NOT-EXIST'],
    approvedByUser: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'carryover_review_unknown_adjustment');
  assert.deepEqual(result.unknownAdjustmentIds, ['DOES-NOT-EXIST']);
  assert.equal(service.calls.filter(([name]) => name === 'carryover').length, 0);
});

test('incoming carryover application never reaches service without explicit approval', async () => {
  const service = makeService();
  const command = commandApi.createPayrollCommand({ service });

  const denied = await command.applyIncomingCarryover({
    month: '2026-10',
    approvedByUser: false,
  });

  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'carryover_application_approval_required');
  assert.equal(service.calls.filter(([name]) => name === 'apply-incoming').length, 0);
});

test('incoming carryover cannot consume adjustments from an unlocked source payroll month', async () => {
  const service = makeService();
  service.getPayrollMonthSnapshot = async (month) => {
    if (month === '2026-10') {
      return {
        month,
        incomingAdjustments: [pendingAdjustment({ status: 'reviewed' })],
        monthState: { month, status: 'provisional' },
      };
    }
    if (month === '2026-09') {
      return { month, monthState: { month, status: 'provisional' } };
    }
    return { month };
  };
  const command = commandApi.createPayrollCommand({ service });

  const result = await command.applyIncomingCarryover({
    month: '2026-10',
    approvedByUser: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'carryover_source_month_not_locked');
  assert.deepEqual(result.sourceMonths, ['2026-09']);
  assert.equal(service.calls.filter(([name]) => name === 'apply-incoming').length, 0);
});

test('approved incoming carryover from a locked source month is delegated exactly once', async () => {
  const service = makeService();
  const originalGet = service.getPayrollMonthSnapshot;
  service.getPayrollMonthSnapshot = async (month) => {
    if (month === '2026-10') {
      return {
        month,
        incomingAdjustments: [pendingAdjustment({ status: 'reviewed' })],
        monthState: { month, status: 'provisional' },
      };
    }
    if (month === '2026-09') {
      return { month, monthState: { month, status: 'locked' } };
    }
    return originalGet(month);
  };
  const command = commandApi.createPayrollCommand({ service });

  const result = await command.applyIncomingCarryover({
    month: '2026-10',
    approvedByUser: true,
    approvedBy: 'anonymous-operator',
    approvalNote: 'regression only',
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, 'carryover_applied');
  assert.equal(result.result.applicationCount, 1);
  assert.equal(service.calls.filter(([name]) => name === 'apply-incoming').length, 1);
});

test('incoming carryover blocker is translated into operator language', async () => {
  const service = makeService();
  service.applyIncomingCarryover = async () => {
    const error = new Error('blocked');
    error.code = 'carryover_application_blocked';
    error.blockers = ['amount_not_ready:ADJ-1'];
    throw error;
  };
  const command = commandApi.createPayrollCommand({ service });

  const result = await command.applyIncomingCarryover({
    month: '2026-10',
    approvedByUser: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'carryover_application_blocked');
  assert.deepEqual(result.blockers, ['amount_not_ready:ADJ-1']);
});

test('explicit finalization approval remains visible at command boundary', async () => {
  const service = makeService();
  const command = commandApi.createPayrollCommand({ service });

  const denied = await command.finalizeMonth({ month: '2026-09', approvedByUser: false });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'user_approval_required');
  assert.equal(service.calls.filter(([name]) => name === 'lock').length, 0);

  const approved = await command.finalizeMonth({ month: '2026-09', approvedByUser: true });
  assert.equal(approved.ok, true);
  assert.equal(approved.state.status, 'locked');
  assert.equal(service.calls.filter(([name]) => name === 'lock').length, 1);
});

test('service month-lock blockers are converted to non-destructive operator result', async () => {
  const service = makeService();
  service.lockPayrollMonth = async () => {
    const error = new Error('blocked');
    error.code = 'month_lock_blocked';
    error.blockers = ['accounting_values_unconfirmed'];
    throw error;
  };
  const command = commandApi.createPayrollCommand({ service });

  const result = await command.finalizeMonth({ month: '2026-09', approvedByUser: true });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'month_lock_blocked');
  assert.deepEqual(result.blockers, ['accounting_values_unconfirmed']);
});
