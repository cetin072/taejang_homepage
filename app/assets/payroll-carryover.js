(function initPayrollCarryover(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TaejangPayrollCarryover = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollCarryoverFactory() {
  'use strict';

  function hours(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function hourlyRate(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function adjustmentId(employeeId, sourceMonth, sourceDate, category) {
    return `${employeeId}|${sourceMonth}|${sourceDate}|${category}`;
  }

  function assertResolvedResult(result, employeeId) {
    if (!result) {
      const error = new Error(`final_employee_result_missing:${employeeId}`);
      error.code = 'final_reconciliation_incomplete';
      error.employeeId = employeeId;
      throw error;
    }

    const unresolvedDay = (result.dayRows || []).find((row) => hours(row && row.payableHours) === null);
    if (unresolvedDay) {
      const error = new Error(`final_day_unresolved:${employeeId}:${unresolvedDay.date || ''}`);
      error.code = 'final_reconciliation_incomplete';
      error.employeeId = employeeId;
      error.date = unresolvedDay.date || null;
      throw error;
    }

    const unresolvedWeek = (result.weeklyHoliday && result.weeklyHoliday.weeks || [])
      .find((week) => hours(week && week.payableHours) === null);
    if (unresolvedWeek) {
      const error = new Error(`final_weekly_holiday_unresolved:${employeeId}:${unresolvedWeek.weekEnd || ''}`);
      error.code = 'final_reconciliation_incomplete';
      error.employeeId = employeeId;
      error.date = unresolvedWeek.weekEnd || null;
      throw error;
    }
  }

  function buildDayAdjustments({ employeeId, sourceMonth, provisionalRows, finalRows }) {
    const provisional = new Map((provisionalRows || []).map((row) => [row.date, row]));
    const final = new Map((finalRows || []).map((row) => [row.date, row]));
    const dates = new Set([...provisional.keys(), ...final.keys()]);
    const adjustments = [];

    for (const date of [...dates].sort()) {
      const before = hours(provisional.get(date) && provisional.get(date).payableHours);
      const after = hours(final.get(date) && final.get(date).payableHours);
      if (before === null || after === null) {
        const error = new Error(`carryover_day_unresolved:${employeeId}:${date}`);
        error.code = 'final_reconciliation_incomplete';
        error.employeeId = employeeId;
        error.date = date;
        throw error;
      }
      const difference = after - before;
      if (difference === 0) continue;
      adjustments.push({
        adjustmentId: adjustmentId(employeeId, sourceMonth, date, 'work-hours'),
        employeeId,
        sourceMonth,
        sourceDate: date,
        category: 'work_hours',
        beforeHours: before,
        afterHours: after,
        differenceHours: difference,
        status: 'pending_next_month',
      });
    }

    return adjustments;
  }

  function weekKey(week) {
    return String(week && (week.weekEnd || week.weekStart) || '');
  }

  function buildWeeklyHolidayAdjustments({ employeeId, sourceMonth, provisionalWeeks, finalWeeks }) {
    const provisional = new Map((provisionalWeeks || []).map((week) => [weekKey(week), week]));
    const final = new Map((finalWeeks || []).map((week) => [weekKey(week), week]));
    const weeks = new Set([...provisional.keys(), ...final.keys()]);
    const adjustments = [];

    for (const key of [...weeks].filter(Boolean).sort()) {
      const before = hours(provisional.get(key) && provisional.get(key).payableHours);
      const after = hours(final.get(key) && final.get(key).payableHours);
      if (before === null || after === null) {
        const error = new Error(`carryover_weekly_holiday_unresolved:${employeeId}:${key}`);
        error.code = 'final_reconciliation_incomplete';
        error.employeeId = employeeId;
        error.date = key;
        throw error;
      }
      const difference = after - before;
      if (difference === 0) continue;
      adjustments.push({
        adjustmentId: adjustmentId(employeeId, sourceMonth, key, 'weekly-holiday'),
        employeeId,
        sourceMonth,
        sourceDate: key,
        category: 'weekly_holiday',
        beforeHours: before,
        afterHours: after,
        differenceHours: difference,
        status: 'pending_next_month',
      });
    }

    return adjustments;
  }

  function authoritativeSourceRate(provisionalResult, finalResult) {
    const provisionalRate = hourlyRate(provisionalResult && provisionalResult.hourlyRate);
    const finalRate = hourlyRate(finalResult && finalResult.hourlyRate);
    const provisionalStatus = String(provisionalResult && provisionalResult.rateStatus || '').trim();
    const finalStatus = String(finalResult && finalResult.rateStatus || '').trim();

    if (
      provisionalStatus !== 'single_rate'
      || finalStatus !== 'single_rate'
      || provisionalRate === null
      || finalRate === null
      || provisionalRate !== finalRate
    ) {
      return {
        amountStatus: 'review_required',
        sourceHourlyRate: null,
      };
    }

    return {
      amountStatus: 'ready',
      sourceHourlyRate: provisionalRate,
    };
  }

  function attachMoney(adjustment, rateMeta) {
    if (!rateMeta || rateMeta.amountStatus !== 'ready' || rateMeta.sourceHourlyRate === null) {
      return {
        ...adjustment,
        sourceHourlyRate: null,
        differenceAmount: null,
        amountStatus: 'review_required',
      };
    }

    return {
      ...adjustment,
      sourceHourlyRate: rateMeta.sourceHourlyRate,
      differenceAmount: Math.round(Number(adjustment.differenceHours) * rateMeta.sourceHourlyRate),
      amountStatus: 'ready',
    };
  }

  function buildEmployeeCarryover({ employeeId, sourceMonth, provisionalResult, finalResult }) {
    assertResolvedResult(provisionalResult, employeeId);
    assertResolvedResult(finalResult, employeeId);

    const rateMeta = authoritativeSourceRate(provisionalResult, finalResult);
    const adjustments = [
      ...buildDayAdjustments({
        employeeId,
        sourceMonth,
        provisionalRows: provisionalResult.dayRows || [],
        finalRows: finalResult.dayRows || [],
      }),
      ...buildWeeklyHolidayAdjustments({
        employeeId,
        sourceMonth,
        provisionalWeeks: provisionalResult.weeklyHoliday && provisionalResult.weeklyHoliday.weeks || [],
        finalWeeks: finalResult.weeklyHoliday && finalResult.weeklyHoliday.weeks || [],
      }),
    ];

    return adjustments.map((adjustment) => attachMoney(adjustment, rateMeta));
  }

  function buildMonthCarryover({ sourceMonth, provisionalRun, finalEmployeeResults }) {
    const finalByEmployee = Array.isArray(finalEmployeeResults)
      ? Object.fromEntries(finalEmployeeResults.map((row) => [row.employeeId, row]))
      : (finalEmployeeResults || {});
    const adjustments = [];

    for (const provisionalResult of provisionalRun && provisionalRun.employees || []) {
      const employeeId = provisionalResult.employeeId;
      adjustments.push(...buildEmployeeCarryover({
        employeeId,
        sourceMonth,
        provisionalResult,
        finalResult: finalByEmployee[employeeId],
      }));
    }

    return adjustments;
  }

  return Object.freeze({
    hours,
    hourlyRate,
    assertResolvedResult,
    buildDayAdjustments,
    buildWeeklyHolidayAdjustments,
    authoritativeSourceRate,
    attachMoney,
    buildEmployeeCarryover,
    buildMonthCarryover,
  });
});
