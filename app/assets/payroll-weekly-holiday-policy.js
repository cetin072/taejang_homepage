(function initPayrollWeeklyHolidayPolicy(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaejangPayrollWeeklyHolidayPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollWeeklyHolidayPolicyFactory() {
  'use strict';

  function roundHours(value) {
    return Math.round(Number(value || 0) * 1000000) / 1000000;
  }

  function requireEngine(engine) {
    const required = [
      'monthBounds', 'startOfWeekMonday', 'endOfWeekSunday', 'addDays', 'compareDate',
      'dateKey', 'enumerateDates', 'isWeekday', 'indexAttendance', 'resolvePayableDay',
      'employeeHasFullWeekRelationship', 'calculateProvisionalMonth',
    ];
    for (const name of required) {
      if (!engine || typeof engine[name] !== 'function') {
        throw new Error(`PAYROLL_WEEKLY_POLICY_ENGINE_MISSING:${name}`);
      }
    }
    return engine;
  }

  // Payroll-month ownership follows the Monday-Friday workweek. A week belongs to
  // the month only when all five standard weekdays fall inside that month.
  function weeksOwnedByPayrollMonth(engineInput, year, month) {
    const engine = requireEngine(engineInput);
    const { start, end } = engine.monthBounds(year, month);
    let monday = engine.startOfWeekMonday(start);
    if (engine.compareDate(monday, start) < 0) monday = engine.addDays(monday, 7);

    const weeks = [];
    for (; engine.compareDate(monday, end) <= 0; monday = engine.addDays(monday, 7)) {
      const friday = engine.addDays(monday, 4);
      if (engine.compareDate(friday, end) <= 0) weeks.push(monday);
    }
    return weeks;
  }

  function calculateWeeklyHoliday(engineInput, {
    employee,
    weekStart,
    terms,
    holidays,
    attendanceRecords,
    cutoffDate,
  }) {
    const engine = requireEngine(engineInput);
    const monday = engine.startOfWeekMonday(weekStart);
    const sunday = engine.endOfWeekSunday(monday);
    const weekDates = engine.enumerateDates(monday, sunday);
    const attendanceMap = engine.indexAttendance(attendanceRecords);

    if (!engine.employeeHasFullWeekRelationship(employee, monday)) {
      return {
        employeeId: employee.employeeId,
        weekStart: engine.dateKey(monday),
        weekEnd: engine.dateKey(sunday),
        scheduledHours: 0,
        holidayHoursCandidate: 0,
        averageWeeklyScheduledHours: 0,
        status: 'not_eligible_relationship',
        payableHours: 0,
        unresolvedDates: [],
      };
    }

    const weekdayRows = weekDates
      .filter(engine.isWeekday)
      .map((date) => engine.resolvePayableDay({
        employee,
        date,
        terms,
        holidays,
        attendanceMap,
        cutoffDate,
      }));

    const scheduledHours = roundHours(
      weekdayRows.reduce((sum, row) => sum + (Number(row.scheduledHours) || 0), 0)
    );
    const scheduledDays = weekdayRows.filter((row) => Number(row.scheduledHours) > 0).length;
    const holidayHoursCandidate = scheduledDays > 0
      ? roundHours(scheduledHours / scheduledDays)
      : 0;
    const unresolvedDates = weekdayRows
      .filter((row) => row.kind === engine.DayValueKind.UNRESOLVED)
      .map((row) => row.date)
      .sort();

    const weekMeta = {
      employeeId: employee.employeeId,
      weekStart: engine.dateKey(monday),
      weekEnd: engine.dateKey(sunday),
      scheduledHours,
      holidayHoursCandidate,
      averageWeeklyScheduledHours: scheduledHours,
    };

    if (unresolvedDates.length > 0) {
      return {
        ...weekMeta,
        status: 'pending_attendance',
        payableHours: null,
        unresolvedDates,
      };
    }

    const threshold = Number(engine.WEEKLY_HOLIDAY_THRESHOLD_HOURS || 15);
    if (scheduledHours < threshold) {
      return {
        ...weekMeta,
        status: 'not_eligible_under_15_hours',
        payableHours: 0,
        unresolvedDates: [],
      };
    }

    const hasAbsence = weekdayRows.some(
      (row) => row.attendanceState === engine.AttendanceState.UNPAID_ABSENCE
    );
    if (hasAbsence) {
      return {
        ...weekMeta,
        status: 'not_eligible_absence',
        payableHours: 0,
        unresolvedDates: [],
      };
    }

    const hasExpected = weekdayRows.some((row) => row.kind === engine.DayValueKind.EXPECTED);
    return {
      ...weekMeta,
      status: hasExpected ? 'expected_eligible' : 'actual_eligible',
      payableHours: holidayHoursCandidate,
      unresolvedDates: [],
    };
  }

  function calculateMonthlyWeeklyHoliday(engineInput, {
    employee,
    year,
    month,
    terms,
    holidays,
    attendanceRecords,
    cutoffDate,
  }) {
    const engine = requireEngine(engineInput);
    const weekly = weeksOwnedByPayrollMonth(engine, year, month).map((weekStart) =>
      calculateWeeklyHoliday(engine, {
        employee,
        weekStart,
        terms,
        holidays,
        attendanceRecords,
        cutoffDate,
      })
    );

    return {
      employeeId: employee.employeeId,
      year,
      month,
      weeks: weekly,
      actualHours: weekly
        .filter((week) => week.status === 'actual_eligible')
        .reduce((sum, week) => sum + Number(week.payableHours || 0), 0),
      expectedHours: weekly
        .filter((week) => week.status === 'expected_eligible')
        .reduce((sum, week) => sum + Number(week.payableHours || 0), 0),
      pendingWeeks: weekly.filter((week) => week.status === 'pending_attendance').length,
    };
  }

  function calculateProvisionalMonth(engineInput, args) {
    const engine = requireEngine(engineInput);
    const base = engine.calculateProvisionalMonth(args);
    const weeklyHoliday = calculateMonthlyWeeklyHoliday(engine, args);
    const payableHoursPreview = Number(base.actualWorkHours || 0)
      + Number(base.expectedWorkHours || 0)
      + Number(base.paidHolidayHours || 0)
      + Number(weeklyHoliday.actualHours || 0)
      + Number(weeklyHoliday.expectedHours || 0);
    const grossPayPreview = base.rateStatus === 'single_rate' && base.hourlyRate != null
      ? Math.round(payableHoursPreview * Number(base.hourlyRate))
      : base.grossPayPreview;

    return {
      ...base,
      weeklyHolidayActualHours: weeklyHoliday.actualHours,
      weeklyHolidayExpectedHours: weeklyHoliday.expectedHours,
      weeklyHolidayPendingWeeks: weeklyHoliday.pendingWeeks,
      payableHoursPreview,
      grossPayPreview,
      weeklyHoliday,
    };
  }

  function wrapEngine(engineInput) {
    const engine = requireEngine(engineInput);
    return Object.freeze({
      ...engine,
      weeksOwnedByPayrollMonth: (year, month) => weeksOwnedByPayrollMonth(engine, year, month),
      calculateWeeklyHoliday: (args) => calculateWeeklyHoliday(engine, args),
      calculateMonthlyWeeklyHoliday: (args) => calculateMonthlyWeeklyHoliday(engine, args),
      calculateProvisionalMonth: (args) => calculateProvisionalMonth(engine, args),
    });
  }

  return Object.freeze({
    weeksOwnedByPayrollMonth,
    calculateWeeklyHoliday,
    calculateMonthlyWeeklyHoliday,
    calculateProvisionalMonth,
    wrapEngine,
  });
});
