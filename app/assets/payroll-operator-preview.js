(function initPayrollOperatorPreview() {
  'use strict';

  const workflow = globalThis.TaejangPayrollOperatorWorkflow;
  const outputApi = globalThis.TaejangPayrollOutput;
  if (!workflow || !outputApi) return;

  const lockedServiceSnapshot = {
    month: '2026-09',
    latestRun: {
      runId: 'DEMO-RUN-2026-09',
      version: 'payroll-engine-v2',
      generatedAt: '2026-09-25T07:00:00.000Z',
      summary: {
        employeeCount: 24,
        grossPayPreviewStatus: 'complete',
        grossPayPreview: 18240000,
      },
    },
    monthState: {
      month: '2026-09',
      status: 'locked',
      lockedAt: '2026-09-30T07:00:00.000Z',
      approvedBy: 'anonymous-operator',
      approvalNote: '익명 Preview',
    },
    payrollAmounts: {
      baseGrossPay: 18240000,
      incomingAdjustmentStatus: 'complete',
      incomingAdjustmentCount: 2,
      orphanApplicationCount: 0,
      appliedAdjustmentAmount: -61920,
      grossPayWithAdjustments: 18178080,
      employees: [],
    },
    adjustments: [{ adjustmentId: 'DEMO-OUT-1', status: 'reviewed' }],
    incomingAdjustments: [],
    payrollBasisFingerprint: 'demo-basis-202609',
    accountingStatus: 'confirmed',
    accountingComparison: {
      confirmed: true,
      differenceCount: 0,
      payrollBasisFingerprint: 'demo-basis-202609',
      adjustedGrossBasis: 18178080,
    },
  };

  const demoSnapshots = [
    {
      id: 'import',
      label: '1. 가져오기 전',
      snapshot: {
        month: '2026-09',
        import: { completed: false, rawRows: 0 },
        exceptions: { unresolvedImportant: 0 },
        provisional: {
          ready: false,
          baseReady: false,
          baseGrossPay: null,
          incomingCarryoverCount: 0,
          incomingCarryoverStatus: 'none',
          carryoverAdjustmentAmount: 0,
          grossPayPreview: null,
          grossPayPreviewStatus: null,
          unresolvedRateCount: 0,
        },
        accounting: { confirmed: false, stale: false, differenceCount: 0 },
        finalization: { allowed: false, blockers: ['attendance_not_imported'], locked: false },
      },
      exceptions: [],
    },
    {
      id: 'exceptions',
      label: '2. 예외 확인',
      snapshot: {
        month: '2026-09',
        import: { completed: true, rawRows: 483 },
        exceptions: { unresolvedImportant: 3 },
        provisional: {
          ready: false,
          baseReady: false,
          baseGrossPay: null,
          incomingCarryoverCount: 0,
          incomingCarryoverStatus: 'none',
          carryoverAdjustmentAmount: 0,
          grossPayPreview: null,
          grossPayPreviewStatus: null,
          unresolvedRateCount: 0,
        },
        accounting: { confirmed: false, stale: false, differenceCount: 0 },
        finalization: { allowed: false, blockers: ['important_exceptions_unresolved'], locked: false },
      },
      exceptions: [
        {
          id: 'EX-001',
          type: 'attendance_missing',
          severity: 'high',
          date: '2026-09-07',
          employeeDisplay: '익명 근로자 A',
          detail: '출근 기록이 없어 확인이 필요합니다.',
        },
        {
          id: 'EX-002',
          type: 'manual_record',
          severity: 'medium',
          date: '2026-09-12',
          employeeDisplay: '익명 근로자 B',
          detail: '수기 기록의 확정 근로시간을 확인해 주세요.',
        },
        {
          id: 'EX-003',
          type: 'employment_period_conflict',
          severity: 'critical',
          date: '2026-09-04',
          employeeDisplay: '익명 근로자 C',
          detail: '출퇴근 원본과 입·퇴사 이력이 맞지 않습니다.',
        },
      ],
    },
    {
      id: 'provisional',
      label: '3. 급여 가안',
      snapshot: {
        month: '2026-09',
        import: { completed: true, rawRows: 483 },
        exceptions: { unresolvedImportant: 0 },
        provisional: {
          ready: false,
          baseReady: true,
          baseGrossPay: 18240000,
          incomingCarryoverCount: 2,
          incomingCarryoverStatus: 'review_required',
          carryoverAdjustmentAmount: null,
          grossPayPreview: null,
          grossPayPreviewStatus: 'review_required',
          unresolvedRateCount: 0,
        },
        accounting: { confirmed: false, stale: false, differenceCount: 0 },
        finalization: { allowed: false, blockers: ['carryover_not_reviewed'], locked: false },
      },
      exceptions: [],
    },
    {
      id: 'accounting',
      label: '4. 회계 대조',
      snapshot: {
        month: '2026-09',
        import: { completed: true, rawRows: 483 },
        exceptions: { unresolvedImportant: 0 },
        provisional: {
          ready: true,
          baseReady: true,
          baseGrossPay: 18240000,
          incomingCarryoverCount: 2,
          incomingCarryoverStatus: 'complete',
          carryoverAdjustmentAmount: -61920,
          grossPayPreview: 18178080,
          grossPayPreviewStatus: 'complete',
          unresolvedRateCount: 0,
        },
        accounting: { confirmed: false, stale: false, differenceCount: 4 },
        finalization: { allowed: false, blockers: ['accounting_values_unconfirmed'], locked: false },
      },
      exceptions: [],
    },
    {
      id: 'finalize',
      label: '5. 급여 확정',
      snapshot: {
        month: '2026-09',
        import: { completed: true, rawRows: 483 },
        exceptions: { unresolvedImportant: 0 },
        provisional: {
          ready: true,
          baseReady: true,
          baseGrossPay: 18240000,
          incomingCarryoverCount: 2,
          incomingCarryoverStatus: 'complete',
          carryoverAdjustmentAmount: -61920,
          grossPayPreview: 18178080,
          grossPayPreviewStatus: 'complete',
          unresolvedRateCount: 0,
        },
        accounting: { confirmed: true, stale: false, differenceCount: 0 },
        finalization: { allowed: true, blockers: [], locked: false },
      },
      exceptions: [],
    },
    {
      id: 'locked',
      label: '5. 확정 완료',
      snapshot: {
        month: '2026-09',
        import: { completed: true, rawRows: 483 },
        exceptions: { unresolvedImportant: 0 },
        provisional: {
          ready: true,
          baseReady: true,
          baseGrossPay: 18240000,
          incomingCarryoverCount: 2,
          incomingCarryoverStatus: 'complete',
          carryoverAdjustmentAmount: -61920,
          grossPayPreview: 18178080,
          grossPayPreviewStatus: 'complete',
          unresolvedRateCount: 0,
        },
        accounting: { confirmed: true, stale: false, differenceCount: 0 },
        finalization: { allowed: false, blockers: ['already_locked'], locked: true },
      },
      serviceSnapshot: lockedServiceSnapshot,
      exceptions: [],
    },
  ];

  const state = { demoIndex: 1, outputOpen: false };

  function money(value) {
    if (value === null || value === undefined || value === '') return '—';
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `${Math.round(number).toLocaleString('ko-KR')}원`;
  }

  function dateLabel(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return '—';
    return `${match[1]}.${match[2]}.${match[3]}`;
  }

  function grossLabel(snapshot) {
    const provisional = snapshot.provisional || {};
    const incomingCount = Number(provisional.incomingCarryoverCount || 0);
    if (Number(provisional.unresolvedRateCount || 0) > 0) return '조건 확인 필요';
    if (incomingCount > 0 && provisional.incomingCarryoverStatus !== 'complete') {
      return '전월 조정 반영 필요';
    }
    if (provisional.grossPayPreviewStatus === 'review_required') return '조건 확인 필요';
    if (provisional.ready !== true) return '계산 전';
    return money(provisional.grossPayPreview);
  }

  function accountingLabel(snapshot) {
    const accounting = snapshot.accounting || {};
    const provisional = snapshot.provisional || {};
    if (accounting.stale === true || accounting.status === 'stale') return '다시 대조';
    if (accounting.confirmed === true) return '완료';
    if (provisional.ready === true) return `${Number(accounting.differenceCount || 0)}명`;
    return '대조 전';
  }

  function carryoverStatusLabel(provisional) {
    const count = Number(provisional.incomingCarryoverCount || 0);
    if (count === 0) return '없음';
    if (provisional.incomingCarryoverStatus === 'complete') return `${count}건 반영 완료`;
    return `${count}건 반영 필요`;
  }

  function renderPayrollBreakdown(snapshot) {
    const provisional = snapshot.provisional || {};
    const breakdown = document.querySelector('[data-payroll-breakdown]');
    if (!breakdown) return;

    const incomingCount = Number(provisional.incomingCarryoverCount || 0);
    const show = provisional.baseGrossPay !== null
      && provisional.baseGrossPay !== undefined
      || incomingCount > 0;
    breakdown.hidden = !show;
    if (!show) return;

    const carryoverComplete = incomingCount === 0 || provisional.incomingCarryoverStatus === 'complete';
    setText('[data-payroll-base-gross]', money(provisional.baseGrossPay));
    setText(
      '[data-payroll-carryover]',
      incomingCount === 0
        ? '0원'
        : carryoverComplete
          ? money(provisional.carryoverAdjustmentAmount)
          : '반영 전'
    );
    setText(
      '[data-payroll-adjusted-gross]',
      provisional.ready === true ? money(provisional.grossPayPreview) : '반영 후 계산'
    );
    setText('[data-payroll-carryover-status]', carryoverStatusLabel(provisional));
    setMetricState('carryover', incomingCount > 0 && !carryoverComplete ? 'attention' : 'normal');
  }

  function renderLockedOutput(demo, result) {
    const panel = document.querySelector('[data-payroll-output]');
    if (!panel) return;

    const show = Boolean(result.complete && demo.serviceSnapshot && state.outputOpen);
    panel.hidden = !show;
    if (!show) return;

    try {
      const output = outputApi.buildLockedPayrollOutput(demo.serviceSnapshot);
      setText('[data-output-locked-at]', dateLabel(output.lockedAt));
      setText('[data-output-adjusted-gross]', money(output.totals.adjustedGrossPay));
      setText('[data-output-accounting]', output.accounting.confirmed ? '대조 완료' : '확인 필요');
      setText(
        '[data-output-carryover]',
        output.carryover.outgoingCount > 0
          ? `${output.carryover.outgoingCount}건 확인 완료`
          : '없음'
      );
    } catch (error) {
      panel.hidden = false;
      setText('[data-output-locked-at]', '확인 필요');
      setText('[data-output-adjusted-gross]', '확인 필요');
      setText('[data-output-accounting]', '다시 확인');
      setText('[data-output-carryover]', '다시 확인');
    }
  }

  function render() {
    const demo = demoSnapshots[state.demoIndex];
    const result = workflow.buildOperatorWorkflow(demo.snapshot);
    const queue = workflow.buildExceptionQueue(demo.exceptions);

    const monthLabel = document.querySelector('[data-payroll-month]');
    if (monthLabel) monthLabel.textContent = '2026년 9월';

    const stepper = document.querySelector('[data-payroll-stepper]');
    if (stepper) {
      stepper.innerHTML = result.steps.map((step, index) => `
        <article class="payroll-step" data-status="${step.status}" ${step.id === result.currentStep ? 'aria-current="step"' : ''}>
          <span class="payroll-step-index">${index + 1}단계 · ${statusLabel(step.status)}</span>
          <strong>${escapeHtml(step.title)}</strong>
          <small>${escapeHtml(step.description)}</small>
        </article>
      `).join('');
    }

    setText('[data-metric-import]', result.summary.rawRows ? `${result.summary.rawRows}건` : '대기');
    setText('[data-metric-exception]', `${result.summary.unresolvedImportant}건`);
    setText('[data-metric-gross]', grossLabel(demo.snapshot));
    setText('[data-metric-accounting]', accountingLabel(demo.snapshot));
    renderPayrollBreakdown(demo.snapshot);
    renderLockedOutput(demo, result);

    setMetricState('exception', result.summary.unresolvedImportant > 0 ? 'attention' : 'normal');
    setMetricState(
      'gross',
      grossLabel(demo.snapshot).includes('필요') ? 'attention' : 'normal'
    );
    setMetricState(
      'accounting',
      accountingLabel(demo.snapshot) === '다시 대조' ? 'attention' : 'normal'
    );

    const alert = document.querySelector('[data-payroll-alert]');
    if (alert) {
      const current = result.steps.find((step) => step.id === result.currentStep);
      alert.innerHTML = `
        <div aria-hidden="true">●</div>
        <div>
          <strong>${result.complete ? '처리 완료' : '지금 할 일'} · ${escapeHtml(current ? current.title : '급여관리')}</strong>
          <p>${escapeHtml(current ? current.description : '')}</p>
        </div>
      `;
    }

    const exceptionList = document.querySelector('[data-payroll-exceptions]');
    if (exceptionList) {
      exceptionList.innerHTML = queue.length
        ? queue.map((item) => `
            <article class="payroll-exception" data-severity="${escapeHtml(item.severity)}">
              <div>
                <h3 class="payroll-exception-title">${escapeHtml(item.operatorLabel)} · ${escapeHtml(item.employeeDisplay || '직원')}</h3>
                <p class="payroll-exception-meta">${escapeHtml(item.date || '')} · ${escapeHtml(item.detail || '')}</p>
              </div>
              <button class="payroll-button secondary" type="button" data-demo-resolve="${escapeHtml(item.id)}">확인</button>
            </article>
          `).join('')
        : '<div class="payroll-clear-state"><div class="payroll-clear-icon">✓</div><div><strong>확인 필요한 중요 항목 0건</strong><p>정상 데이터는 시스템이 처리하고 있습니다.</p></div></div>';
    }

    const primary = document.querySelector('[data-payroll-primary]');
    if (primary) {
      primary.textContent = result.primaryAction.label;
      primary.dataset.action = result.primaryAction.id;
    }

    const demoControls = document.querySelector('[data-demo-controls]');
    if (demoControls) {
      demoControls.innerHTML = `
        <p class="payroll-demo-label">Preview 단계 보기</p>
        ${demoSnapshots.map((item, index) => `
          <button type="button" data-demo-index="${index}" aria-pressed="${index === state.demoIndex}">${escapeHtml(item.label)}</button>
        `).join('')}
      `;
    }
  }

  function statusLabel(status) {
    if (status === workflow.StepStatus.DONE) return '완료';
    if (status === workflow.StepStatus.CURRENT) return '진행';
    if (status === workflow.StepStatus.BLOCKED) return '대기';
    return '예정';
  }

  function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  }

  function setMetricState(name, value) {
    const element = document.querySelector(`[data-metric-card="${name}"]`);
    if (element) element.dataset.state = value;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  document.addEventListener('click', (event) => {
    const demoButton = event.target.closest('[data-demo-index]');
    if (demoButton) {
      state.demoIndex = Number(demoButton.dataset.demoIndex);
      state.outputOpen = false;
      render();
      return;
    }

    const primary = event.target.closest('[data-payroll-primary]');
    if (primary) {
      if (primary.dataset.action === 'view_locked_output') {
        state.outputOpen = true;
      } else {
        state.demoIndex = Math.min(state.demoIndex + 1, demoSnapshots.length - 1);
        state.outputOpen = false;
      }
      render();
    }
  });

  render();
})();
