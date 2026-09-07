const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../app/assets/payroll-engine.js');

const holidays = [
  { date: '2026-09-24', name: '추석 전날', paid: true },
  { date: '2026-09-25', name: '추석', paid: true },
  { date: '2026-09-26', name: '추석 다음날', paid: true },
];

function employee(overrides = {}) {
  return {
    employeeId: 'TJ-TEST-0001',
    hiredAt: '2026-06-09',
    terminatedAt: null,
    ...overrides,
  };
}

function term({ from = '2026-06-09', to = null, hours = 3, rate = 10320 } = {}) {
  return {
    employeeId: 'TJ-TEST-0001',
    effectiveFrom: from,
    effectiveTo: to,
    dailyScheduledHours: hours,
    hourlyRate: rate,
  };
}

test('effective-dated terms switch exactly on the approved boundary', () => {
  const terms = [
    term({ from: '2026-06-09', to: '2026-08-23', hours: 3 }),
    term({ from: '2026-08-24', hours: 4 }),
  ];

  assert.equal(engine.scheduledHoursForDate(employee(), '2026-08-23', terms), 3);
  assert.equal(engine.scheduledHoursForDate(employee(), '2026-08-24', terms), 4);
});

test('weeks are Monday through Sunday and September 2026 contains four Sunday-owned weeks', () => {
  assert.equal(engine.dateKey(engine.startOfWeekMonday('2026-09-01')), '2026-08-31');
  assert.equal(engine.dateKey(engine.endOfWeekSunday('2026-09-01')), '2026-09-06');
  assert.deepEqual(
    engine.weeksWithSundayInMonth(2026, 9).map(engine.dateKey),
    ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21']
  );
});

test('3h and 4h workers reproduce September weekly-holiday Golden expectations', () => {
  const threeHour = engine.calculateMonthlyWeeklyHoliday({
    employee: employee(),
    year: 2026,
    month: 9,
    terms: [term({ hours: 3 })],
    holidays,
    attendanceRecords: [],
    cutoffDate: '2026-08-31',
  });

  const fourHour = engine.calculateMonthlyWeeklyHoliday({
    employee: employee(),
    year: 2026,
    month: 9,
    terms: [term({ hours: 4 })],
    holidays,
    attendanceRecords: [],
    cutoffDate: '2026-08-31',
  });

  assert.equal(threeHour.actualHours, 0);
  assert.equal(threeHour.expectedHours, 12);
  assert.equal(threeHour.pendingWeeks, 0);
  assert.equal(fourHour.expectedHours, 16);
});

test('paid Chuseok weekdays remain paid and do not break weekly attendance', () => {
  const result = engine.calculateProvisionalMonth({
    employee: employee(),
    year: 2026,
    month: 9,
    cutoffDate: '2026-08-31',
    terms: [term({ hours: 3 })],
    holidays,
    attendanceRecords: [],
  });

  assert.equal(result.expectedWorkHours, 60);
  assert.equal(result.paidHolidayHours, 6);
  assert.equal(result.weeklyHolidayExpectedHours, 12);
  assert.equal(result.payableHoursPreview, 78);
  assert.equal(result.hourlyRate, 10320);
  assert.equal(result.grossPayPreview, 804960);
});

test('employee terminated on Friday before weekly holiday is not eligible for that Sunday', () => {
  const result = engine.calculateWeeklyHoliday({
    employee: employee({ terminatedAt: '2026-09-04' }),
    weekStart: '2026-08-31',
    terms: [term({ hours: 3 })],
    holidays,
    attendanceRecords: [],
    cutoffDate: '2026-08-31',
  });

  assert.equal(result.status, 'not_eligible_relationship');
  assert.equal(result.payableHours, 0);
});

