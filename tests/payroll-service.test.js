const test = require('node:test');
const assert = require('node:assert/strict');

const repositoryApi = require('../app/assets/payroll-repository.js');
const serviceApi = require('../app/assets/payroll-service.js');

const fixedClock = () => new Date('2026-09-25T07:00:00.000Z');

function fixture() {
  const employees = [
    {
      employeeId: 'TJ-TEST-0001',
      displayName: 'SECRET-NAME-SHOULD-NOT-PERSIST',
      hiredAt: '2026-06-09',
      terminatedAt: null,
      residentRegistrationNumber: 'SECRET-ID-SHOULD-NOT-PERSIST',
    },
  ];

  const terms = [
    {
      employeeId: 'TJ-TEST-0001',
      effectiveFrom: '2026-06-09',
      effectiveTo: null,
      dailyScheduledHours: 3,
      hourlyRate: 10320,
    },
  ];

  const holidays = [
    { date: '2026-09-24', name: '추석 전날', paid: true },
    { date: '2026-09-25', name: '추석', paid: true },
    { date: '2026-09-26', name: '추석 다음날', paid: true },
  ];

  const attendanceRecords = [
    { employeeId: 'TJ-TEST-0001', date: '2026-08-31', autoDecision: '기록완전' },
    { employeeId: 'TJ-TEST-0001', date: '2026-09-01', autoDecision: '기록완전' },
  ];

  return { employees, terms, holidays, attendanceRecords };
}

function makeService() {
  const repository = repositoryApi.createMemoryPayrollRepository();
  const service = serviceApi.createPayrollService({ repository, clock: fixedClock });
  return { repository, service };
}

async function createProvisional(service, overrides = {}) {
  const data = fixture();
  return service.calculateAndPersistProvisional({
    month: '2026-09',
    cutoffDate: '2026-09-01',
    ...data,
    ...overrides,
  });
}

test('provisional calculation runs only on an explicit command and persists its result', async () => {
  const { repository, service } = makeService();

  const before = await service.getPayrollMonthSnapshot('2026-09');
  assert.equal(before.latestRun, null);

  const run = await createProvisional(service);

  assert.equal(run.month, '2026-09');
  assert.equal(run.summary.employeeCount, 1);
  assert.equal(run.summary.grossPayPreview, 804960);
  assert.equal(run.summary.grossPayPreviewStatus, 'complete');
  assert.equal(run.employees[0].payableHoursPreview, 78);
  assert.match(run.inputFingerprint, /^[0-9a-f]{8}$/);

  const stored = await repository.getLatestComputation('2026-09');
  assert.equal(stored.runId, run.runId);
  assert.equal(stored.summary.grossPayPreview, 804960);
});

test('same payroll inputs reuse the existing calculation run instead of duplicating work', async () => {
  const { repository, service } = makeService();

  const first = await createProvisional(service);
  const second = await createProvisional(service);
  const runs = await repository.listComputations('2026-09');

  assert.equal(runs.length, 1);
  assert.equal(second.runId, first.runId);
  assert.equal(second.reusedExistingRun, true);
});

test('calculation fingerprint excludes names and HR secrets but changes when payroll facts change', () => {
  const data = fixture();
  const base = serviceApi.safeCalculationInput({
    month: '2026-09',
    cutoffDate: '2026-09-01',
    ...data,
  });
  const first = serviceApi.buildInputFingerprint(base);
  const serialized = serviceApi.stableStringify(base);

  assert.doesNotMatch(serialized, /SECRET-NAME-SHOULD-NOT-PERSIST/);
  assert.doesNotMatch(serialized, /SECRET-ID-SHOULD-NOT-PERSIST/);

  const changed = serviceApi.safeCalculationInput({
    month: '2026-09',
    cutoffDate: '2026-09-01',
    ...data,
    terms: data.terms.map((term) => ({ ...term, hourlyRate: 11000 })),
  });
  assert.notEqual(serviceApi.buildInputFingerprint(changed), first);
});

test('read-only month snapshot returns persisted values without creating a new calculation run', async () => {
  const { repository, service } = makeService();

  await createProvisional(service);

  const countBefore = (await repository.listComputations('2026-09')).length;
  const first = await service.getPayrollMonthSnapshot('2026-09');
  const second = await service.getPayrollMonthSnapshot('2026-09');
  const countAfter = (await repository.listComputations('2026-09')).length;

  assert.equal(countBefore, 1);
  assert.equal(countAfter, 1);
  assert.equal(first.latestRun.runId, second.latestRun.runId);
});

test('persisted calculation keeps employee_id and calculation facts but drops names and HR secrets', async () => {
  const { repository, service } = makeService();

  await createProvisional(service);

  const stored = await repository.getLatestComputation('2026-09');
  const serialized = JSON.stringify(stored);

  assert.match(serialized, /TJ-TEST-0001/);
  assert.doesNotMatch(serialized, /SECRET-NAME-SHOULD-NOT-PERSIST/);
  assert.doesNotMatch(serialized, /SECRET-ID-SHOULD-NOT-PERSIST/);
  assert.equal(stored.employees[0].dayRows[0].employeeId, undefined);
  assert.ok(stored.employees[0].dayRows.every((row) => 'date' in row && 'payableHours' in row));
});

test('repository returns clones so UI mutations cannot alter stored payroll state', async () => {
  const { repository, service } = makeService();

  await createProvisional(service);

  const snapshot = await service.getPayrollMonthSnapshot('2026-09');
  snapshot.latestRun.summary.grossPayPreview = -999;
  snapshot.latestRun.employees[0].dayRows[0].payableHours = -999;

  const stored = await repository.getLatestComputation('2026-09');
  assert.equal(stored.summary.grossPayPreview, 804960);
  assert.notEqual(stored.employees[0].dayRows[0].payableHours, -999);
});

