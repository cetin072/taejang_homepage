const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../app/assets/payroll-engine.js');
const policy = require('../app/assets/payroll-weekly-holiday-policy.js');

const wrapped = policy.wrapEngine(engine);

function employee({ hiredAt = '2026-06-01', terminatedAt = null } = {}) {
  return { employeeId: 'TJ-TEST-POLICY', hiredAt, terminatedAt };
}

function term({ from = '2026-06-01', to = null, hours = 3, rate = 10000 } = {}) {
  return {
    employeeId: 'TJ-TEST-POLICY',
    effectiveFrom: from,
    effectiveTo: to,
    dailyScheduledHours: hours,
    hourlyRate: rate,
  };
}

function weekdayAttendance(start, end) {
  return engine.enumerateDates(start, end)
    .filter(engine.isWeekday)
    .map((date) => ({
      employeeId: 'TJ-TEST-POLICY',
      date: engine.dateKey(date),
      autoDecision: 'complete',
    }));
}

function calculateMonth({ worker = employee(), terms = [term()], attendanceStart = '2026-08-03' } = {}) {
  return wrapped.calculateProvisionalMonth({
    employee: worker,
    year: 2026,
    month: 8,
    cutoffDate: '2026-08-27',
    terms,
    holidays: [],
    attendanceRecords: weekdayAttendance(attendanceStart, '2026-08-27'),
  });
}

test('payroll month owns only workweeks whose Monday-Friday weekdays are inside the month', () => {
  assert.deepEqual(
    policy.weeksOwnedByPayrollMonth(engine, 2026, 7).map(engine.dateKey),
    ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27']
  );
  assert.deepEqual(
    policy.weeksOwnedByPayrollMonth(engine, 2026, 8).map(engine.dateKey),
    ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24']
  );
});

test('current workweek contract hours decide the 15-hour threshold for a recent hire', () => {
  const result = wrapped.calculateWeeklyHoliday({
    employee: employee({ hiredAt: '2026-08-11' }),
    weekStart: '2026-08-17',
    terms: [term({ from: '2026-08-11', hours: 3 })],
    holidays: [],
    attendanceRecords: weekdayAttendance('2026-08-17', '2026-08-21'),
    cutoffDate: '2026-08-21',
  });

  assert.equal(result.scheduledHours, 15);
  assert.equal(result.status, 'actual_eligible');
  assert.equal(result.payableHours, 3);
});

test('weekly holiday hours follow the current workweek schedule instead of a smoothed lookback', () => {
  const result = wrapped.calculateWeeklyHoliday({
    employee: employee(),
    weekStart: '2026-08-24',
    terms: [
      term({ from: '2026-06-01', to: '2026-08-23', hours: 3 }),
      term({ from: '2026-08-24', hours: 4 }),
    ],
    holidays: [],
    attendanceRecords: weekdayAttendance('2026-08-24', '2026-08-27'),
    cutoffDate: '2026-08-27',
  });

  assert.equal(result.scheduledHours, 20);
  assert.equal(result.status, 'expected_eligible');
  assert.equal(result.payableHours, 4);
});

test('constant three-hour schedule yields the four owned weekly holidays for August', () => {
  const result = calculateMonth();
  assert.equal(result.weeklyHolidayActualHours, 9);
  assert.equal(result.weeklyHolidayExpectedHours, 3);
  assert.equal(result.payableHoursPreview, 75);
});

test('Monday schedule change in the final owned week uses the new daily hours', () => {
  const result = calculateMonth({
    terms: [
      term({ from: '2026-06-01', to: '2026-08-23', hours: 3 }),
      term({ from: '2026-08-24', hours: 4 }),
    ],
  });
  assert.equal(result.weeklyHolidayActualHours, 9);
  assert.equal(result.weeklyHolidayExpectedHours, 4);
  assert.equal(result.payableHoursPreview, 82);
});

test('earlier Monday schedule change is reflected in each later weekly holiday', () => {
  const result = calculateMonth({
    terms: [
      term({ from: '2026-06-01', to: '2026-08-09', hours: 3 }),
      term({ from: '2026-08-10', hours: 4 }),
    ],
  });
  assert.equal(result.weeklyHolidayActualHours, 11);
  assert.equal(result.weeklyHolidayExpectedHours, 4);
  assert.equal(result.payableHoursPreview, 94);
});

test('recent hire receives eligible later workweeks without diluting them by a partial first week', () => {
  const result = calculateMonth({
    worker: employee({ hiredAt: '2026-08-11' }),
    terms: [term({ from: '2026-08-11', hours: 3 })],
    attendanceStart: '2026-08-11',
  });
  assert.equal(result.weeklyHolidayActualHours, 3);
  assert.equal(result.weeklyHolidayExpectedHours, 3);
  assert.equal(result.payableHoursPreview, 51);
});
