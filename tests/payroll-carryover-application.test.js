const test = require('node:test');
const assert = require('node:assert/strict');

const repositoryApi = require('../app/assets/payroll-repository.js');
const serviceApi = require('../app/assets/payroll-service.js');

const fixedClock = () => new Date('2026-10-25T07:00:00.000Z');

function baseRun(runId = 'RUN-OCT-1', gross = 100000) {
  return {
    runId,
    version: serviceApi.CALCULATION_VERSION,
    inputFingerprint: `fp-${runId}`,
    month: '2026-10',
    cutoffDate: '2026-10-25',
    generatedAt: '2026-10-25T07:00:00.000Z',
    sourceState: 'provisional',
    summary: {
      employeeCount: 1,
      unresolvedEmployeeCount: 0,
      unresolvedItemCount: 0,
      pendingWeeklyHolidayWeeks: 0,
      multiRateReviewCount: 0,
      missingRateReviewCount: 0,
      rateReviewCount: 0,
      grossPayPreviewStatus: 'complete',
      grossPayPreview: gross,
      payableHoursPreview: 0,
    },
    employees: [
      {
        employeeId: 'TJ-TEST-0001',
        grossPayPreview: gross,
        unresolvedCount: 0,
        weeklyHolidayPendingWeeks: 0,
        rateStatus: 'single_rate',
      },
    ],
  };
}

function reviewedIncoming(overrides = {}) {
  return {
    adjustmentId: 'TJ-TEST-0001|2026-09|2026-09-28|work-hours',
    employeeId: 'TJ-TEST-0001',
    sourceMonth: '2026-09',
    targetMonth: '2026-10',
    sourceDate: '2026-09-28',
    category: 'work_hours',
    beforeHours: 3,
    afterHours: 0,
    differenceHours: -3,
    sourceHourlyRate: 10320,
    differenceAmount: -30960,
    amountStatus: 'ready',
    status: 'reviewed',
    ...overrides,
  };
}

async function seededService() {
  const repository = repositoryApi.createMemoryPayrollRepository();
  const service = serviceApi.createPayrollService({ repository, clock: fixedClock });
  await repository.saveComputation(baseRun());
  await repository.saveMonthState({
    month: '2026-10',
    status: 'provisional',
    latestRunId: 'RUN-OCT-1',
    unresolvedImportantExceptions: 0,
  });
  await repository.replaceAdjustments('2026-09', [reviewedIncoming()]);
  await repository.saveMonthState({
    month: '2026-09',
    status: 'locked',
    lockedAt: '2026-09-30T07:00:00.000Z',
  });
  return { repository, service };
}

test('incoming carryover remains separate from target-month work hours and adjusted gross is withheld before application', async () => {
  const { service } = await seededService();

  const snapshot = await service.getPayrollMonthSnapshot('2026-10');

  assert.equal(snapshot.latestRun.summary.grossPayPreview, 100000);
  assert.equal(snapshot.payrollAmounts.baseGrossPay, 100000);
  assert.equal(snapshot.payrollAmounts.incomingAdjustmentStatus, 'review_required');
  assert.equal(snapshot.payrollAmounts.appliedAdjustmentAmount, null);
  assert.equal(snapshot.payrollAmounts.grossPayWithAdjustments, null);
  assert.equal(snapshot.payrollAmounts.rows[0].differenceHours, -3);
  assert.equal(snapshot.payrollAmounts.rows[0].differenceAmount, -30960);
  assert.equal(snapshot.latestRun.employees[0].payableHoursPreview, undefined);
});

