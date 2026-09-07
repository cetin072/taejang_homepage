const test = require('node:test');
const assert = require('node:assert/strict');

const repositoryApi = require('../app/assets/payroll-repository.js');

function run(overrides = {}) {
  return {
    runId: 'RUN-1',
    month: '2026-09',
    version: 'payroll-engine-v2',
    inputFingerprint: 'abcd1234',
    cutoffDate: '2026-09-25',
    ...overrides,
  };
}

test('same runId is idempotent and does not create duplicate computation rows', async () => {
  const repository = repositoryApi.createMemoryPayrollRepository();

  await repository.saveComputation(run());
  await repository.saveComputation(run());

  const rows = await repository.listComputations('2026-09');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].runId, 'RUN-1');
});

test('month state cannot point at a payroll run that was never persisted for that month', async () => {
  const repository = repositoryApi.createMemoryPayrollRepository();

  await assert.rejects(
    () => repository.saveMonthState({
      month: '2026-09',
      status: 'provisional',
      latestRunId: 'MISSING-RUN',
    }),
    (error) => error && error.code === 'payroll_latest_run_missing'
  );
  assert.equal(await repository.getMonthState('2026-09'), null);
});

test('month state accepts only an actually persisted run from the same payroll month', async () => {
  const repository = repositoryApi.createMemoryPayrollRepository();
  await repository.saveComputation(run());

  const stored = await repository.saveMonthState({
    month: '2026-09',
    status: 'provisional',
    latestRunId: 'RUN-1',
  });

  assert.equal(stored.latestRunId, 'RUN-1');
});

test('duplicate adjustment ids fail closed instead of double-applying the same correction', async () => {
  const repository = repositoryApi.createMemoryPayrollRepository();
  const row = {
    adjustmentId: 'ADJ-1',
    employeeId: 'TJ-TEST-0001',
    sourceMonth: '2026-09',
    targetMonth: '2026-10',
  };

  await assert.rejects(
    () => repository.replaceAdjustments('2026-09', [row, { ...row }]),
    (error) => error && error.code === 'carryover_adjustment_duplicate'
  );
  assert.deepEqual(await repository.listAdjustments('2026-09'), []);
});

test('accounting comparison cannot point at a non-existent calculation run', async () => {
  const repository = repositoryApi.createMemoryPayrollRepository();

  await assert.rejects(
    () => repository.saveAccountingComparison({
      month: '2026-09',
      runId: 'MISSING-RUN',
      confirmed: true,
    }),
    (error) => error && error.code === 'accounting_run_missing'
  );
  assert.equal(await repository.getAccountingComparison('2026-09'), null);
});
