(function initPayrollViewModel(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TaejangPayrollViewModel = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollViewModelFactory() {
  'use strict';

  function count(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function buildOperatorSnapshot({
    month,
    importSummary,
    exceptionSummary,
    serviceSnapshot,
    finalization,
  } = {}) {
    const latestRun = serviceSnapshot && serviceSnapshot.latestRun;
    const summary = latestRun && latestRun.summary || {};
    const accounting = serviceSnapshot && serviceSnapshot.accountingComparison || null;
    const accountingStatus = serviceSnapshot && serviceSnapshot.accountingStatus || 'not_started';
    const monthState = serviceSnapshot && serviceSnapshot.monthState || {};

    const importCompleted = Boolean(importSummary && importSummary.completed);
    const rawRows = count(importSummary && importSummary.rawRows);
    const unresolvedImportant = count(exceptionSummary && exceptionSummary.unresolvedImportant);
    const rateReviewCount = count(summary.rateReviewCount ?? summary.multiRateReviewCount);
    const grossStatus = summary.grossPayPreviewStatus || null;

    return {
      month: month || (serviceSnapshot && serviceSnapshot.month) || null,
      import: {
        completed: importCompleted,
        rawRows,
      },
      exceptions: {
        unresolvedImportant,
      },
      provisional: {
        ready: Boolean(latestRun),
        runId: latestRun && latestRun.runId || null,
        generatedAt: latestRun && latestRun.generatedAt || null,
        grossPayPreview: latestRun ? summary.grossPayPreview ?? null : null,
        grossPayPreviewStatus: latestRun ? grossStatus : null,
        unresolvedRateCount: rateReviewCount,
        employeeCount: count(summary.employeeCount),
        payableHoursPreview: latestRun ? Number(summary.payableHoursPreview || 0) : null,
      },
      accounting: {
        confirmed: accountingStatus === 'confirmed' && Boolean(accounting && accounting.confirmed),
        stale: accountingStatus === 'stale',
        status: accountingStatus,
        differenceCount: count(accounting && accounting.differenceCount),
        runId: accounting && accounting.runId || null,
      },
      finalization: {
        allowed: Boolean(finalization && finalization.allowed),
        blockers: finalization && finalization.blockers || [],
        locked: monthState.status === 'locked',
      },
      meta: {
        calculationVersion: latestRun && latestRun.version || null,
        latestRunId: latestRun && latestRun.runId || null,
        monthStatus: monthState.status || 'draft',
      },
    };
  }

  function buildMonthListItem({ month, serviceSnapshot, importSummary, exceptionSummary } = {}) {
    const latestRun = serviceSnapshot && serviceSnapshot.latestRun;
    const monthState = serviceSnapshot && serviceSnapshot.monthState || {};
    const accountingStatus = serviceSnapshot && serviceSnapshot.accountingStatus || 'not_started';

    let status = '시작 전';
    if (monthState.status === 'locked') status = '확정 완료';
    else if (accountingStatus === 'stale') status = '회계 다시 대조';
    else if (accountingStatus === 'confirmed') status = '확정 대기';
    else if (latestRun) status = '회계 대조';
    else if (count(exceptionSummary && exceptionSummary.unresolvedImportant) > 0) status = '예외 확인';
    else if (importSummary && importSummary.completed) status = '가안 계산';

    return {
      month,
      status,
      rawRows: count(importSummary && importSummary.rawRows),
      unresolvedImportant: count(exceptionSummary && exceptionSummary.unresolvedImportant),
      hasProvisional: Boolean(latestRun),
      accountingStatus,
      locked: monthState.status === 'locked',
    };
  }

  return Object.freeze({
    count,
    buildOperatorSnapshot,
    buildMonthListItem,
  });
});