test('incoming carryover application requires explicit approval and never mutates the source adjustment', async () => {
  const { repository, service } = await seededService();

  await assert.rejects(
    () => service.applyIncomingCarryover({ month: '2026-10', approvedByUser: false }),
    (error) => error && error.code === 'carryover_application_approval_required'
  );

  const result = await service.applyIncomingCarryover({
    month: '2026-10',
    approvedByUser: true,
    approvedBy: 'anonymous-operator',
    approvalNote: 'regression only',
  });

  assert.equal(result.code, 'carryover_applied');
  assert.equal(result.applicationCount, 1);

  const sourceRows = await repository.listAdjustments('2026-09');
  assert.equal(sourceRows[0].status, 'reviewed');
  assert.equal(sourceRows[0].differenceAmount, -30960);

  const snapshot = await service.getPayrollMonthSnapshot('2026-10');
  assert.equal(snapshot.payrollAmounts.incomingAdjustmentStatus, 'complete');
  assert.equal(snapshot.payrollAmounts.appliedAdjustmentAmount, -30960);
  assert.equal(snapshot.payrollAmounts.grossPayWithAdjustments, 69040);
  assert.equal(snapshot.payrollAmounts.employees[0].baseGrossPay, 100000);
  assert.equal(snapshot.payrollAmounts.employees[0].carryoverAdjustmentAmount, -30960);
  assert.equal(snapshot.payrollAmounts.employees[0].grossPayWithAdjustments, 69040);
});

test('same target run reuses the immutable application instead of duplicating it', async () => {
  const { repository, service } = await seededService();

  const first = await service.applyIncomingCarryover({
    month: '2026-10',
    approvedByUser: true,
    approvedBy: 'anonymous-operator',
  });
  const second = await service.applyIncomingCarryover({
    month: '2026-10',
    approvedByUser: true,
    approvedBy: 'anonymous-operator',
  });

  assert.equal(first.code, 'carryover_applied');
  assert.equal(second.code, 'carryover_application_reused');
  assert.equal(second.reusedCount, 1);
  assert.equal((await repository.listCarryoverApplications('2026-10')).length, 1);
});

test('a new target payroll run makes the old application stale until the adjustment is explicitly applied again', async () => {
  const { repository, service } = await seededService();

  await service.applyIncomingCarryover({
    month: '2026-10',
    approvedByUser: true,
    approvedBy: 'anonymous-operator',
  });

  await repository.saveComputation(baseRun('RUN-OCT-2', 110000));
  await repository.saveMonthState({
    month: '2026-10',
    status: 'provisional',
    latestRunId: 'RUN-OCT-2',
    unresolvedImportantExceptions: 0,
  });

  const stale = await service.getPayrollMonthSnapshot('2026-10');
  assert.equal(stale.payrollAmounts.baseGrossPay, 110000);
  assert.equal(stale.payrollAmounts.incomingAdjustmentStatus, 'review_required');
  assert.equal(stale.payrollAmounts.rows[0].applicationStatus, 'stale');
  assert.equal(stale.payrollAmounts.grossPayWithAdjustments, null);

  const reapplied = await service.applyIncomingCarryover({
    month: '2026-10',
    approvedByUser: true,
    approvedBy: 'anonymous-operator',
  });
  assert.equal(reapplied.code, 'carryover_applied');

  const current = await service.getPayrollMonthSnapshot('2026-10');
  assert.equal(current.payrollAmounts.incomingAdjustmentStatus, 'complete');
  assert.equal(current.payrollAmounts.grossPayWithAdjustments, 79040);
  assert.equal((await repository.listCarryoverApplications('2026-10')).length, 2);
});

test('unreviewed or amount-ambiguous incoming adjustment cannot be applied', async () => {
  const { repository, service } = await seededService();
  await repository.replaceAdjustments('2026-09', [
    reviewedIncoming({ status: 'pending_next_month', differenceAmount: null, amountStatus: 'review_required' }),
  ]);

  await assert.rejects(
    () => service.applyIncomingCarryover({
      month: '2026-10',
      approvedByUser: true,
      approvedBy: 'anonymous-operator',
    }),
    (error) => (
      error
      && error.code === 'carryover_application_blocked'
      && error.blockers.some((item) => item.startsWith('source_not_reviewed:'))
      && error.blockers.some((item) => item.startsWith('amount_not_ready:'))
    )
  );
});
