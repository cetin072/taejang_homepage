const test = require('node:test');
const assert = require('node:assert/strict');

const repositoryApi = require('../app/assets/payroll-repository.js');
const serviceApi = require('../app/assets/payroll-service.js');

const fixedClock = () => new Date('2026-10-25T07:00:00.000Z');

function targetRun(runId = 'RUN-OCT-1', gross = 100000) {
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
    employees: [{
      employeeId: 'TJ-TEST-0001',
      grossPayPreview: gross,
      unresolvedCount: 0,
      weeklyHolidayPendingWeeks: 0,
      rateStatus: 'single_rate',
    }],
  };
}

function adjustment(id = 'ADJ-1', amount = -30960) {
  return {
    adjustmentId: id,
    employeeId: 'TJ-TEST-0001',
    sourceMonth: '2026-09',
    targetMonth: '2026-10',
    sourceDate: '2026-09-28',
    category: 'work_hours',
    beforeHours: 3,
    afterHours: 0,
    differenceHours: -3,
    sourceHourlyRate: 10320,
    differenceAmount: amount,
    amountStatus: 'ready',
    status: 'reviewed',
  };
}

async function seed({ sourceLocked = true, withAdjustment = true } = {}) {
  const repository = repositoryApi.createMemoryPayrollRepository();
  const service = serviceApi.createPayrollService({ repository, clock: fixedClock });
  await repository.saveComputation(targetRun());
  await repository.saveMonthState({
    month: '2026-10',
    status: 'provisional',
    latestRunId: 'RUN-OCT-1',
    unresolvedImportantExceptions: 0,
  });
  await repository.saveMonthState({
    month: '2026-09',
    status: sourceLocked ? 'locked' : 'provisional',
    unresolvedImportantExceptions: 0,
  });
  if (withAdjustment) await repository.replaceAdjustments('2026-09', [adjustment()]);
  return { repository, service };
}

test('service cannot confirm accounting while incoming carryover is still unapplied', async () => {
  const { repository, service } = await seed();

  await assert.rejects(
    () => service.saveAccountingComparison({
      month: '2026-10',
      confirmed: true,
      differenceCount: 0,
    }),
    (error) => error && error.code === 'accounting_basis_incomplete'
  );

  assert.equal(await repository.getAccountingComparison('2026-10'), null);
});

test('service direct carryover application also requires a locked source payroll month', async () => {
  const { repository, service } = await seed({ sourceLocked: false });

  await assert.rejects(
    () => service.applyIncomingCarryover({
      month: '2026-10',
      approvedByUser: true,
      approvedBy: 'anonymous-operator',
    }),
    (error) => (
      error
      && error.code === 'carryover_application_blocked'
      && error.blockers.some((item) => item === 'source_month_not_locked:2026-09')
    )
  );

  assert.deepEqual(await repository.listCarryoverApplications('2026-10'), []);
});

test('confirmed accounting stores the exact adjusted-payroll basis fingerprint', async () => {
  const { repository, service } = await seed();

  await service.applyIncomingCarryover({
    month: '2026-10',
    approvedByUser: true,
    approvedBy: 'anonymous-operator',
  });
  await service.saveAccountingComparison({
    month: '2026-10',
    confirmed: true,
    differenceCount: 0,
  });

  const comparison = await repository.getAccountingComparison('2026-10');
  assert.match(comparison.payrollBasisFingerprint, /^[0-9a-f]{8}$/);
  assert.equal(comparison.adjustedGrossBasis, 69040);

  const snapshot = await service.getPayrollMonthSnapshot('2026-10');
  assert.equal(snapshot.accountingStatus, 'confirmed');
  assert.equal(snapshot.payrollBasisFingerprint, comparison.payrollBasisFingerprint);
});

test('changing the incoming adjustment set after accounting confirmation makes accounting stale even if runId did not change', async () => {
  const { repository, service } = await seed();

  await service.applyIncomingCarryover({
    month: '2026-10',
    approvedByUser: true,
    approvedBy: 'anonymous-operator',
  });
  await service.saveAccountingComparison({
    month: '2026-10',
    confirmed: true,
    differenceCount: 0,
  });

  await repository.replaceAdjustments('2026-09', [
    adjustment(),
    adjustment('ADJ-2', -10320),
  ]);

  const snapshot = await service.getPayrollMonthSnapshot('2026-10');
  assert.equal(snapshot.accountingStatus, 'stale');
  assert.notEqual(
    snapshot.payrollBasisFingerprint,
    snapshot.accountingComparison.payrollBasisFingerprint
  );
});

test('orphan current-run carryover application cannot silently change adjusted gross', async () => {
  const { repository, service } = await seed({ withAdjustment: false });

  await repository.saveCarryoverApplication({
    applicationId: 'GHOST|RUN-OCT-1',
    adjustmentId: 'GHOST',
    employeeId: 'TJ-TEST-0001',
    sourceMonth: '2026-09',
    targetMonth: '2026-10',
    sourceDate: '2026-09-28',
    category: 'work_hours',
    differenceHours: -3,
    sourceHourlyRate: 10320,
    differenceAmount: -30960,
    appliedRunId: 'RUN-OCT-1',
    status: 'applied',
    appliedAt: fixedClock().toISOString(),
  });

  const snapshot = await service.getPayrollMonthSnapshot('2026-10');
  assert.equal(snapshot.payrollAmounts.orphanApplicationCount, 1);
  assert.equal(snapshot.payrollAmounts.incomingAdjustmentStatus, 'review_required');
  assert.equal(snapshot.payrollAmounts.appliedAdjustmentAmount, null);
  assert.equal(snapshot.payrollAmounts.grossPayWithAdjustments, null);
});
