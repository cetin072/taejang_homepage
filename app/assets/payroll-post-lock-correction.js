(function initPayrollPostLockCorrection(root, factory) {
  let repositoryApi = root && root.TaejangPayrollRepository;
  if (typeof module !== 'undefined' && module.exports) {
    repositoryApi = require('./payroll-repository.js');
    module.exports = factory(repositoryApi);
    return;
  }
  if (root) {
    root.TaejangPayrollPostLockCorrection = factory(repositoryApi);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollPostLockCorrectionFactory(repositoryApi) {
  'use strict';

  if (!repositoryApi) throw new Error('TaejangPayrollRepository is required.');

  const ALLOWED_CATEGORIES = new Set([
    'work_hours',
    'weekly_holiday',
    'paid_holiday',
    'other_approved',
  ]);

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function nowIso(clock) {
    const value = clock ? clock() : new Date();
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  function correctionError(code, message, blockers = []) {
    const error = new Error(code);
    error.code = code;
    error.operatorMessage = message;
    error.blockers = blockers;
    return error;
  }

  function assertSourceDate(sourceMonth, sourceDate) {
    const date = String(sourceDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(`${sourceMonth}-`)) {
      throw correctionError(
        'post_lock_correction_source_date_invalid',
        '정정 대상일이 원래 급여월과 맞지 않습니다.'
      );
    }
    const [year, month, day] = date.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year
      || parsed.getUTCMonth() !== month - 1
      || parsed.getUTCDate() !== day
    ) {
      throw correctionError(
        'post_lock_correction_source_date_invalid',
        '정정 대상일이 올바른 날짜가 아닙니다.'
      );
    }
    return date;
  }

  function validateCorrectionFacts(input) {
    const employeeId = String(input.employeeId || '').trim();
    const adjustmentId = String(input.adjustmentId || '').trim();
    const reason = String(input.reason || '').trim();
    const category = String(input.category || '').trim();
    const beforeHours = finite(input.beforeHours);
    const afterHours = finite(input.afterHours);
    const differenceHours = finite(input.differenceHours);
    const sourceHourlyRate = finite(input.sourceHourlyRate);
    const differenceAmount = finite(input.differenceAmount);

    if (!employeeId || !adjustmentId) {
      throw correctionError(
        'post_lock_correction_identity_required',
        '정정할 직원과 정정기록 식별정보가 필요합니다.'
      );
    }
    if (!ALLOWED_CATEGORIES.has(category)) {
      throw correctionError(
        'post_lock_correction_category_invalid',
        '지원하지 않는 급여 정정 유형입니다.'
      );
    }
    if (!reason) {
      throw correctionError(
        'post_lock_correction_reason_required',
        '잠금 후 정정은 사유를 반드시 남겨야 합니다.'
      );
    }
    if (sourceHourlyRate === null || sourceHourlyRate <= 0 || differenceAmount === null || differenceAmount === 0) {
      throw correctionError(
        'post_lock_correction_amount_invalid',
        '정정 시급과 실제 조정금액을 확인해 주세요. 금액은 임의로 추정하지 않습니다.'
      );
    }
    if (differenceHours === null || differenceHours === 0) {
      throw correctionError(
        'post_lock_correction_hours_invalid',
        '정정 전후 근로시간 차이를 확인해 주세요.'
      );
    }
    if (beforeHours !== null && afterHours !== null) {
      const calculatedDifference = Math.round((afterHours - beforeHours) * 100) / 100;
      if (Math.abs(calculatedDifference - differenceHours) > 0.0001) {
        throw correctionError(
          'post_lock_correction_hours_mismatch',
          '정정 전·후 시간과 시간 차이가 서로 맞지 않습니다.'
        );
      }
    }

    return {
      employeeId,
      adjustmentId,
      reason,
      category,
      beforeHours,
      afterHours,
      differenceHours,
      sourceHourlyRate,
      differenceAmount,
    };
  }

  function createPostLockCorrectionService({ repository, clock } = {}) {
    const store = repositoryApi.assertPayrollRepository(repository);

    async function recordCorrection(input = {}) {
      if (input.approvedByUser !== true) {
        throw correctionError(
          'post_lock_correction_approval_required',
          '확정월 정정기록을 추가하려면 담당자의 명시적 확인이 필요합니다.'
        );
      }

      const sourceMonth = repositoryApi.normalizeMonth(input.sourceMonth);
      const targetMonth = repositoryApi.normalizeMonth(input.targetMonth);
      if (targetMonth <= sourceMonth) {
        throw correctionError(
          'post_lock_correction_target_month_invalid',
          '잠금 후 정정은 원래 급여월보다 뒤의 열린 급여월에만 반영할 수 있습니다.'
        );
      }

      const sourceState = await store.getMonthState(sourceMonth);
      if (!sourceState || sourceState.status !== 'locked') {
        throw correctionError(
          'post_lock_correction_source_not_locked',
          '잠금 후 정정은 이미 확정된 급여월에 대해서만 기록할 수 있습니다.'
        );
      }

      const targetState = await store.getMonthState(targetMonth);
      if (targetState && targetState.status === 'locked') {
        throw correctionError(
          'post_lock_correction_target_locked',
          '반영 대상 급여월도 이미 확정되어 있습니다. 아직 열린 이후 급여월을 선택해 주세요.'
        );
      }

      const facts = validateCorrectionFacts(input);
      const sourceDate = assertSourceDate(sourceMonth, input.sourceDate);
      const existing = (await store.listAdjustments(sourceMonth))
        .find((row) => String(row && row.adjustmentId) === facts.adjustmentId);

      const timestamp = nowIso(clock);
      const value = {
        adjustmentId: facts.adjustmentId,
        employeeId: facts.employeeId,
        sourceMonth,
        targetMonth,
        sourceDate,
        category: facts.category,
        beforeHours: facts.beforeHours,
        afterHours: facts.afterHours,
        differenceHours: facts.differenceHours,
        sourceHourlyRate: facts.sourceHourlyRate,
        differenceAmount: facts.differenceAmount,
        amountStatus: 'ready',
        status: 'reviewed',
        reason: facts.reason,
        correctionKind: 'post_lock',
        createdAt: existing && existing.createdAt || timestamp,
        reviewedAt: existing && existing.reviewedAt || timestamp,
        reviewedBy: input.approvedBy || existing && existing.reviewedBy || 'explicit-user-approval',
      };

      try {
        const saved = await store.saveAdjustment(value);
        return {
          code: existing ? 'post_lock_correction_reused' : 'post_lock_correction_recorded',
          adjustment: saved,
        };
      } catch (error) {
        if (error && error.code === 'carryover_adjustment_conflict') {
          throw correctionError(
            'post_lock_correction_conflict',
            '같은 정정기록 번호로 다른 내용이 이미 저장되어 있습니다. 기존 기록을 확인해 주세요.'
          );
        }
        throw error;
      }
    }

    return Object.freeze({ recordCorrection });
  }

  return Object.freeze({
    ALLOWED_CATEGORIES,
    finite,
    assertSourceDate,
    validateCorrectionFacts,
    createPostLockCorrectionService,
  });
});
