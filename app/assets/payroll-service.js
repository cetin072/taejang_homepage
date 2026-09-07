(function initPayrollService(root, factory) {
  let engine = root && root.TaejangPayrollEngine;
  let repositoryApi = root && root.TaejangPayrollRepository;

  if (typeof module !== 'undefined' && module.exports) {
    engine = require('./payroll-engine.js');
    repositoryApi = require('./payroll-repository.js');
    module.exports = factory(engine, repositoryApi);
    return;
  }

  if (root) {
    root.TaejangPayrollService = factory(engine, repositoryApi);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollServiceFactory(engine, repositoryApi) {
  'use strict';

  if (!engine) throw new Error('TaejangPayrollEngine is required.');
  if (!repositoryApi) throw new Error('TaejangPayrollRepository is required.');

  const CALCULATION_VERSION = 'payroll-engine-v1';

  function nowIso(clock) {
    const value = clock ? clock() : new Date();
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  function buildRunId(month, generatedAt) {
    return `${month}|${generatedAt.replace(/[:.]/g, '-')}`;
  }

  function parseMonth(monthValue) {
    const month = repositoryApi.normalizeMonth(monthValue);
    const [year, monthNumber] = month.split('-').map(Number);
    return { month, year, monthNumber };
  }

  function safeSum(rows, key) {
    return (rows || []).reduce((sum, row) => {
      const value = Number(row && row[key]);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  }

  function buildPersistedEmployeeResult(result) {
    return {
      employeeId: result.employeeId,
      actualWorkHours: result.actualWorkHours,
      expectedWorkHours: result.expectedWorkHours,
      paidHolidayHours: result.paidHolidayHours,
      weeklyHolidayActualHours: result.weeklyHolidayActualHours,
      weeklyHolidayExpectedHours: result.weeklyHolidayExpectedHours,
      weeklyHolidayPendingWeeks: result.weeklyHolidayPendingWeeks,
      unresolvedCount: result.unresolvedCount,
      payableHoursPreview: result.payableHoursPreview,
      hourlyRate: result.hourlyRate,
      grossPayPreview: result.grossPayPreview,
      rateStatus: result.rateStatus,
      unresolved: (result.unresolved || []).map((item) => ({
        date: item.date,
        reason: item.reason || 'review_required',
      })),
      weeklyHoliday: {
        actualHours: result.weeklyHoliday.actualHours,
        expectedHours: result.weeklyHoliday.expectedHours,
        pendingWeeks: result.weeklyHoliday.pendingWeeks,
        weeks: (result.weeklyHoliday.weeks || []).map((week) => ({
          weekStart: week.weekStart,
          weekEnd: week.weekEnd,
          status: week.status,
          payableHours: week.payableHours,
          scheduledHours: week.scheduledHours,
          holidayHoursCandidate: week.holidayHoursCandidate,
          unresolvedDates: week.unresolvedDates || [],
        })),
      },
    };
  }

  function createPayrollService({ repository, clock } = {}) {
    const store = repositoryApi.assertPayrollRepository(repository);

    async function calculateAndPersistProvisional({
      month: monthValue,
      cutoffDate,
      employees,
      terms,
      holidays,
      attendanceRecords,
    }) {
      const { month, year, monthNumber } = parseMonth(monthValue);
      if (!cutoffDate) throw new Error('cutoffDate is required.');

      const generatedAt = nowIso(clock);
      const employeeResults = (employees || []).map((employee) => engine.calculateProvisionalMonth({
        employee,
        year,
        month: monthNumber,
        cutoffDate,
        terms,
        holidays,
        attendanceRecords,
      }));

      const persistedResults = employeeResults.map(buildPersistedEmployeeResult);
      const summary = {
        employeeCount: persistedResults.length,
        unresolvedEmployeeCount: persistedResults.filter((row) => row.unresolvedCount > 0).length,
        unresolvedItemCount: safeSum(persistedResults, 'unresolvedCount'),
        multiRateReviewCount: persistedResults.filter((row) => row.rateStatus === 'multiple_rates_review_required').length,
        grossPayPreview: persistedResults.reduce((sum, row) => {
          const value = Number(row.grossPayPreview);
          return sum + (Number.isFinite(value) ? value : 0);
        }, 0),
        payableHoursPreview: safeSum(persistedResults, 'payableHoursPreview'),
      };

      const run = {
        runId: buildRunId(month, generatedAt),
        version: CALCULATION_VERSION,
        month,
        cutoffDate: engine.dateKey(cutoffDate),
        generatedAt,
        sourceState: 'provisional',
        summary,
        employees: persistedResults,
      };

      await store.saveComputation(run);
      await store.saveMonthState({
        month,
        status: 'provisional',
        latestRunId: run.runId,
        generatedAt,
        unresolvedImportantExceptions: summary.unresolvedItemCount + summary.multiRateReviewCount,
      });

      return run;
    }

    async function getPayrollMonthSnapshot(monthValue) {
      const { month } = parseMonth(monthValue);
      const [latestRun, monthState, adjustments, accountingComparison] = await Promise.all([
        store.getLatestComputation(month),
        store.getMonthState(month),
        store.listAdjustments(month),
        store.getAccountingComparison(month),
      ]);

      return {
        month,
        latestRun,
        monthState,
        adjustments,
        accountingComparison,
      };
    }

    async function saveAccountingComparison({ month: monthValue, confirmed, differenceCount, rows = [] }) {
      const { month } = parseMonth(monthValue);
      const value = {
        month,
        confirmed: confirmed === true,
        differenceCount: Number(differenceCount || 0),
        rows: (rows || []).map((row) => ({
          employeeId: row.employeeId,
          field: row.field,
          provisionalValue: row.provisionalValue,
          confirmedValue: row.confirmedValue,
          difference: row.difference,
          status: row.status || 'review',
        })),
        updatedAt: nowIso(clock),
      };
      return store.saveAccountingComparison(value);
    }

    async function generateAndPersistCarryover({
      month: monthValue,
      provisionalRun,
      finalEmployeeDayRows,
    }) {
      const { month } = parseMonth(monthValue);
      const adjustments = [];

      (provisionalRun && provisionalRun.employees || []).forEach((employeeResult) => {
        const provisionalRows = employeeResult.dayRows || [];
        const finalRows = finalEmployeeDayRows && finalEmployeeDayRows[employeeResult.employeeId] || [];
        adjustments.push(...engine.buildCarryoverAdjustments({
          employeeId: employeeResult.employeeId,
          sourceMonth: month,
          provisionalDayRows: provisionalRows,
          finalDayRows: finalRows,
        }));
      });

      await store.replaceAdjustments(month, adjustments);
      return adjustments;
    }

    async function replaceCarryoverAdjustments({ month: monthValue, adjustments }) {
      const { month } = parseMonth(monthValue);
      const safeRows = (adjustments || []).map((row) => ({
        adjustmentId: row.adjustmentId,
        employeeId: row.employeeId,
        sourceMonth: month,
        sourceDate: row.sourceDate,
        category: row.category,
        beforeHours: row.beforeHours,
        afterHours: row.afterHours,
        differenceHours: row.differenceHours,
        status: row.status || 'pending_next_month',
      }));
      await store.replaceAdjustments(month, safeRows);
      return safeRows;
    }

    async function evaluateFinalization(monthValue) {
      const { month } = parseMonth(monthValue);
      const snapshot = await getPayrollMonthSnapshot(month);
      const state = snapshot.monthState || {};
      const accounting = snapshot.accountingComparison || {};
      const adjustmentRows = snapshot.adjustments || [];
      const carryoverReviewed = adjustmentRows.every((row) => row.status === 'reviewed' || row.status === 'applied' || row.status === 'none');

      return engine.evaluateMonthLock({
        unresolvedImportantExceptions: Number(state.unresolvedImportantExceptions || 0),
        accountingConfirmed: accounting.confirmed === true,
        carryoverReviewed,
        alreadyLocked: state.status === 'locked',
      });
    }

    async function lockPayrollMonth({ month: monthValue, approvedByUser, approvedBy, approvalNote }) {
      const { month } = parseMonth(monthValue);
      if (approvedByUser !== true) {
        const error = new Error('user_approval_required');
        error.code = 'user_approval_required';
        throw error;
      }

      const evaluation = await evaluateFinalization(month);
      if (!evaluation.allowed) {
        const error = new Error(`month_lock_blocked:${evaluation.blockers.join(',')}`);
        error.code = 'month_lock_blocked';
        error.blockers = evaluation.blockers;
        throw error;
      }

      const current = await store.getMonthState(month) || { month };
      const lockedAt = nowIso(clock);
      const next = {
        ...current,
        month,
        status: 'locked',
        lockedAt,
        approvedBy: approvedBy || 'explicit-user-approval',
        approvalNote: approvalNote || '',
      };
      await store.saveMonthState(next);
      return next;
    }

    return Object.freeze({
      calculateAndPersistProvisional,
      getPayrollMonthSnapshot,
      saveAccountingComparison,
      generateAndPersistCarryover,
      replaceCarryoverAdjustments,
      evaluateFinalization,
      lockPayrollMonth,
    });
  }

  return Object.freeze({
    CALCULATION_VERSION,
    parseMonth,
    buildPersistedEmployeeResult,
    createPayrollService,
  });
});
