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
      'dateKey', 'enumerateDates', 'isWeekday', 'indexAttendance', 'resolvePayableDay', 'weeksWithSundayInMonth',
      'employeeHasFullWeekRelationship', 'calculateProvisionalMonth',
    ];
    for (const name of required) {
      if (!engine || typeof engine[name] !== 'function') {
        throw new Error(`PAYROLL_WEEKLY_POLICY_ENGINE_MISSING:${name}`);
      }
    }
    return engine;
  }

  // The approved operating rule owns a continuous Monday-Sunday week by the
  // Sunday it contains. A payroll-month boundary never splits that week.
  function weeksOwnedByPayrollMonth(engineInput, year, month) {
    const engine = requireEngine(engineInput);
    return engine.weeksWithSundayInMonth(year, month);
  }

  function calculateWeeklyHoliday(engineInput, {
    employee,
    weekStart,
    terms,
    holidays,
    attendanceRecords,
    cutoffDate,
    projectionMode,
    forecastFutureSunday,
    holdFutureSunday,
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

    // In earned-to-date mode, later weeks have not started at the supplied
    // cutoff. They are neither an absence nor a pending exception.
    if (holdFutureSunday === true && cutoffDate && engine.compareDate(monday, cutoffDate) > 0) {
      return {
        ...weekMeta,
        status: 'not_started_after_cutoff',
        payableHours: 0,
        unresolvedDates: [],
      };
    }

    // The current week cannot become a final Sunday-paid week before that
    // Sunday exists in the payroll cutoff. Keep its facts visible but do not
    // turn a Friday snapshot into an earned weekly holiday.
    if (holdFutureSunday === true && cutoffDate && engine.compareDate(sunday, cutoffDate) > 0) {
      return {
        ...weekMeta,
        status: 'pending_current_week',
        payableHours: null,
        unresolvedDates: [],
      };
    }

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

    const hasExpected = weekdayRows.some((row) => row.kind === engine.DayValueKind.EXPECTED)
      || ((forecastFutureSunday === true || projectionMode === 'forecast')
        && cutoffDate && engine.compareDate(sunday, cutoffDate) > 0);
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
    projectionMode,
    forecastFutureSunday,
    holdFutureSunday,
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
        forecastFutureSunday: forecastFutureSunday === true || projectionMode === 'forecast',
        holdFutureSunday: holdFutureSunday === true || projectionMode === 'earned_to_date',
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
      pendingWeeks: weekly.filter((week) => (
        week.status === 'pending_attendance' || week.status === 'pending_current_week'
      )).length,
    };
  }

  function calculateProvisionalMonth(engineInput, args) {
    const engine = requireEngine(engineInput);
    const base = engine.calculateProvisionalMonth(args);
    const weeklyHoliday = calculateMonthlyWeeklyHoliday(engine, args);
    const earnedToDate = args.projectionMode === 'earned_to_date';
    const cutoffDate = args.cutoffDate || null;
    const earnedRows = earnedToDate && cutoffDate
      ? (base.dayRows || []).filter((row) => engine.compareDate(row.date, cutoffDate) <= 0)
      : (base.dayRows || []);
    const actualWorkHours = earnedToDate
      ? earnedRows
        .filter((row) => row.kind === engine.DayValueKind.ACTUAL)
        .reduce((sum, row) => sum + Number(row.payableHours || 0), 0)
      : Number(base.actualWorkHours || 0);
    const expectedWorkHours = earnedToDate
      ? 0
      : Number(base.expectedWorkHours || 0);
    const paidHolidayHours = earnedToDate
      ? earnedRows
        .filter((row) => row.kind === engine.DayValueKind.HOLIDAY)
        .reduce((sum, row) => sum + Number(row.payableHours || 0), 0)
      : Number(base.paidHolidayHours || 0);
    const payableHoursPreview = Number(actualWorkHours || 0)
      + Number(expectedWorkHours || 0)
      + Number(paidHolidayHours || 0)
      + Number(weeklyHoliday.actualHours || 0)
      + Number(weeklyHoliday.expectedHours || 0);
    const grossPayPreview = base.rateStatus === 'single_rate' && base.hourlyRate != null
      ? Math.round(payableHoursPreview * Number(base.hourlyRate))
      : base.grossPayPreview;

    return {
      ...base,
      projectionMode: earnedToDate ? 'earned_to_date' : 'forecast',
      actualWorkHours,
      expectedWorkHours,
      paidHolidayHours,
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
