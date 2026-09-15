const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../app/assets/payroll-engine.js');
const repositoryApi = require('../app/assets/payroll-repository.js');
const serviceApi = require('../app/assets/payroll-service.js');

const employee = {
  employeeId: 'TJ-TEST-0001',
  hiredAt: '2026-06-09',
  terminatedAt: null,
};

const baseTerm = {
  employeeId: 'TJ-TEST-0001',
  effectiveFrom: '2026-06-09',
  effectiveTo: null,
  dailyScheduledHours: 3,
};

const attendanceRecords = [
  { employeeId: 'TJ-TEST-0001', date: '2026-08-31', autoDecision: '기록완전' },
  { employeeId: 'TJ-TEST-0001', date: '2026-09-01', autoDecision: '기록완전' },
];

const holidays = [
  { date: '2026-09-24', paid: true },
  { date: '2026-09-25', paid: true },
];

test('missing hourly rate is an explicit review state, never a zero-pay single-rate state', () => {
  const result = engine.calculateProvisionalMonth({
    employee,
    year: 2026,
    month: 9,
    cutoffDate: '2026-09-01',
    terms: [{ ...baseTerm, hourlyRate: null }],
    holidays,
    attendanceRecords,
  });

  assert.equal(result.rateStatus, 'missing_rate_review_required');
  assert.equal(result.hourlyRate, null);
  assert.equal(result.grossPayPreview, null);
  assert.ok(result.payableHoursPreview > 0);
});

test('service rejects missing hourly rate before persisting a payroll run', async () => {
  const repository = repositoryApi.createMemoryPayrollRepository();
  const service = serviceApi.createPayrollService({
    repository,
    clock: () => new Date('2026-09-25T07:00:00.000Z'),
  });

  await assert.rejects(
    () => service.calculateAndPersistProvisional({
      month: '2026-09',
      cutoffDate: '2026-09-01',
      employees: [employee],
      terms: [{ ...baseTerm, hourlyRate: null }],
      holidays,
      attendanceRecords,
    }),
    (error) => error
      && error.code === 'payroll_preflight_failed'
      && error.validation.issues.some((item) => item.code === 'employment_term_rate_missing')
  );

  assert.equal(await repository.getLatestComputation('2026-09'), null);
  assert.equal(await repository.getMonthState('2026-09'), null);
});