test('unpaid absence blocks weekly holiday while paid leave counts as fulfilled', () => {
  const attendanceRecords = [
    { employeeId: 'TJ-TEST-0001', date: '2026-09-07', autoDecision: '기록완전' },
    { employeeId: 'TJ-TEST-0001', date: '2026-09-08', autoDecision: '원본_유급월차' },
    { employeeId: 'TJ-TEST-0001', date: '2026-09-09', autoDecision: '원본_무급결근' },
    { employeeId: 'TJ-TEST-0001', date: '2026-09-10', autoDecision: '기록완전' },
    { employeeId: 'TJ-TEST-0001', date: '2026-09-11', autoDecision: '기록완전' },
  ];

  const result = engine.calculateWeeklyHoliday({
    employee: employee(),
    weekStart: '2026-09-07',
    terms: [term({ hours: 3 })],
    holidays,
    attendanceRecords,
    cutoffDate: '2026-09-11',
  });

  assert.equal(result.status, 'not_eligible_absence');
  assert.equal(result.payableHours, 0);
});

test('missing attendance on or before cutoff stays unresolved rather than being guessed', () => {
  const result = engine.calculateWeeklyHoliday({
    employee: employee(),
    weekStart: '2026-09-07',
    terms: [term({ hours: 3 })],
    holidays,
    attendanceRecords: [],
    cutoffDate: '2026-09-11',
  });

  assert.equal(result.status, 'pending_attendance');
  assert.deepEqual(result.unresolvedDates, [
    '2026-09-07',
    '2026-09-08',
    '2026-09-09',
    '2026-09-10',
    '2026-09-11',
  ]);
});

test('confirmed manual correction overrides scheduled hours without using clock-span arithmetic', () => {
  const attendanceMap = engine.indexAttendance([
    {
      employeeId: 'TJ-TEST-0001',
      date: '2026-09-07',
      reviewStatus: 'confirmed',
      confirmedHours: 2,
      clockIn: '10:27',
      clockOut: '12:00',
    },
  ]);

  const day = engine.resolvePayableDay({
    employee: employee(),
    date: '2026-09-07',
    terms: [term({ hours: 3 })],
    holidays,
    attendanceMap,
    cutoffDate: '2026-09-07',
  });

  assert.equal(day.attendanceState, engine.AttendanceState.MANUAL_CONFIRMED);
  assert.equal(day.payableHours, 2);
});

test('carryover adjustment records only differences between provisional and final day values', () => {
  const adjustments = engine.buildCarryoverAdjustments({
    employeeId: 'TJ-TEST-0001',
    sourceMonth: '2026-09',
    provisionalDayRows: [
      { date: '2026-09-28', payableHours: 3 },
      { date: '2026-09-29', payableHours: 3 },
    ],
    finalDayRows: [
      { date: '2026-09-28', payableHours: 0 },
      { date: '2026-09-29', payableHours: 3 },
    ],
  });

  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].sourceDate, '2026-09-28');
  assert.equal(adjustments[0].differenceHours, -3);
  assert.equal(adjustments[0].status, 'pending_next_month');
});

test('month lock is blocked until important exceptions, accounting and carryover are cleared', () => {
  const blocked = engine.evaluateMonthLock({
    unresolvedImportantExceptions: 2,
    accountingConfirmed: false,
    carryoverReviewed: false,
    alreadyLocked: false,
  });
  assert.equal(blocked.allowed, false);
  assert.deepEqual(blocked.blockers, [
    'important_exceptions_unresolved',
    'accounting_values_unconfirmed',
    'carryover_not_reviewed',
  ]);

  const ready = engine.evaluateMonthLock({
    unresolvedImportantExceptions: 0,
    accountingConfirmed: true,
    carryoverReviewed: true,
    alreadyLocked: false,
  });
  assert.equal(ready.allowed, true);
  assert.equal(ready.status, engine.MonthStatus.READY);
});

test('multiple hourly rates require review instead of silently choosing one rate', () => {
  const terms = [
    term({ from: '2026-06-09', to: '2026-09-14', hours: 3, rate: 10320 }),
    term({ from: '2026-09-15', hours: 3, rate: 11000 }),
  ];

  const result = engine.calculateProvisionalMonth({
    employee: employee(),
    year: 2026,
    month: 9,
    cutoffDate: '2026-08-31',
    terms,
    holidays,
    attendanceRecords: [],
  });

  assert.equal(result.rateStatus, 'multiple_rates_review_required');
  assert.equal(result.hourlyRate, null);
  assert.equal(result.grossPayPreview, null);
});
