(function initPayrollCommand(root, factory) {
  let preflight = root && root.TaejangPayrollPreflight;
  let carryover = root && root.TaejangPayrollCarryover;
  let output = root && root.TaejangPayrollOutput;
  if (typeof module !== 'undefined' && module.exports) {
    preflight = require('./payroll-preflight.js');
    carryover = require('./payroll-carryover.js');
    output = require('./payroll-output.js');
    module.exports = factory(preflight, carryover, output);
    return;
  }
  if (root) {
    root.TaejangPayrollCommand = factory(preflight, carryover, output);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollCommandFactory(preflight, carryover, output) {
  'use strict';

  if (!preflight) throw new Error('TaejangPayrollPreflight is required.');
  if (!carryover) throw new Error('TaejangPayrollCarryover is required.');
  if (!output) throw new Error('TaejangPayrollOutput is required.');

  function assertService(service) {
    const required = [
      'calculateAndPersistProvisional',
      'getPayrollMonthSnapshot',
      'saveAccountingComparison',
      'replaceCarryoverAdjustments',
      'applyIncomingCarryover',
      'evaluateFinalization',
      'lockPayrollMonth',
    ];
    const missing = required.filter((name) => !service || typeof service[name] !== 'function');
    if (missing.length) throw new Error(`Payroll service contract missing: ${missing.join(', ')}`);
    return service;
  }

  function nextPayrollMonth(month) {
    const match = String(month || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    let year = Number(match[1]);
    let monthNumber = Number(match[2]) + 1;
    if (monthNumber === 13) {
      year += 1;
      monthNumber = 1;
    }
    return `${year}-${String(monthNumber).padStart(2, '0')}`;
  }

  function finiteAmount(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function incomingAccountingBlockers(snapshot) {
    const blockers = [];
    const latestRun = snapshot && snapshot.latestRun;
    const amounts = snapshot && snapshot.payrollAmounts;

    if (!latestRun || !latestRun.summary || latestRun.summary.grossPayPreviewStatus !== 'complete') {
      blockers.push('base_payroll_incomplete');
      return blockers;
    }

    if (!amounts) return blockers;
    if (!['none', 'complete'].includes(amounts.incomingAdjustmentStatus)) {
      blockers.push('incoming_carryover_not_applied');
    }
    if (finiteAmount(amounts.grossPayWithAdjustments) === null) {
      blockers.push('adjusted_gross_not_ready');
    }
    return blockers;
  }

  function lockedMonthResult(message) {
    return {
      ok: false,
      code: 'month_locked',
      message: message || '이미 확정된 급여월은 수정할 수 없습니다.',
    };
  }

  function accountingBlockedResult(blockers) {
    return {
      ok: false,
      code: 'accounting_comparison_blocked',
      message: '전월 조정까지 반영된 최신 급여 가안을 만든 뒤 회계 대조를 다시 확인해 주세요.',
      blockers: blockers || ['adjusted_payroll_basis_incomplete'],
    };
  }

  function createPayrollCommand({ service }) {
    const payrollService = assertService(service);

    async function calculateProvisional(input) {
      const validation = preflight.validatePayrollInput({
        month: input && input.month,
        employees: input && input.employees,
        terms: input && input.terms,
        attendanceRecords: input && input.attendanceRecords,
        cutoffDate: input && input.cutoffDate,
        holidays: input && input.holidays,
      });

      if (!validation.calculationAllowed) {
        return {
          ok: false,
          code: 'payroll_preflight_failed',
          message: '급여 계산 전에 확인해야 할 기초정보가 있습니다.',
          validation,
          exceptions: preflight.operatorExceptionItems(validation),
        };
      }

      try {
        const run = await payrollService.calculateAndPersistProvisional(input);
        return {
          ok: true,
          code: run.reusedExistingRun ? 'provisional_reused' : 'provisional_calculated',
          validation,
          run,
        };
      } catch (error) {
        if (error && error.code === 'payroll_preflight_failed') {
          const serviceValidation = error.validation || validation;
          return {
            ok: false,
            code: 'payroll_preflight_failed',
            message: '급여 계산 전에 확인해야 할 기초정보가 있습니다.',
            validation: serviceValidation,
            exceptions: preflight.operatorExceptionItems(serviceValidation),
          };
        }
        if (error && error.code === 'month_locked') {
          return lockedMonthResult('이미 확정된 급여월은 다시 계산할 수 없습니다.');
        }
        throw error;
      }
    }

    async function getMonth(month) {
      return payrollService.getPayrollMonthSnapshot(month);
    }

    async function getLockedOutput(month) {
      try {
        const snapshot = await payrollService.getPayrollMonthSnapshot(month);
        return {
          ok: true,
          code: 'payroll_locked_output_ready',
          output: output.buildLockedPayrollOutput(snapshot),
        };
      } catch (error) {
        if (error && typeof error.code === 'string' && error.code.startsWith('payroll_output_')) {
          return {
            ok: false,
            code: error.code,
            message: error.operatorMessage || '확정 요약을 만들기 전에 급여 상태를 다시 확인해 주세요.',
            blockers: error.blockers || [],
          };
        }
        throw error;
      }
    }

    async function saveAccountingComparison(input) {
      if (input && input.confirmed === true) {
        const snapshot = await payrollService.getPayrollMonthSnapshot(input.month);
        const blockers = incomingAccountingBlockers(snapshot);
        if (blockers.length) return accountingBlockedResult(blockers);
      }

      try {
        return await payrollService.saveAccountingComparison(input);
      } catch (error) {
        if (error && error.code === 'accounting_basis_incomplete') {
          return accountingBlockedResult(error.blockers || ['adjusted_payroll_basis_incomplete']);
        }
        if (error && error.code === 'month_locked') {
          return lockedMonthResult('이미 확정된 급여월의 회계 대조는 수정할 수 없습니다.');
        }
        throw error;
      }
    }

    async function reconcileCarryover({ month, provisionalRun, finalEmployeeResults }) {
      try {
        const snapshot = await payrollService.getPayrollMonthSnapshot(month);
        const latestRun = snapshot && snapshot.latestRun;
        if (
          !provisionalRun
          || provisionalRun.month !== month
          || !latestRun
          || latestRun.runId !== provisionalRun.runId
        ) {
          return {
            ok: false,
            code: 'carryover_run_mismatch',
            message: '현재 급여월의 최신 가안과 일치하는 자료로 다시 이월조정을 계산해 주세요.',
          };
        }

        const existing = snapshot.adjustments || [];
        if (existing.some((row) => row.status === 'reviewed' || row.status === 'applied')) {
          return {
            ok: false,
            code: 'carryover_reconciliation_locked',
            message: '이미 확인된 이월조정이 있어 자동 재생성할 수 없습니다.',
          };
        }

        const targetMonth = nextPayrollMonth(month);
        const adjustments = carryover.buildMonthCarryover({
          sourceMonth: month,
          provisionalRun,
          finalEmployeeResults,
        }).map((row) => ({ ...row, targetMonth }));
        const stored = await payrollService.replaceCarryoverAdjustments({
          month,
          adjustments,
        });
        return {
          ok: true,
          code: adjustments.length ? 'carryover_reconciled' : 'carryover_none',
          adjustmentCount: stored.length,
          adjustments: stored,
        };
      } catch (error) {
        if (error && error.code === 'final_reconciliation_incomplete') {
          return {
            ok: false,
            code: 'final_reconciliation_incomplete',
            message: '최종 근태·주휴 확인이 끝나지 않아 이월조정을 만들 수 없습니다.',
            employeeId: error.employeeId || null,
            date: error.date || null,
          };
        }
        if (error && error.code === 'month_locked') {
          return lockedMonthResult('이미 확정된 급여월의 이월조정은 다시 만들 수 없습니다.');
        }
        throw error;
      }
    }

    async function reviewCarryover({ month, adjustmentIds = [], reviewAll = false, approvedByUser = false } = {}) {
      if (approvedByUser !== true) {
        return {
          ok: false,
          code: 'carryover_review_approval_required',
          message: '이월조정 확인 완료 처리는 담당자의 명시적 확인이 필요합니다.',
        };
      }

      const snapshot = await payrollService.getPayrollMonthSnapshot(month);
      const current = snapshot && snapshot.adjustments || [];
      const pending = current.filter((row) => row.status === 'pending_next_month');
      if (pending.length === 0) {
        return { ok: true, code: 'carryover_already_clear', reviewedCount: 0, adjustments: current };
      }

      const requested = new Set((adjustmentIds || []).map(String));
      if (!reviewAll && requested.size === 0) {
        return {
          ok: false,
          code: 'carryover_review_selection_required',
          message: '확인 완료할 이월조정 항목을 선택해 주세요.',
        };
      }

      if (!reviewAll) {
        const known = new Set(current.map((row) => String(row.adjustmentId)));
        const unknown = [...requested].filter((id) => !known.has(id));
        if (unknown.length) {
          return {
            ok: false,
            code: 'carryover_review_unknown_adjustment',
            message: '현재 월에 없는 이월조정 항목이 포함되어 있습니다.',
            unknownAdjustmentIds: unknown,
          };
        }
      }

      let reviewedCount = 0;
      const next = current.map((row) => {
        const shouldReview = row.status === 'pending_next_month'
          && (reviewAll || requested.has(String(row.adjustmentId)));
        if (!shouldReview) return row;
        reviewedCount += 1;
        return { ...row, status: 'reviewed' };
      });

      try {
        const stored = await payrollService.replaceCarryoverAdjustments({ month, adjustments: next });
        return {
          ok: true,
          code: 'carryover_reviewed',
          reviewedCount,
          adjustments: stored,
        };
      } catch (error) {
        if (error && error.code === 'month_locked') {
          return lockedMonthResult('이미 확정된 급여월의 이월조정 확인상태는 바꿀 수 없습니다.');
        }
        throw error;
      }
    }

    async function applyIncomingCarryover(input = {}) {
      if (input.approvedByUser !== true) {
        return {
          ok: false,
          code: 'carryover_application_approval_required',
          message: '전월 이월조정을 이번 달 급여에 반영하려면 담당자의 명시적 확인이 필요합니다.',
        };
      }

      const targetSnapshot = await payrollService.getPayrollMonthSnapshot(input.month);
      const incoming = targetSnapshot && targetSnapshot.incomingAdjustments || [];
      const sourceMonths = [...new Set(incoming.map((row) => row && row.sourceMonth).filter(Boolean))];
      const unlockedSourceMonths = [];
      for (const sourceMonth of sourceMonths) {
        const sourceSnapshot = await payrollService.getPayrollMonthSnapshot(sourceMonth);
        if (!sourceSnapshot || !sourceSnapshot.monthState || sourceSnapshot.monthState.status !== 'locked') {
          unlockedSourceMonths.push(sourceMonth);
        }
      }
      if (unlockedSourceMonths.length) {
        return {
          ok: false,
          code: 'carryover_source_month_not_locked',
          message: '전월 급여가 확정된 뒤에만 그 조정내역을 이번 달 급여에 반영할 수 있습니다.',
          sourceMonths: unlockedSourceMonths,
        };
      }

      try {
        const result = await payrollService.applyIncomingCarryover(input);
        return {
          ok: true,
          code: result.code || 'carryover_applied',
          result,
        };
      } catch (error) {
        if (error && error.code === 'carryover_application_blocked') {
          return {
            ok: false,
            code: 'carryover_application_blocked',
            message: '이월조정 금액 또는 현재 급여 가안을 먼저 확인해야 합니다.',
            blockers: error.blockers || [],
          };
        }
        if (error && error.code === 'month_locked') {
          return lockedMonthResult('이미 확정된 급여월에는 이월조정을 새로 반영할 수 없습니다.');
        }
        throw error;
      }
    }

    async function evaluateFinalization(month) {
      return payrollService.evaluateFinalization(month);
    }

    async function finalizeMonth(input) {
      if (!input || input.approvedByUser !== true) {
        return {
          ok: false,
          code: 'user_approval_required',
          message: '실제 급여 확정은 사용자 최종 승인이 필요합니다.',
        };
      }

      try {
        const state = await payrollService.lockPayrollMonth(input);
        return { ok: true, code: 'payroll_month_locked', state };
      } catch (error) {
        if (error && error.code === 'month_lock_blocked') {
          return {
            ok: false,
            code: 'month_lock_blocked',
            message: '급여 확정 전에 확인해야 할 항목이 남아 있습니다.',
            blockers: error.blockers || [],
          };
        }
        if (error && error.code === 'month_locked') {
          return lockedMonthResult('이미 확정된 급여월입니다.');
        }
        throw error;
      }
    }

    return Object.freeze({
      calculateProvisional,
      getMonth,
      getLockedOutput,
      saveAccountingComparison,
      reconcileCarryover,
      reviewCarryover,
      applyIncomingCarryover,
      evaluateFinalization,
      finalizeMonth,
    });
  }

  return Object.freeze({
    assertService,
    nextPayrollMonth,
    finiteAmount,
    incomingAccountingBlockers,
    lockedMonthResult,
    accountingBlockedResult,
    createPayrollCommand,
  });
});
