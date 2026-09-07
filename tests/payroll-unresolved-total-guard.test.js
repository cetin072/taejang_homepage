const test = require('node:test');
const assert = require('node:assert/strict');

const repositoryApi = require('../app/assets/payroll-repository.js');
const serviceApi = require('../app/assets/payroll-service.js');

const fixedClock = () => new Date('2026-09-25T07:00:00.000Z');

test('unresolved attendance before cutoff withholds company gross in persisted service state', async () => {
  const repository = repositoryApi.createMemoryPayrollRepository();
  const service = serviceApi.createPayrollService({ repository, clock: fixedClock });

  const run = await service.calculateAndPersistProvisional({
    month: '2026-09',
    cutoffDate: '2026-09-10',
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
    holidays: [],
    attendanceRecords: [],
  });

  assert.ok(run.summary.unresolvedItemCount > 0);
  assert.equal(run.summary.grossPayPreviewStatus, 'review_required');
  assert.equal(run.summary.grossPayPreview, null);

  const stored = await repository.getLatestComputation('2026-09');
  assert.equal(stored.summary.grossPayPreviewStatus, 'review_required');
  assert.equal(stored.summary.grossPayPreview, null);

  const state = await repository.getMonthState('2026-09');
  assert.ok(state.unresolvedImportantExceptions > 0);
});
