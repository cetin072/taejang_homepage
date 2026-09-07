const test = require('node:test');
const assert = require('node:assert/strict');

const commandApi = require('../app/assets/payroll-command.js');

function makeService() {
  const calls = [];
  return {
    calls,
    async calculateAndPersistProvisional(input) {
      calls.push(['calculate', input]);
      return { runId: 'RUN-1', reusedExistingRun: false };
    },
    async getPayrollMonthSnapshot(month) {
      calls.push(['get', month]);
      return { month };
    },
    async saveAccountingComparison(input) {
      calls.push(['accounting', input]);
      return input;
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
