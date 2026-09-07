(function initPayrollCommand(root, factory) {
  let preflight = root && root.TaejangPayrollPreflight;
  let carryover = root && root.TaejangPayrollCarryover;
  if (typeof module !== 'undefined' && module.exports) {
    preflight = require('./payroll-preflight.js');
    carryover = require('./payroll-carryover.js');
    module.exports = factory(preflight, carryover);
    return;
  }
  if (root) {
    root.TaejangPayrollCommand = factory(preflight, carryover);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollCommandFactory(preflight, carryover) {
  'use strict';

  if (!preflight) throw new Error('TaejangPayrollPreflight is required.');
  if (!carryover) throw new Error('TaejangPayrollCarryover is required.');

  function assertService(service) {
    const required = [
      'calculateAndPersistProvisional',
      'getPayrollMonthSnapshot',
      'saveAccountingComparison',
      'replaceCarryoverAdjustments',
      'evaluateFinalization',
      'lockPayrollMonth',
    ];
    const missing = required.filter((name) => !service || typeof service[name] !== 'function');
    if (missing.length) throw new Error(`Payroll service contract missing: ${missing.join(', ')}`);
    return service;
  }

  function createPayrollCommand({ service }) {
    const payrollService = assertService(service);

    async function calculateProvisional(input) {
      const validation = preflight.validatePayrollInput({
        employees: input && input.employees,
        terms: input && input.terms,
        attendanceRecords: input && input.attendanceRecords,
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

      const run = await payrollService.calculateAndPersistProvisional(input);
      return {
        ok: true,
        code: run.reusedExistingRun ? 'provisional_reused' : 'provisional_calculated',
        validation,
        run,
      };
    }

    async function getMonth(month) {
      return payrollService.getPayrollMonthSnapshot(month);
    }

    async function saveAccountingComparison(input) {
      return payrollService.saveAccountingComparison(input);
    }

    async function reconcileCarryover({ month, provisionalRun, finalEmployeeResults }) {
      try {
        const adjustments = carryover.buildMonthCarryover({
          sourceMonth: month,
          provisionalRun,
          finalEmployeeResults,
        });
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

      const stored = await payrollService.replaceCarryoverAdjustments({ month, adjustments: next });
      return {
        ok: true,
        code: 'carryover_reviewed',
        reviewedCount,
        adjustments: stored,
      };
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
        throw error;
      }
    }

    return Object.freeze({
      calculateProvisional,
      getMonth,
      saveAccountingComparison,
      reconcileCarryover,
      reviewCarryover,
      evaluateFinalization,
      finalizeMonth,
    });
  }

  return Object.freeze({
    assertService,
    createPayrollCommand,
  });
});
