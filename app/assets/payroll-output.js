(function initPayrollOutput(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TaejangPayrollOutput = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollOutputFactory() {
  'use strict';

  const OUTPUT_SCHEMA_VERSION = 'payroll-locked-output-v1';

  function finiteAmount(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function count(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function outputError(code, message, blockers = []) {
    const error = new Error(code);
    error.code = code;
    error.operatorMessage = message;
    error.blockers = blockers;
    return error;
  }

  function assertLockedOutputReady(snapshot) {
    const state = snapshot && snapshot.monthState || {};
    const run = snapshot && snapshot.latestRun;
    const accounting = snapshot && snapshot.accountingComparison || {};
    const amounts = snapshot && snapshot.payrollAmounts || {};
    const basis = snapshot && snapshot.payrollBasisFingerprint || null;

    if (!snapshot || !snapshot.month) {
      throw outputError(
        'payroll_output_snapshot_required',
        '확정 요약을 만들 급여월 정보를 불러오지 못했습니다.'
      );
    }
    if (state.status !== 'locked') {
      throw outputError(
        'payroll_output_month_not_locked',
        '급여 확정이 끝난 달에서만 확정 요약을 만들 수 있습니다.'
      );
    }
    if (!run || !run.runId) {
      throw outputError(
        'payroll_output_run_missing',
        '확정된 급여 계산기준을 찾을 수 없어 요약을 만들 수 없습니다.'
      );
    }
    if (
      snapshot.accountingStatus !== 'confirmed'
      || accounting.confirmed !== true
      || !basis
      || !accounting.payrollBasisFingerprint
      || accounting.payrollBasisFingerprint !== basis
    ) {
      throw outputError(
        'payroll_output_accounting_not_current',
        '현재 급여 기준과 일치하는 회계 대조가 확인되어야 확정 요약을 만들 수 있습니다.',
        ['accounting_basis_not_current']
      );
    }
    if (
      !['none', 'complete'].includes(amounts.incomingAdjustmentStatus)
      || count(amounts.orphanApplicationCount) > 0
      || finiteAmount(amounts.grossPayWithAdjustments) === null
    ) {
      throw outputError(
        'payroll_output_adjusted_gross_incomplete',
        '전월 조정까지 반영된 최종 급여금액을 확인한 뒤 확정 요약을 만들어 주세요.',
        ['adjusted_gross_not_ready']
      );
    }
    if (
      finiteAmount(accounting.adjustedGrossBasis) === null
      || finiteAmount(accounting.adjustedGrossBasis) !== finiteAmount(amounts.grossPayWithAdjustments)
    ) {
      throw outputError(
        'payroll_output_basis_mismatch',
        '회계 대조 금액과 현재 확정 급여금액이 달라 확정 요약을 만들 수 없습니다.',
        ['adjusted_gross_basis_mismatch']
      );
    }

    return true;
  }

  function safeEmployeeRows(snapshot) {
    const amounts = snapshot && snapshot.payrollAmounts || {};
    return (amounts.employees || []).map((row) => ({
      employeeId: row.employeeId || null,
      baseGrossPay: finiteAmount(row.baseGrossPay),
      carryoverAdjustmentAmount: finiteAmount(row.carryoverAdjustmentAmount),
      adjustedGrossPay: finiteAmount(row.grossPayWithAdjustments),
    })).sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId)));
  }

  function buildLockedPayrollOutput(snapshot) {
    assertLockedOutputReady(snapshot);

    const state = snapshot.monthState || {};
    const run = snapshot.latestRun;
    const summary = run.summary || {};
    const accounting = snapshot.accountingComparison || {};
    const amounts = snapshot.payrollAmounts || {};
    const outgoing = snapshot.adjustments || [];

    return {
      schemaVersion: OUTPUT_SCHEMA_VERSION,
      month: snapshot.month,
      status: 'locked',
      lockedAt: state.lockedAt || null,
      run: {
        runId: run.runId,
        calculationVersion: run.version || null,
        generatedAt: run.generatedAt || null,
      },
      payrollBasisFingerprint: snapshot.payrollBasisFingerprint,
      totals: {
        employeeCount: count(summary.employeeCount),
        baseGrossPay: finiteAmount(amounts.baseGrossPay),
        carryoverAdjustmentAmount: finiteAmount(amounts.appliedAdjustmentAmount) || 0,
        adjustedGrossPay: finiteAmount(amounts.grossPayWithAdjustments),
      },
      accounting: {
        confirmed: true,
        differenceCount: count(accounting.differenceCount),
        adjustedGrossBasis: finiteAmount(accounting.adjustedGrossBasis),
        payrollBasisFingerprint: accounting.payrollBasisFingerprint,
      },
      carryover: {
        incomingCount: count(amounts.incomingAdjustmentCount),
        outgoingCount: outgoing.length,
        outgoingReviewedCount: outgoing.filter((row) => (
          row && ['reviewed', 'applied', 'none'].includes(row.status)
        )).length,
      },
      employees: safeEmployeeRows(snapshot),
      audit: {
        approvedBy: state.approvedBy || null,
        approvalNote: state.approvalNote || '',
      },
    };
  }

  function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    if (!/[",\n\r]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function buildLockedPayrollCsv(output) {
    if (!output || output.status !== 'locked' || output.schemaVersion !== OUTPUT_SCHEMA_VERSION) {
      throw outputError(
        'payroll_output_invalid',
        '확정된 급여 요약을 먼저 만든 뒤 내보내 주세요.'
      );
    }

    const header = [
      'employee_id',
      'base_gross_pay',
      'prior_month_adjustment',
      'adjusted_gross_pay',
    ];
    const rows = (output.employees || []).map((row) => [
      row.employeeId,
      row.baseGrossPay,
      row.carryoverAdjustmentAmount,
      row.adjustedGrossPay,
    ]);

    return [header, ...rows]
      .map((row) => row.map(csvCell).join(','))
      .join('\n');
  }

  return Object.freeze({
    OUTPUT_SCHEMA_VERSION,
    finiteAmount,
    count,
    assertLockedOutputReady,
    safeEmployeeRows,
    buildLockedPayrollOutput,
    buildLockedPayrollCsv,
  });
});
