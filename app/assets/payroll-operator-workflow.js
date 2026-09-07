(function initPayrollOperatorWorkflow(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TaejangPayrollOperatorWorkflow = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollOperatorWorkflowFactory() {
  'use strict';

  const StepId = Object.freeze({
    IMPORT: 'import',
    EXCEPTIONS: 'exceptions',
    PROVISIONAL: 'provisional',
    ACCOUNTING: 'accounting',
    FINALIZE: 'finalize',
  });

  const StepStatus = Object.freeze({
    DONE: 'done',
    CURRENT: 'current',
    BLOCKED: 'blocked',
    WAITING: 'waiting',
  });

  const blockerLabels = Object.freeze({
    important_exceptions_unresolved: '확인이 필요한 근태 예외가 남아 있습니다.',
    accounting_values_unconfirmed: '회계사무실 확정값 확인이 필요합니다.',
    accounting_comparison_stale: '급여 가안이 변경되어 회계자료를 다시 대조해야 합니다.',
    carryover_not_reviewed: '전월·다음달 조정내역 확인이 필요합니다.',
    already_locked: '이미 확정된 급여월입니다.',
    attendance_not_imported: '먼저 출퇴근 자료를 가져와 주세요.',
    provisional_not_ready: '급여 가안 계산을 먼저 완료해 주세요.',
    payroll_rate_review_required: '시급 변경 또는 복수 시급 적용 직원의 확인이 필요합니다.',
  });

  function normalizeCount(value) {
    const count = Number(value || 0);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }

  function isImported(snapshot) {
    return Boolean(snapshot && snapshot.import && (
      snapshot.import.completed === true ||
      normalizeCount(snapshot.import.rawRows) > 0
    ));
  }

  function buildStep(id, title, status, description, meta = {}) {
    return { id, title, status, description, ...meta };
  }

  function translateBlockers(blockers) {
    return (blockers || []).map((blocker) => ({
      code: blocker,
      message: blockerLabels[blocker] || '확인이 필요한 항목이 있습니다.',
    }));
  }

  function buildOperatorWorkflow(snapshot = {}) {
    const imported = isImported(snapshot);
    const exceptionCount = normalizeCount(snapshot.exceptions && snapshot.exceptions.unresolvedImportant);
    const unresolvedRateCount = normalizeCount(snapshot.provisional && snapshot.provisional.unresolvedRateCount);
    const grossPayPreviewStatus = snapshot.provisional && snapshot.provisional.grossPayPreviewStatus;
    const baseReady = Boolean(snapshot.provisional && snapshot.provisional.baseReady);
    const incomingCarryoverCount = normalizeCount(
      snapshot.provisional && snapshot.provisional.incomingCarryoverCount
    );
    const incomingCarryoverStatus = snapshot.provisional
      && snapshot.provisional.incomingCarryoverStatus || 'none';
    const incomingCarryoverPending = incomingCarryoverCount > 0
      && incomingCarryoverStatus !== 'complete';
    const provisionalCalculated = Boolean(snapshot.provisional && (
      snapshot.provisional.runId
      || snapshot.provisional.ready
      || baseReady
      || unresolvedRateCount > 0
      || grossPayPreviewStatus === 'review_required'
    ));
    const provisionalReady = Boolean(snapshot.provisional && snapshot.provisional.ready)
      && unresolvedRateCount === 0
      && !incomingCarryoverPending
      && grossPayPreviewStatus !== 'review_required';
    const accountingStale = Boolean(snapshot.accounting && (
      snapshot.accounting.stale === true || snapshot.accounting.status === 'stale'
    ));
    const accountingConfirmed = Boolean(snapshot.accounting && snapshot.accounting.confirmed) && !accountingStale;
    const locked = Boolean(snapshot.finalization && snapshot.finalization.locked);
    const lockAllowed = Boolean(snapshot.finalization && snapshot.finalization.allowed);
    const lockBlockers = (snapshot.finalization && snapshot.finalization.blockers) || [];
    const pendingCarryoverCount = normalizeCount(
      snapshot.finalization && snapshot.finalization.pendingCarryoverCount
    );

    const importStep = buildStep(
      StepId.IMPORT,
      '출퇴근 가져오기',
      imported ? StepStatus.DONE : StepStatus.CURRENT,
      imported
        ? `${normalizeCount(snapshot.import.rawRows)}건을 가져왔습니다.`
        : '이번 달 출퇴근 자료를 가져옵니다.',
      { rawRows: normalizeCount(snapshot.import && snapshot.import.rawRows) }
    );

    let exceptionStatus = StepStatus.BLOCKED;
    let exceptionDescription = '출퇴근 자료를 가져오면 자동으로 확인할 항목만 추립니다.';
    if (imported) {
      exceptionStatus = exceptionCount > 0 ? StepStatus.CURRENT : StepStatus.DONE;
      exceptionDescription = exceptionCount > 0
        ? `${exceptionCount}건만 확인하면 됩니다.`
        : '확인이 필요한 중요 예외가 없습니다.';
    }
    const exceptionStep = buildStep(
      StepId.EXCEPTIONS,
      '예외 확인',
      exceptionStatus,
      exceptionDescription,
      { unresolvedImportant: exceptionCount }
    );

    let provisionalStatus = StepStatus.BLOCKED;
    let provisionalDescription = '근태 예외 확인이 끝나면 급여 가안을 계산합니다.';
    let provisionalPrimaryAction = null;
    if (imported && exceptionCount === 0) {
      if (provisionalCalculated && unresolvedRateCount > 0) {
        provisionalStatus = StepStatus.CURRENT;
        provisionalDescription = `시급 적용을 확인해야 하는 직원 ${unresolvedRateCount}명이 있습니다.`;
      } else if (baseReady && incomingCarryoverPending) {
        provisionalStatus = StepStatus.CURRENT;
        provisionalDescription = `전월 이월조정 ${incomingCarryoverCount}건을 이번 달 급여 가안에 반영해야 합니다.`;
        provisionalPrimaryAction = { id: 'apply_incoming_carryover', label: '전월 조정 반영' };
      } else if (provisionalCalculated && grossPayPreviewStatus === 'review_required') {
        provisionalStatus = StepStatus.CURRENT;
        provisionalDescription = '일부 직원의 급여조건 확인이 끝나야 회사 전체 가안 금액을 확정할 수 있습니다.';
      } else {
        provisionalStatus = provisionalReady ? StepStatus.DONE : StepStatus.CURRENT;
        provisionalDescription = provisionalReady
          ? '급여 가안 계산이 완료되었습니다.'
          : '예상근무·주휴·유급공휴일을 포함한 가안을 계산합니다.';
      }
    }
    const provisionalStep = buildStep(
      StepId.PROVISIONAL,
      '급여 가안',
      provisionalStatus,
      provisionalDescription,
      {
        baseGrossPay: snapshot.provisional && snapshot.provisional.baseGrossPay,
        carryoverAdjustmentAmount: snapshot.provisional && snapshot.provisional.carryoverAdjustmentAmount,
        grossPayPreview: snapshot.provisional && snapshot.provisional.grossPayPreview,
        grossPayPreviewStatus,
        unresolvedRateCount,
        incomingCarryoverCount,
        incomingCarryoverStatus,
        primaryAction: provisionalPrimaryAction,
      }
    );

    let accountingStatus = StepStatus.BLOCKED;
    let accountingDescription = '급여 가안 완료 후 회계사무실 확정값을 대조합니다.';
    if (provisionalReady) {
      accountingStatus = accountingConfirmed ? StepStatus.DONE : StepStatus.CURRENT;
      if (accountingStale) {
        accountingDescription = '급여 가안이 변경되어 회계자료를 다시 대조해야 합니다.';
      } else {
        accountingDescription = accountingConfirmed
          ? '회계사무실 확정값 대조가 완료되었습니다.'
          : '회계사무실 확정 공제·지급값과 다른 직원만 확인합니다.';
      }
    }
    const accountingStep = buildStep(
      StepId.ACCOUNTING,
      '회계 대조',
      accountingStatus,
      accountingDescription,
      {
        differenceCount: normalizeCount(snapshot.accounting && snapshot.accounting.differenceCount),
        stale: accountingStale,
      }
    );

    let finalizeStatus = StepStatus.BLOCKED;
    let finalizeDescription = '앞 단계 확인이 완료되어야 급여를 확정할 수 있습니다.';
    let finalizePrimaryAction = null;
    if (locked) {
      finalizeStatus = StepStatus.DONE;
      finalizeDescription = '급여가 확정되어 잠금 상태입니다. 확정 요약을 다시 확인할 수 있습니다.';
      finalizePrimaryAction = { id: 'view_locked_output', label: '확정 요약 보기' };
    } else if (accountingConfirmed && pendingCarryoverCount > 0) {
      finalizeStatus = StepStatus.CURRENT;
      finalizeDescription = `이번 달 이후 반영할 이월조정 ${pendingCarryoverCount}건을 확인하면 급여 확정으로 넘어갑니다.`;
      finalizePrimaryAction = { id: 'review_carryover', label: '다음달 이월조정 확인' };
    } else if (accountingConfirmed && lockAllowed) {
      finalizeStatus = StepStatus.CURRENT;
      finalizeDescription = '최종 확인 후 이번 달 급여를 확정할 수 있습니다.';
    } else if (accountingConfirmed) {
      const translated = translateBlockers(lockBlockers);
      finalizeDescription = translated.length
        ? translated.map((item) => item.message).join(' ')
        : finalizeDescription;
    } else if (accountingStale) {
      finalizeDescription = blockerLabels.accounting_comparison_stale;
    }
    const finalizeStep = buildStep(
      StepId.FINALIZE,
      '급여 확정',
      finalizeStatus,
      finalizeDescription,
      {
        blockers: translateBlockers(lockBlockers),
        pendingCarryoverCount,
        primaryAction: finalizePrimaryAction,
      }
    );

    const steps = [importStep, exceptionStep, provisionalStep, accountingStep, finalizeStep];
    const current = steps.find((step) => step.status === StepStatus.CURRENT) || steps.at(-1);

    return {
      month: snapshot.month || null,
      steps,
      currentStep: current ? current.id : StepId.IMPORT,
      primaryAction: current && current.primaryAction
        ? current.primaryAction
        : actionForStep(current ? current.id : StepId.IMPORT),
      complete: locked,
      summary: {
        rawRows: normalizeCount(snapshot.import && snapshot.import.rawRows),
        unresolvedImportant: exceptionCount,
        unresolvedRateCount,
        incomingCarryoverCount,
        incomingCarryoverStatus,
        pendingCarryoverCount,
        accountingDifferences: normalizeCount(snapshot.accounting && snapshot.accounting.differenceCount),
        accountingStale,
      },
    };
  }

  function actionForStep(stepId) {
    switch (stepId) {
      case StepId.IMPORT:
        return { id: 'import_attendance', label: '출퇴근 가져오기' };
      case StepId.EXCEPTIONS:
        return { id: 'review_exceptions', label: '확인 필요한 항목 보기' };
      case StepId.PROVISIONAL:
        return { id: 'calculate_provisional', label: '급여 가안 계산' };
      case StepId.ACCOUNTING:
        return { id: 'compare_accounting', label: '회계자료 대조' };
      case StepId.FINALIZE:
        return { id: 'finalize_payroll', label: '이번 달 급여 확정' };
      default:
        return { id: 'open_payroll', label: '급여관리 열기' };
    }
  }

  function buildExceptionQueue(items) {
    const priority = { critical: 0, high: 1, medium: 2, low: 3 };
    return (items || [])
      .filter((item) => item && item.resolved !== true)
      .map((item) => ({
        ...item,
        severity: item.severity || 'medium',
        operatorLabel: item.operatorLabel || humanizeExceptionType(item.type),
      }))
      .sort((a, b) => {
        const severityDiff = (priority[a.severity] ?? 2) - (priority[b.severity] ?? 2);
        if (severityDiff !== 0) return severityDiff;
        return String(a.date || '').localeCompare(String(b.date || ''));
      });
  }

  function humanizeExceptionType(type) {
    const labels = {
      attendance_missing: '출퇴근 기록 확인',
      manual_record: '수기 기록 확인',
      employee_unmatched: '직원 연결 확인',
      employment_term_missing: '근로조건 확인',
      employment_period_conflict: '입·퇴사일 확인',
      multiple_hourly_rates: '시급 변경 확인',
      accounting_difference: '회계자료 차이 확인',
      accounting_stale: '회계자료 다시 대조',
      carryover_adjustment: '전월 조정 확인',
    };
    return labels[type] || '확인 필요';
  }

  return Object.freeze({
    StepId,
    StepStatus,
    blockerLabels,
    normalizeCount,
    isImported,
    translateBlockers,
    buildOperatorWorkflow,
    actionForStep,
    buildExceptionQueue,
    humanizeExceptionType,
  });
});
