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
  ];

  return { employees, terms, holidays, attendanceRecords };
}

function makeService() {
  const repository = repositoryApi.createMemoryPayrollRepository();
  const service = serviceApi.createPayrollService({ repository, clock: fixedClock });
  return { repository, service };
}

test('provisional calculation runs only on an explicit command and persists its result', async () => {
  const { repository, service } = makeService();
  const data = fixture();

  const before = await service.getPayrollMonthSnapshot('2026-09');
  assert.equal(before.latestRun, null);

  const run = await service.calculateAndPersistProvisional({
    month: '2026-09',
    cutoffDate: '2026-08-31',
    ...data,
  });

  assert.equal(run.month, '2026-09');
  assert.equal(run.summary.employeeCount, 1);
  assert.equal(run.summary.grossPayPreview, 804960);
  assert.equal(run.employees[0].payableHoursPreview, 78);

  const stored = await repository.getLatestComputation('2026-09');
  assert.equal(stored.runId, run.runId);
  assert.equal(stored.summary.grossPayPreview, 804960);
});

test('read-only month snapshot returns persisted values without creating a new calculation run', async () => {
  const { repository, service } = makeService();
  const data = fixture();

  await service.calculateAndPersistProvisional({
    month: '2026-09',
    cutoffDate: '2026-08-31',
    ...data,
  });

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
  const data = fixture();

  await service.calculateAndPersistProvisional({
    month: '2026-09',
    cutoffDate: '2026-08-31',
    ...data,
  });

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
  const data = fixture();

  await service.calculateAndPersistProvisional({
    month: '2026-09',
    cutoffDate: '2026-08-31',
    ...data,
  });

  const snapshot = await service.getPayrollMonthSnapshot('2026-09');
  snapshot.latestRun.summary.grossPayPreview = -999;
  snapshot.latestRun.employees[0].dayRows[0].payableHours = -999;

  const stored = await repository.getLatestComputation('2026-09');
  assert.equal(stored.summary.grossPayPreview, 804960);
  assert.notEqual(stored.employees[0].dayRows[0].payableHours, -999);
});

test('provisional vs final day difference becomes a separate carryover adjustment', async () => {
  const { repository, service } = makeService();
  const data = fixture();

  const run = await service.calculateAndPersistProvisional({
    month: '2026-09',
    cutoffDate: '2026-08-31',
    ...data,
  });

  const provisionalRows = run.employees[0].dayRows;
  const finalRows = provisionalRows.map((row) => ({ ...row }));
  const target = finalRows.find((row) => row.date === '2026-09-28');
  assert.ok(target);
  target.payableHours = 0;

  const adjustments = await service.generateAndPersistCarryover({
    month: '2026-09',
    provisionalRun: run,
    finalEmployeeDayRows: {
      'TJ-TEST-0001': finalRows,
    },
  });

  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].sourceDate, '2026-09-28');
  assert.equal(adjustments[0].differenceHours, -3);

  const stored = await repository.listAdjustments('2026-09');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].status, 'pending_next_month');
});

test('accounting comparison stores only employee-keyed differences', async () => {
  const { repository, service } = makeService();

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
  assert.equal(stored.rows[0].employeeId, 'TJ-TEST-0001');
  assert.equal(stored.rows[0].employeeName, undefined);
  assert.doesNotMatch(JSON.stringify(stored), /SHOULD-NOT-PERSIST/);
});

test('real month lock refuses to execute without explicit user approval even when all checks pass', async () => {
  const { repository, service } = makeService();

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
