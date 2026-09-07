(function initTaejangPayrollEngine(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TaejangPayrollEngine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollEngineFactory() {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEKLY_HOLIDAY_THRESHOLD_HOURS = 15;

  const AttendanceState = Object.freeze({
    COMPLETE: 'complete',
    PAID_LEAVE: 'paid_leave',
    UNPAID_ABSENCE: 'unpaid_absence',
    PAID_HOLIDAY: 'paid_holiday',
    MANUAL_CONFIRMED: 'manual_confirmed',
    MISSING: 'missing',
    NOT_APPLICABLE: 'not_applicable',
  });

  const DayValueKind = Object.freeze({
    ACTUAL: 'actual',
    EXPECTED: 'expected',
    HOLIDAY: 'holiday',
    NOT_APPLICABLE: 'not_applicable',
    UNRESOLVED: 'unresolved',
  });

  const MonthStatus = Object.freeze({
    DRAFT: 'draft',
    PROVISIONAL: 'provisional',
    READY: 'ready',
    LOCKED: 'locked',
  });

  function asDate(value) {
    if (value instanceof Date) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0);
    }
    if (typeof value === 'string') {
      const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) throw new Error(`Invalid ISO date: ${value}`);
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
    }
    throw new Error(`Unsupported date value: ${value}`);
  }

  function dateKey(value) {
    const date = asDate(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function addDays(value, amount) {
    const date = asDate(value);
    date.setDate(date.getDate() + amount);
    return date;
  }

  function compareDate(a, b) {
    return dateKey(a).localeCompare(dateKey(b));
  }

  function startOfWeekMonday(value) {
    const date = asDate(value);
    const day = date.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    return addDays(date, offset);
  }

  function endOfWeekSunday(value) {
    return addDays(startOfWeekMonday(value), 6);
  }

  function monthBounds(year, month) {
    const start = new Date(year, month - 1, 1, 12, 0, 0, 0);
    const end = new Date(year, month, 0, 12, 0, 0, 0);
    return { start, end };
  }

  function enumerateDates(startValue, endValue) {
    const start = asDate(startValue);
    const end = asDate(endValue);
    const dates = [];
    for (let cursor = start; compareDate(cursor, end) <= 0; cursor = addDays(cursor, 1)) {
      dates.push(cursor);
    }
    return dates;
  }

  function isWeekday(value) {
    const day = asDate(value).getDay();
    return day >= 1 && day <= 5;
  }

  function normalizeOptionalDate(value) {
    if (!value) return null;
    return asDate(value);
  }

  function isEmployeeActiveOn(employee, dateValue) {
    const date = asDate(dateValue);
    const hiredAt = normalizeOptionalDate(employee.hiredAt || employee.hireDate);
    const terminatedAt = normalizeOptionalDate(employee.terminatedAt || employee.terminationDate);
    if (!hiredAt) return false;
    if (compareDate(date, hiredAt) < 0) return false;
    if (terminatedAt && compareDate(date, terminatedAt) > 0) return false;
    return true;
  }

  function applicableEmploymentTerm(employeeId, dateValue, terms) {
    const date = asDate(dateValue);
    const candidates = (terms || [])
      .filter((term) => term.employeeId === employeeId)
      .filter((term) => compareDate(term.effectiveFrom, date) <= 0)
      .filter((term) => !term.effectiveTo || compareDate(term.effectiveTo, date) >= 0)
      .sort((a, b) => compareDate(b.effectiveFrom, a.effectiveFrom));
    return candidates[0] || null;
  }

  function scheduledHoursForDate(employee, dateValue, terms) {
    if (!isEmployeeActiveOn(employee, dateValue)) return 0;
    const term = applicableEmploymentTerm(employee.employeeId, dateValue, terms);
    if (!term) return null;
    const hours = Number(term.dailyScheduledHours);
    if (!Number.isFinite(hours) || hours < 0) return null;
    return hours;
  }

  function hourlyRateForDate(employee, dateValue, terms) {
    if (!isEmployeeActiveOn(employee, dateValue)) return null;
    const term = applicableEmploymentTerm(employee.employeeId, dateValue, terms);
    if (!term || term.hourlyRate === undefined || term.hourlyRate === null || term.hourlyRate === '') {
      return null;
    }
    const rate = Number(term.hourlyRate);
    return Number.isFinite(rate) && rate >= 0 ? rate : null;
  }

  function holidayForDate(dateValue, holidays) {
    const key = dateKey(dateValue);
    return (holidays || []).find((holiday) => dateKey(holiday.date) === key) || null;
  }

  function isPaidHoliday(dateValue, holidays) {
    const holiday = holidayForDate(dateValue, holidays);
    return Boolean(holiday && holiday.paid !== false);
  }

  function attendanceKey(employeeId, dateValue) {
    return `${employeeId}|${dateKey(dateValue)}`;
  }

  function indexAttendance(records) {
    const map = new Map();
    (records || []).forEach((record) => {
      if (!record || !record.employeeId || !record.date) return;
      map.set(attendanceKey(record.employeeId, record.date), record);
    });
    return map;
  }

  function classifyAttendanceRecord(record) {
    if (!record) return AttendanceState.MISSING;
    if (record.reviewStatus === 'confirmed' && Number.isFinite(Number(record.confirmedHours))) {
      return AttendanceState.MANUAL_CONFIRMED;
    }

    const decision = String(record.autoDecision || record.state || record.status || '').trim();
    if (decision === '기록완전' || decision === 'complete' || decision === 'normal') {
      return AttendanceState.COMPLETE;
    }
    if (decision === '원본_유급월차' || decision === 'paid_leave' || decision === '월차(유급)') {
      return AttendanceState.PAID_LEAVE;
    }
    if (decision === '원본_무급결근' || decision === 'unpaid_absence' || /결근/.test(decision)) {
      return AttendanceState.UNPAID_ABSENCE;
    }
    if (decision === '원본_유급휴일' || decision === 'paid_holiday' || /공휴일/.test(decision)) {
      return AttendanceState.PAID_HOLIDAY;
    }
    if (decision === '대상아님' || decision === 'not_applicable') {
      return AttendanceState.NOT_APPLICABLE;
    }
    return AttendanceState.MISSING;
  }

  function resolvePayableDay({ employee, date, terms, holidays, attendanceMap, cutoffDate }) {
    const scheduledHours = scheduledHoursForDate(employee, date, terms);
    if (scheduledHours === 0) {
      return {
        employeeId: employee.employeeId,
        date: dateKey(date),
        kind: DayValueKind.NOT_APPLICABLE,
        attendanceState: AttendanceState.NOT_APPLICABLE,
        scheduledHours: 0,
        payableHours: 0,
      };
    }
    if (scheduledHours === null) {
      return {
        employeeId: employee.employeeId,
        date: dateKey(date),
        kind: DayValueKind.UNRESOLVED,
        attendanceState: AttendanceState.MISSING,
        scheduledHours: null,
        payableHours: null,
        reason: 'employment_term_missing',
      };
    }

    if (isPaidHoliday(date, holidays) && isWeekday(date)) {
      return {
        employeeId: employee.employeeId,
        date: dateKey(date),
        kind: DayValueKind.HOLIDAY,
        attendanceState: AttendanceState.PAID_HOLIDAY,
        scheduledHours,
        payableHours: scheduledHours,
      };
    }

    const record = attendanceMap.get(attendanceKey(employee.employeeId, date));
    const attendanceState = classifyAttendanceRecord(record);

    if (attendanceState === AttendanceState.MANUAL_CONFIRMED) {
      return {
        employeeId: employee.employeeId,
        date: dateKey(date),
        kind: DayValueKind.ACTUAL,
        attendanceState,
        scheduledHours,
        payableHours: Number(record.confirmedHours),
      };
    }

    if (attendanceState === AttendanceState.COMPLETE || attendanceState === AttendanceState.PAID_LEAVE) {
      return {
        employeeId: employee.employeeId,
        date: dateKey(date),
        kind: DayValueKind.ACTUAL,
        attendanceState,
        scheduledHours,
        payableHours: scheduledHours,
      };
    }

    if (attendanceState === AttendanceState.UNPAID_ABSENCE) {
      return {
        employeeId: employee.employeeId,
        date: dateKey(date),
        kind: DayValueKind.ACTUAL,
        attendanceState,
        scheduledHours,
        payableHours: 0,
      };
    }

    const cutoff = cutoffDate ? asDate(cutoffDate) : null;
    if (cutoff && compareDate(date, cutoff) > 0) {
      return {
        employeeId: employee.employeeId,
        date: dateKey(date),
        kind: DayValueKind.EXPECTED,
        attendanceState: AttendanceState.MISSING,
        scheduledHours,
        payableHours: scheduledHours,
      };
    }

    return {
      employeeId: employee.employeeId,
      date: dateKey(date),
      kind: DayValueKind.UNRESOLVED,
      attendanceState,
      scheduledHours,
      payableHours: null,
      reason: 'attendance_missing_or_unconfirmed',
    };
  }

  function employeeHasFullWeekRelationship(employee, weekStartValue) {
    const weekStart = asDate(weekStartValue);
    const weekEnd = endOfWeekSunday(weekStart);
    return isEmployeeActiveOn(employee, weekStart) && isEmployeeActiveOn(employee, weekEnd);
  }

  function calculateWeeklyHoliday({ employee, weekStart, terms, holidays, attendanceRecords, cutoffDate }) {
    const monday = startOfWeekMonday(weekStart);
    const sunday = endOfWeekSunday(monday);
    const weekDates = enumerateDates(monday, sunday);
    const attendanceMap = indexAttendance(attendanceRecords);

    if (!employeeHasFullWeekRelationship(employee, monday)) {
      return {
        employeeId: employee.employeeId,
        weekStart: dateKey(monday),
        weekEnd: dateKey(sunday),
        scheduledHours: 0,
        holidayHoursCandidate: 0,
        status: 'not_eligible_relationship',
        payableHours: 0,
        unresolvedDates: [],
      };
    }

    const weekdayRows = weekDates
      .filter(isWeekday)
      .map((date) => resolvePayableDay({
        employee,
        date,
        terms,
        holidays,
        attendanceMap,
        cutoffDate,
      }));

    const scheduledHours = weekdayRows.reduce((sum, row) => sum + (Number(row.scheduledHours) || 0), 0);
    const sundayTermHours = scheduledHoursForDate(employee, sunday, terms);
    const fallbackHours = weekdayRows
      .map((row) => Number(row.scheduledHours) || 0)
      .filter((hours) => hours > 0)
      .at(-1) || 0;
    const holidayHoursCandidate = Number(sundayTermHours) || fallbackHours;

    if (scheduledHours < WEEKLY_HOLIDAY_THRESHOLD_HOURS) {
      return {
        employeeId: employee.employeeId,
        weekStart: dateKey(monday),
        weekEnd: dateKey(sunday),
        scheduledHours,
        holidayHoursCandidate,
        status: 'not_eligible_under_15_hours',
        payableHours: 0,
        unresolvedDates: [],
      };
    }

    const hasAbsence = weekdayRows.some((row) => row.attendanceState === AttendanceState.UNPAID_ABSENCE);
    if (hasAbsence) {
      return {
        employeeId: employee.employeeId,
        weekStart: dateKey(monday),
        weekEnd: dateKey(sunday),
        scheduledHours,
        holidayHoursCandidate,
        status: 'not_eligible_absence',
        payableHours: 0,
        unresolvedDates: [],
      };
    }

    const unresolvedDates = weekdayRows
      .filter((row) => row.kind === DayValueKind.UNRESOLVED)
      .map((row) => row.date);

    if (unresolvedDates.length > 0) {
      return {
        employeeId: employee.employeeId,
        weekStart: dateKey(monday),
        weekEnd: dateKey(sunday),
        scheduledHours,
        holidayHoursCandidate,
        status: 'pending_attendance',
        payableHours: null,
        unresolvedDates,
      };
    }

    const hasExpected = weekdayRows.some((row) => row.kind === DayValueKind.EXPECTED);
    return {
      employeeId: employee.employeeId,
      weekStart: dateKey(monday),
      weekEnd: dateKey(sunday),
      scheduledHours,
      holidayHoursCandidate,
      status: hasExpected ? 'expected_eligible' : 'actual_eligible',
      payableHours: holidayHoursCandidate,
      unresolvedDates: [],
    };
  }

  function weeksWithSundayInMonth(year, month) {
    const { start, end } = monthBounds(year, month);
    const firstMonday = startOfWeekMonday(start);
    const weeks = [];
    for (let monday = firstMonday; compareDate(monday, end) <= 0; monday = addDays(monday, 7)) {
      const sunday = endOfWeekSunday(monday);
      if (sunday.getFullYear() === year && sunday.getMonth() + 1 === month) {
        weeks.push(monday);
      }
    }
    return weeks;
  }

  function calculateMonthlyWeeklyHoliday({ employee, year, month, terms, holidays, attendanceRecords, cutoffDate }) {
    const weekly = weeksWithSundayInMonth(year, month).map((weekStart) => calculateWeeklyHoliday({
      employee,
      weekStart,
      terms,
      holidays,
      attendanceRecords,
      cutoffDate,
    }));

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

  function calculateProvisionalMonth({ employee, year, month, cutoffDate, terms, holidays, attendanceRecords }) {
    const { start, end } = monthBounds(year, month);
    const attendanceMap = indexAttendance(attendanceRecords);
    const dayRows = enumerateDates(start, end)
      .filter(isWeekday)
      .map((date) => resolvePayableDay({ employee, date, terms, holidays, attendanceMap, cutoffDate }));

    const weeklyHoliday = calculateMonthlyWeeklyHoliday({
      employee,
      year,
      month,
      terms,
      holidays,
      attendanceRecords,
      cutoffDate,
    });

    const actualWorkHours = dayRows
      .filter((row) => row.kind === DayValueKind.ACTUAL)
      .reduce((sum, row) => sum + Number(row.payableHours || 0), 0);
    const expectedWorkHours = dayRows
      .filter((row) => row.kind === DayValueKind.EXPECTED)
      .reduce((sum, row) => sum + Number(row.payableHours || 0), 0);
    const paidHolidayHours = dayRows
      .filter((row) => row.kind === DayValueKind.HOLIDAY)
      .reduce((sum, row) => sum + Number(row.payableHours || 0), 0);
    const unresolved = dayRows.filter((row) => row.kind === DayValueKind.UNRESOLVED);

    const rates = new Set(dayRows
      .filter((row) => row.kind !== DayValueKind.NOT_APPLICABLE)
      .map((row) => hourlyRateForDate(employee, row.date, terms))
      .filter((rate) => rate !== null));

    const singleHourlyRate = rates.size === 1 ? [...rates][0] : null;
    const payableHoursPreview = actualWorkHours
      + expectedWorkHours
      + paidHolidayHours
      + weeklyHoliday.actualHours
      + weeklyHoliday.expectedHours;

    return {
      employeeId: employee.employeeId,
      year,
      month,
      cutoffDate: dateKey(cutoffDate),
      actualWorkHours,
      expectedWorkHours,
      paidHolidayHours,
      weeklyHolidayActualHours: weeklyHoliday.actualHours,
      weeklyHolidayExpectedHours: weeklyHoliday.expectedHours,
      weeklyHolidayPendingWeeks: weeklyHoliday.pendingWeeks,
      unresolvedCount: unresolved.length,
      unresolved,
      payableHoursPreview,
      hourlyRate: singleHourlyRate,
      grossPayPreview: singleHourlyRate === null ? null : Math.round(payableHoursPreview * singleHourlyRate),
      rateStatus: rates.size <= 1 ? 'single_rate' : 'multiple_rates_review_required',
      dayRows,
      weeklyHoliday,
    };
  }

  function buildCarryoverAdjustments({ employeeId, provisionalDayRows, finalDayRows, sourceMonth }) {
    const provisionalMap = new Map((provisionalDayRows || []).map((row) => [row.date, row]));
    const finalMap = new Map((finalDayRows || []).map((row) => [row.date, row]));
    const dates = new Set([...provisionalMap.keys(), ...finalMap.keys()]);
    const adjustments = [];

    [...dates].sort().forEach((date) => {
      const provisional = provisionalMap.get(date);
      const final = finalMap.get(date);
      const before = Number(provisional && provisional.payableHours);
      const after = Number(final && final.payableHours);
      const beforeValue = Number.isFinite(before) ? before : 0;
      const afterValue = Number.isFinite(after) ? after : 0;
      const difference = afterValue - beforeValue;
      if (difference === 0) return;
      adjustments.push({
        adjustmentId: `${employeeId}|${sourceMonth}|${date}|work-hours`,
        employeeId,
        sourceMonth,
        sourceDate: date,
        category: 'work_hours',
        beforeHours: beforeValue,
        afterHours: afterValue,
        differenceHours: difference,
        status: 'pending_next_month',
      });
    });

    return adjustments;
  }

  function evaluateMonthLock({ unresolvedImportantExceptions, accountingConfirmed, carryoverReviewed, alreadyLocked }) {
    if (alreadyLocked) {
      return { allowed: false, status: MonthStatus.LOCKED, blockers: ['already_locked'] };
    }

    const blockers = [];
    if (Number(unresolvedImportantExceptions || 0) > 0) blockers.push('important_exceptions_unresolved');
    if (!accountingConfirmed) blockers.push('accounting_values_unconfirmed');
    if (!carryoverReviewed) blockers.push('carryover_not_reviewed');

    return {
      allowed: blockers.length === 0,
      status: blockers.length === 0 ? MonthStatus.READY : MonthStatus.PROVISIONAL,
      blockers,
    };
  }

  return Object.freeze({
    AttendanceState,
    DayValueKind,
    MonthStatus,
    WEEKLY_HOLIDAY_THRESHOLD_HOURS,
    asDate,
    dateKey,
    addDays,
    compareDate,
    startOfWeekMonday,
    endOfWeekSunday,
    monthBounds,
    enumerateDates,
    isWeekday,
    isEmployeeActiveOn,
    applicableEmploymentTerm,
    scheduledHoursForDate,
    hourlyRateForDate,
    holidayForDate,
    isPaidHoliday,
    attendanceKey,
    indexAttendance,
    classifyAttendanceRecord,
    resolvePayableDay,
    employeeHasFullWeekRelationship,
    calculateWeeklyHoliday,
    weeksWithSundayInMonth,
    calculateMonthlyWeeklyHoliday,
    calculateProvisionalMonth,
    buildCarryoverAdjustments,
    evaluateMonthLock,
  });
});