test('unsafe legacy carryover service path is disabled', async () => {
  const { repository, service } = makeService();
  const run = await createProvisional(service);

  await assert.rejects(
    () => service.generateAndPersistCarryover({
      month: '2026-09',
      provisionalRun: run,
      finalEmployeeDayRows: {},
    }),
    (error) => error && error.code === 'unsafe_legacy_carryover_disabled'
  );
  assert.deepEqual(await repository.listAdjustments('2026-09'), []);
});

test('accounting comparison requires a provisional run and binds itself to the latest run', async () => {
  const { repository, service } = makeService();

  await assert.rejects(
    () => service.saveAccountingComparison({ month: '2026-09', confirmed: false, differenceCount: 0 }),
    (error) => error && error.code === 'provisional_run_required'
  );

  const run = await createProvisional(service);
  await service.saveAccountingComparison({
    month: '2026-09',
    confirmed: false,
    differenceCount: 1,
    rows: [
      {
        employeeId: 'TJ-TEST-0001',
        employeeName: 'SHOULD-NOT-PERSIST',
        field: 'deduction_total',
        provisionalValue: 100,
        confirmedValue: 120,
        difference: 20,
      },
    ],
  });

  const stored = await repository.getAccountingComparison('2026-09');
  assert.equal(stored.runId, run.runId);
  assert.equal(stored.stale, false);
  assert.equal(stored.rows[0].employeeId, 'TJ-TEST-0001');
  assert.equal(stored.rows[0].employeeName, undefined);
  assert.doesNotMatch(JSON.stringify(stored), /SHOULD-NOT-PERSIST/);
});

test('new provisional facts automatically invalidate a prior accounting comparison', async () => {
  const { service } = makeService();
  const data = fixture();

  const first = await createProvisional(service);
  await service.saveAccountingComparison({
    month: '2026-09',
    confirmed: true,
    differenceCount: 0,
  });

  const changedTerms = data.terms.map((term) => ({ ...term, hourlyRate: 11000 }));
  const second = await createProvisional(service, { terms: changedTerms });
  assert.notEqual(second.runId, first.runId);

  const snapshot = await service.getPayrollMonthSnapshot('2026-09');
  assert.equal(snapshot.accountingStatus, 'stale');
  assert.equal(snapshot.accountingComparison.confirmed, false);
  assert.equal(snapshot.accountingComparison.staleReason, 'provisional_recalculated');
  assert.equal(snapshot.accountingComparison.previousRunId, first.runId);
  assert.equal(snapshot.accountingComparison.currentRunId, second.runId);

  const evaluation = await service.evaluateFinalization('2026-09');
  assert.equal(evaluation.allowed, false);
  assert.ok(evaluation.blockers.includes('accounting_values_unconfirmed'));
});

test('company gross preview is withheld when any employee has multiple hourly rates requiring review', async () => {
  const { service } = makeService();
  const data = fixture();
  const terms = [
    { ...data.terms[0], effectiveTo: '2026-09-14' },
    { ...data.terms[0], effectiveFrom: '2026-09-15', hourlyRate: 11000 },
  ];

  const run = await createProvisional(service, { terms });
  assert.equal(run.summary.multiRateReviewCount, 1);
  assert.equal(run.summary.grossPayPreviewStatus, 'review_required');
  assert.equal(run.summary.grossPayPreview, null);
});

test('real month lock refuses to execute without explicit user approval even when all checks pass', async () => {
  const { repository, service } = makeService();
  await createProvisional(service);

  await repository.saveMonthState({
    month: '2026-09',
    status: 'provisional',
    unresolvedImportantExceptions: 0,
  });
  await service.saveAccountingComparison({
    month: '2026-09',
    confirmed: true,
    differenceCount: 0,
  });
  await repository.replaceAdjustments('2026-09', []);

  await assert.rejects(
    () => service.lockPayrollMonth({ month: '2026-09', approvedByUser: false }),
    (error) => error && error.code === 'user_approval_required'
  );

  const stateBefore = await repository.getMonthState('2026-09');
  assert.equal(stateBefore.status, 'provisional');
});

test('explicit approval still cannot bypass unresolved operational blockers', async () => {
  const { repository, service } = makeService();
  await createProvisional(service);

  await repository.saveMonthState({
    month: '2026-09',
    status: 'provisional',
    unresolvedImportantExceptions: 2,
  });
  await service.saveAccountingComparison({
    month: '2026-09',
    confirmed: true,
    differenceCount: 0,
  });

  await assert.rejects(
    () => service.lockPayrollMonth({ month: '2026-09', approvedByUser: true }),
    (error) => error && error.code === 'month_lock_blocked' && error.blockers.includes('important_exceptions_unresolved')
  );
});

test('month locks only after explicit approval and all guards are clear', async () => {
  const { repository, service } = makeService();
  await createProvisional(service);

  await repository.saveMonthState({
    month: '2026-09',
    status: 'provisional',
    unresolvedImportantExceptions: 0,
  });
  await service.saveAccountingComparison({
    month: '2026-09',
    confirmed: true,
    differenceCount: 0,
  });
  await repository.replaceAdjustments('2026-09', []);

  const locked = await service.lockPayrollMonth({
    month: '2026-09',
    approvedByUser: true,
    approvedBy: 'test-explicit-approval',
    approvalNote: 'anonymous regression only',
  });

  assert.equal(locked.status, 'locked');
  assert.equal(locked.approvedBy, 'test-explicit-approval');
});
