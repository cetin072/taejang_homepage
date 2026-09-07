(function initPayrollService(root, factory) {
  let engine = root && root.TaejangPayrollEngine;
  let repositoryApi = root && root.TaejangPayrollRepository;
  let preflight = root && root.TaejangPayrollPreflight;

  if (typeof module !== 'undefined' && module.exports) {
    engine = require('./payroll-engine.js');
    repositoryApi = require('./payroll-repository.js');
    preflight = require('./payroll-preflight.js');
    module.exports = factory(engine, repositoryApi, preflight);
    return;
  }

  if (root) {
    root.TaejangPayrollService = factory(engine, repositoryApi, preflight);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollServiceFactory(engine, repositoryApi, preflight) {
  'use strict';

  if (!engine) throw new Error('TaejangPayrollEngine is required.');
  if (!repositoryApi) throw new Error('TaejangPayrollRepository is required.');
  if (!preflight) throw new Error('TaejangPayrollPreflight is required.');

  const CALCULATION_VERSION = 'payroll-engine-v1';

  function nowIso(clock) {
    const value = clock ? clock() : new Date();
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      return Object.keys(value)
        .sort()
        .reduce((result, key) => {
          result[key] = stableValue(value[key]);
          return result;
        }, {});
    }
    return value === undefined ? null : value;
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value));
  }

  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function safeCalculationInput({ month, cutoffDate, employees, terms, holidays, attendanceRecords }) {
    const employeeRows = (employees || []).map((employee) => ({
      employeeId: employee.employeeId,
      hiredAt: employee.hiredAt || employee.hireDate || null,
      terminatedAt: employee.terminatedAt || employee.terminationDate || null,
    })).sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId)));

    const termRows = (terms || []).map((term) => ({
      employeeId: term.employeeId,
      effectiveFrom: term.effectiveFrom || null,
      effectiveTo: term.effectiveTo || null,
      dailyScheduledHours: term.dailyScheduledHours === '' ? null : term.dailyScheduledHours,
      hourlyRate: term.hourlyRate === '' ? null : term.hourlyRate,
    })).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));

    const holidayRows = (holidays || []).map((holiday) => ({
      date: holiday.date,
      paid: holiday.paid !== false,
    })).sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const attendanceRows = (attendanceRecords || []).map((record) => ({
      employeeId: record.employeeId,
      date: record.date,
      autoDecision: record.autoDecision || null,
      state: record.state || null,
      status: record.status || null,
      reviewStatus: record.reviewStatus || null,
      confirmedHours: record.confirmedHours === '' || record.confirmedHours === undefined
        ? null
        : record.confirmedHours,
    })).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));

    return {
      version: CALCULATION_VERSION,
      month,
      cutoffDate: engine.dateKey(cutoffDate),
      employees: employeeRows,
      terms: termRows,
      holidays: holidayRows,
      attendanceRecords: attendanceRows,
    };
  }

  function buildInputFingerprint(input) {
    return fnv1a(stableStringify(input));
  }

  function buildRunId(month, generatedAt, fingerprint) {
    return `${month}|${generatedAt.replace(/[:.]/g, '-')}|${String(fingerprint || '').slice(0, 8)}`;
  }

  function buildPersistedEmployeeResult(result) {
    const unresolvedCount = Number(result.unresolvedCount || 0);
    const pendingWeeks = Number(result.weeklyHolidayPendingWeeks || 0);
    const grossValue = Number(result.grossPayPreview);
    const grossSafe = unresolvedCount === 0
      && pendingWeeks === 0
      && result.rateStatus === 'single_rate'
      && result.grossPayPreview !== null
      && result.grossPayPreview !== undefined
      && Number.isFinite(grossValue);

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
      grossPayPreview: grossSafe ? grossValue : null,
      rateStatus: result.rateStatus,
      dayRows: (result.dayRows || []).map((row) => ({
        date: row.date,
        kind: row.kind,
        attendanceState: row.attendanceState,
        scheduledHours: row.scheduledHours,
        payableHours: row.payableHours,
        reason: row.reason || null,
      })),
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

    async function assertMonthMutable(month) {
      const state = await store.getMonthState(month);
      if (state && state.status === 'locked') {
        const error = new Error(`month_locked:${month}`);
        error.code = 'month_locked';
        error.month = month;
        throw error;
      }
      return state;
    }

    function assertValidCalculationInput(input) {
      const validation = preflight.validatePayrollInput(input);
      if (!validation.calculationAllowed) {
        const error = new Error('payroll_preflight_failed');
        error.code = 'payroll_preflight_failed';
        error.validation = validation;
        throw error;
      }
      return validation;
    }

    async function markAccountingStaleIfNeeded(month, currentRunId) {
      const accounting = await store.getAccountingComparison(month);
      if (!accounting || !accounting.runId || accounting.runId === currentRunId) return accounting;

      const staleValue = {
        ...accounting,
        confirmed: false,
        stale: true,
        staleReason: 'provisional_recalculated',
        previousRunId: accounting.runId,
        currentRunId,
        updatedAt: nowIso(clock),
      };
      await store.saveAccountingComparison(staleValue);
      return staleValue;
    }

    async function calculateAndPersistProvisional({
      month: monthValue,
      cutoffDate,
      employees,
      terms,
      holidays,
      attendanceRecords,
    }) {
      const { month, year, monthNumber } = parseMonth(monthValue);
      await assertMonthMutable(month);
      if (!cutoffDate) throw new Error('cutoffDate is required.');

      assertValidCalculationInput({
        month,
        cutoffDate,
        employees,
        terms,
        holidays,
        attendanceRecords,
      });

      const safeInput = safeCalculationInput({
        month,
        cutoffDate,
        employees,
        terms,
        holidays,
        attendanceRecords,
      });
      const inputFingerprint = buildInputFingerprint(safeInput);
      const latest = await store.getLatestComputation(month);

      if (
        latest &&
        latest.version === CALCULATION_VERSION &&
        latest.inputFingerprint === inputFingerprint &&
        latest.cutoffDate === safeInput.cutoffDate
      ) {
        return {
          ...latest,
          reusedExistingRun: true,
        };
      }

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
      const multiRateReviewCount = persistedResults.filter(
        (row) => row.rateStatus === 'multiple_rates_review_required'
      ).length;
      const missingRateReviewCount = persistedResults.filter(
        (row) => row.rateStatus === 'missing_rate_review_required'
      ).length;
      const rateReviewCount = multiRateReviewCount + missingRateReviewCount;
      const unresolvedItemCount = safeSum(persistedResults, 'unresolvedCount');
      const pendingWeeklyHolidayWeeks = safeSum(persistedResults, 'weeklyHolidayPendingWeeks');
      const grossPayComplete = unresolvedItemCount === 0
        && pendingWeeklyHolidayWeeks === 0
        && rateReviewCount === 0
        && persistedResults.every(
          (row) => row.grossPayPreview !== null
            && row.grossPayPreview !== undefined
            && Number.isFinite(Number(row.grossPayPreview))
        );

      const summary = {
        employeeCount: persistedResults.length,
        unresolvedEmployeeCount: persistedResults.filter((row) => row.unresolvedCount > 0).length,
        unresolvedItemCount,
        pendingWeeklyHolidayWeeks,
        multiRateReviewCount,
        missingRateReviewCount,
        rateReviewCount,
        grossPayPreviewStatus: grossPayComplete ? 'complete' : 'review_required',
        grossPayPreview: grossPayComplete
          ? persistedResults.reduce((sum, row) => sum + Number(row.grossPayPreview), 0)
          : null,
        payableHoursPreview: safeSum(persistedResults, 'payableHoursPreview'),
      };

      const run = {
        runId: buildRunId(month, generatedAt, inputFingerprint),
        version: CALCULATION_VERSION,
        inputFingerprint,
        month,
        cutoffDate: safeInput.cutoffDate,
        generatedAt,
        sourceState: 'provisional',
        summary,
        employees: persistedResults,
      };

      await store.saveComputation(run);
      await markAccountingStaleIfNeeded(month, run.runId);
      await store.saveMonthState({
        month,
        status: 'provisional',
        latestRunId: run.runId,
        generatedAt,
        unresolvedImportantExceptions: summary.unresolvedItemCount
          + summary.pendingWeeklyHolidayWeeks
          + summary.rateReviewCount,
      });

      return run;
    }

    async function getPayrollMonthSnapshot(monthValue) {
      const { month } = parseMonth(monthValue);
      const [latestRun, monthState, adjustments, incomingAdjustments, accountingComparison] = await Promise.all([
        store.getLatestComputation(month),
        store.getMonthState(month),
        store.listAdjustments(month),
        store.listAdjustmentsTargeting(month),
        store.getAccountingComparison(month),
      ]);

      let accountingStatus = 'not_started';
      if (accountingComparison) {
        const stale = accountingComparison.stale === true
          || !latestRun
          || !accountingComparison.runId
          || accountingComparison.runId !== latestRun.runId;
        if (stale) accountingStatus = 'stale';
        else if (accountingComparison.confirmed === true) accountingStatus = 'confirmed';
        else accountingStatus = 'review';
      }

      return {
        month,
        latestRun,
        monthState,
        adjustments,
        incomingAdjustments,
        accountingComparison,
        accountingStatus,
      };
    }

    async function saveAccountingComparison({ month: monthValue, confirmed, differenceCount, rows = [] }) {
      const { month } = parseMonth(monthValue);
      await assertMonthMutable(month);
      const latestRun = await store.getLatestComputation(month);
      if (!latestRun) {
        const error = new Error('provisional_run_required');
        error.code = 'provisional_run_required';
        throw error;
      }

      const value = {
        month,
        runId: latestRun.runId,
        stale: false,
        staleReason: null,
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

    async function generateAndPersistCarryover({ month: monthValue }) {
      const { month } = parseMonth(monthValue);
      await assertMonthMutable(month);
      const error = new Error('unsafe_legacy_carryover_disabled');
      error.code = 'unsafe_legacy_carryover_disabled';
      throw error;
    }

    async function replaceCarryoverAdjustments({ month: monthValue, adjustments }) {
      const { month } = parseMonth(monthValue);
      await assertMonthMutable(month);
      const safeRows = (adjustments || []).map((row) => ({
        adjustmentId: row.adjustmentId,
        employeeId: row.employeeId,
        sourceMonth: month,
        targetMonth: row.targetMonth || null,
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
      const outgoingRows = snapshot.adjustments || [];
      const incomingRows = snapshot.incomingAdjustments || [];
      const outgoingReviewed = outgoingRows.every(
        (row) => row.status === 'reviewed' || row.status === 'applied' || row.status === 'none'
      );
      const incomingApplied = incomingRows.every(
        (row) => row.status === 'applied' || row.status === 'cancelled' || row.status === 'none'
      );
      const accountingCurrent = snapshot.accountingStatus === 'confirmed';

      return engine.evaluateMonthLock({
        unresolvedImportantExceptions: Number(state.unresolvedImportantExceptions || 0),
        accountingConfirmed: accountingCurrent && accounting.confirmed === true,
        carryoverReviewed: outgoingReviewed && incomingApplied,
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
    stableStringify,
    buildInputFingerprint,
    safeCalculationInput,
    buildPersistedEmployeeResult,
    createPayrollService,
  });
});
