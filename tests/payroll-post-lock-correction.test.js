const test = require('node:test');
const assert = require('node:assert/strict');

const repositoryApi = require('../app/assets/payroll-repository.js');
const correctionApi = require('../app/assets/payroll-post-lock-correction.js');

const fixedClock = () => new Date('2026-10-05T07:00:00.000Z');

function correction(overrides = {}) {
  return {
    adjustmentId: 'POSTLOCK-TJ-TEST-0001-2026-09-29-WORK',
    employeeId: 'TJ-TEST-0001',
    sourceMonth: '2026-09',
    targetMonth: '2026-10',
    sourceDate: '2026-09-29',
    category: 'work_hours',
    beforeHours: 3,
    afterHours: 0,
    differenceHours: -3,
    sourceHourlyRate: 10320,
    differenceAmount: -30960,
    reason: '월말 실제 결근 확인',
    approvedByUser: true,
    approvedBy: 'anonymous-operator',
    ...overrides,
  };
}

async function makeService({ sourceStatus = 'locked', targetStatus = 'provisional' } = {}) {
  const repository = repositoryApi.createMemoryPayrollRepository();
  await repository.saveMonthState({ month: '2026-09', status: sourceStatus });
  if (targetStatus) {
    await repository.saveMonthState({ month: '2026-10', status: targetStatus });
  }
  const service = correctionApi.createPostLockCorrectionService({ repository, clock: fixedClock });
  return { repository, service };
}

test('post-lock correction appends an audited next-month adjustment without rewriting locked source state', async () => {
  const { repository, service } = await makeService();
  const sourceBefore = await repository.getMonthState('2026-09');

  const result = await service.recordCorrection(correction());

  assert.equal(result.code, 'post_lock_correction_recorded');
  assert.equal(result.adjustment.correctionKind, 'post_lock');
  assert.equal(result.adjustment.status, 'reviewed');
  assert.equal(result.adjustment.amountStatus, 'ready');
  assert.equal(result.adjustment.differenceAmount, -30960);
  assert.equal(result.adjustment.reviewedBy, 'anonymous-operator');

  const sourceAfter = await repository.getMonthState('2026-09');
  assert.deepEqual(sourceAfter, sourceBefore);
  assert.equal(sourceAfter.status, 'locked');

  const sourceAdjustments = await repository.listAdjustments('2026-09');
  const targetingOctober = await repository.listAdjustmentsTargeting('2026-10');
  assert.equal(sourceAdjustments.length, 1);
  assert.equal(targetingOctober.length, 1);
  assert.equal(targetingOctober[0].adjustmentId, result.adjustment.adjustmentId);
});

test('post-lock correction requires explicit approval', async () => {
  const { service } = await makeService();

  await assert.rejects(
    () => service.recordCorrection(correction({ approvedByUser: false })),
    (error) => error && error.code === 'post_lock_correction_approval_required'
  );
});

test('source payroll month must already be locked', async () => {
  const { service } = await makeService({ sourceStatus: 'ready' });

  await assert.rejects(
    () => service.recordCorrection(correction()),
    (error) => error && error.code === 'post_lock_correction_source_not_locked'
  );
});

test('correction cannot target another already locked payroll month', async () => {
  const { service } = await makeService({ targetStatus: 'locked' });

  await assert.rejects(
    () => service.recordCorrection(correction()),
    (error) => error && error.code === 'post_lock_correction_target_locked'
  );
});

test('same correction retry is idempotent and does not create a second adjustment', async () => {
  const { repository, service } = await makeService();

  const first = await service.recordCorrection(correction());
  const second = await service.recordCorrection(correction());

  assert.equal(first.code, 'post_lock_correction_recorded');
  assert.equal(second.code, 'post_lock_correction_reused');
  assert.equal((await repository.listAdjustments('2026-09')).length, 1);
});

test('same correction id with different amount fails closed instead of rewriting audit history', async () => {
  const { repository, service } = await makeService();
  await service.recordCorrection(correction());

  await assert.rejects(
    () => service.recordCorrection(correction({ differenceAmount: -20640 })),
    (error) => error && error.code === 'post_lock_correction_conflict'
  );

  const stored = await repository.listAdjustments('2026-09');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].differenceAmount, -30960);
});

test('inconsistent before/after hours and difference are rejected before persistence', async () => {
  const { repository, service } = await makeService();

  await assert.rejects(
    () => service.recordCorrection(correction({ beforeHours: 3, afterHours: 1, differenceHours: -3 })),
    (error) => error && error.code === 'post_lock_correction_hours_mismatch'
  );
  assert.equal((await repository.listAdjustments('2026-09')).length, 0);
});

test('source date must belong to the locked source payroll month', async () => {
  const { service } = await makeService();

  await assert.rejects(
    () => service.recordCorrection(correction({ sourceDate: '2026-10-01' })),
    (error) => error && error.code === 'post_lock_correction_source_date_invalid'
  );
});
