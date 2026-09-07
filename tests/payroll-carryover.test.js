const test = require('node:test');
const assert = require('node:assert/strict');

const carryover = require('../app/assets/payroll-carryover.js');

function employeeResult({ dayHours = 3, weeklyHours = 3, rate = null, rateStatus = null } = {}) {
  return {
    employeeId: 'TJ-TEST-0001',
    hourlyRate: rate,
    rateStatus,
    dayRows: [
      { date: '2026-09-28', payableHours: dayHours },
    ],
    weeklyHoliday: {
      weeks: [
        {
          weekStart: '2026-09-28',
          weekEnd: '2026-10-04',
          payableHours: weeklyHours,
        },
      ],
    },
  };
}

test('post-cutoff absence creates both work-hour and weekly-holiday carryover adjustments', () => {
  const provisional = employeeResult({ dayHours: 3, weeklyHours: 3 });
  const final = employeeResult({ dayHours: 0, weeklyHours: 0 });

  const adjustments = carryover.buildEmployeeCarryover({
    employeeId: 'TJ-TEST-0001',
    sourceMonth: '2026-09',
    provisionalResult: provisional,
    finalResult: final,
  });

  assert.equal(adjustments.length, 2);
  assert.deepEqual(adjustments.map((row) => row.category).sort(), ['weekly_holiday', 'work_hours']);
  assert.equal(adjustments.find((row) => row.category === 'work_hours').differenceHours, -3);
  assert.equal(adjustments.find((row) => row.category === 'weekly_holiday').differenceHours, -3);
  assert.ok(adjustments.every((row) => row.amountStatus === 'review_required'));
  assert.ok(adjustments.every((row) => row.differenceAmount === null));
});

test('single authoritative source-month rate converts carryover hours into won amount', () => {
  const provisional = employeeResult({
    dayHours: 3,
    weeklyHours: 3,
    rate: 10320,
    rateStatus: 'single_rate',
  });
  const final = employeeResult({
    dayHours: 0,
    weeklyHours: 0,
    rate: 10320,
    rateStatus: 'single_rate',
  });

  const adjustments = carryover.buildEmployeeCarryover({
    employeeId: 'TJ-TEST-0001',
    sourceMonth: '2026-09',
    provisionalResult: provisional,
    finalResult: final,
  });

  assert.equal(adjustments.length, 2);
  assert.ok(adjustments.every((row) => row.amountStatus === 'ready'));
  assert.ok(adjustments.every((row) => row.sourceHourlyRate === 10320));
  assert.ok(adjustments.every((row) => row.differenceAmount === -30960));
});

test('changed or non-single source rate never guesses a carryover amount', () => {
  const changedRate = carryover.buildEmployeeCarryover({
    employeeId: 'TJ-TEST-0001',
    sourceMonth: '2026-09',
    provisionalResult: employeeResult({ rate: 10320, rateStatus: 'single_rate' }),
    finalResult: employeeResult({ dayHours: 0, weeklyHours: 0, rate: 11000, rateStatus: 'single_rate' }),
  });
  const multiRate = carryover.buildEmployeeCarryover({
    employeeId: 'TJ-TEST-0001',
    sourceMonth: '2026-09',
    provisionalResult: employeeResult({ rate: 10320, rateStatus: 'multiple_rates_review_required' }),
    finalResult: employeeResult({ dayHours: 0, weeklyHours: 0, rate: 10320, rateStatus: 'multiple_rates_review_required' }),
  });

  for (const row of [...changedRate, ...multiRate]) {
    assert.equal(row.amountStatus, 'review_required');
    assert.equal(row.sourceHourlyRate, null);
    assert.equal(row.differenceAmount, null);
  }
});

test('unchanged final result creates no carryover noise', () => {
  const provisional = employeeResult();
  const final = employeeResult();

  const adjustments = carryover.buildEmployeeCarryover({
    employeeId: 'TJ-TEST-0001',
    sourceMonth: '2026-09',
    provisionalResult: provisional,
    finalResult: final,
  });

  assert.deepEqual(adjustments, []);
});

test('unresolved final day fails closed instead of treating missing hours as zero', () => {
  const provisional = employeeResult();
  const final = employeeResult();
  final.dayRows[0].payableHours = null;

  assert.throws(
    () => carryover.buildEmployeeCarryover({
      employeeId: 'TJ-TEST-0001',
      sourceMonth: '2026-09',
      provisionalResult: provisional,
      finalResult: final,
    }),
    (error) => error && error.code === 'final_reconciliation_incomplete'
  );
});

test('unresolved final weekly holiday fails closed instead of silently dropping the difference', () => {
  const provisional = employeeResult();
  const final = employeeResult();
  final.weeklyHoliday.weeks[0].payableHours = null;

  assert.throws(
    () => carryover.buildEmployeeCarryover({
      employeeId: 'TJ-TEST-0001',
      sourceMonth: '2026-09',
      provisionalResult: provisional,
      finalResult: final,
    }),
    (error) => error && error.code === 'final_reconciliation_incomplete'
  );
});

test('month carryover requires a final result for every provisional employee', () => {
  const provisional = employeeResult();

  assert.throws(
    () => carryover.buildMonthCarryover({
      sourceMonth: '2026-09',
      provisionalRun: { employees: [provisional] },
      finalEmployeeResults: {},
    }),
    (error) => error && error.code === 'final_reconciliation_incomplete'
  );
});
