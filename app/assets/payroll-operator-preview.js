(function initPayrollOperatorPreview() {
  'use strict';

  const workflow = globalThis.TaejangPayrollOperatorWorkflow;
  if (!workflow) return;

  const demoSnapshots = [
    {
      id: 'import',
      label: '1. 가져오기 전',
      snapshot: {
        month: '2026-09',
        import: { completed: false, rawRows: 0 },
        exceptions: { unresolvedImportant: 0 },
        provisional: { ready: false },
        accounting: { confirmed: false, differenceCount: 0 },
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
        provisional: { ready: false },
        accounting: { confirmed: false, differenceCount: 0 },
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
        provisional: { ready: false, grossPayPreview: null, unresolvedRateCount: 0 },
        accounting: { confirmed: false, differenceCount: 0 },
        finalization: { allowed: false, blockers: ['provisional_not_ready'], locked: false },
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
        provisional: { ready: true, grossPayPreview: 18240000, unresolvedRateCount: 0 },
        accounting: { confirmed: false, differenceCount: 4 },
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
        provisional: { ready: true, grossPayPreview: 18240000, unresolvedRateCount: 0 },
        accounting: { confirmed: true, differenceCount: 0 },
        finalization: { allowed: true, blockers: [], locked: false },
      },
      exceptions: [],
    },
  ];

  const state = { demoIndex: 1 };

  function money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `${Math.round(number).toLocaleString('ko-KR')}원`;
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
        <article class="payroll-step" data-status="${step.status}">
          <span class="payroll-step-index">${index + 1}단계 · ${statusLabel(step.status)}</span>
          <strong>${escapeHtml(step.title)}</strong>
          <small>${escapeHtml(step.description)}</small>
        </article>
      `).join('');
    }

    setText('[data-metric-import]', result.summary.rawRows ? `${result.summary.rawRows}건` : '대기');
    setText('[data-metric-exception]', `${result.summary.unresolvedImportant}건`);
    setText('[data-metric-gross]', money(demo.snapshot.provisional && demo.snapshot.provisional.grossPayPreview));
    setText('[data-metric-accounting]', `${result.summary.accountingDifferences}명`);

    const alert = document.querySelector('[data-payroll-alert]');
    if (alert) {
      const current = result.steps.find((step) => step.id === result.currentStep);
      alert.innerHTML = `
        <div aria-hidden="true">●</div>
        <div>
          <strong>지금 할 일: ${escapeHtml(current ? current.title : '급여관리')}</strong>
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
        : '<div class="payroll-alert" style="background: var(--payroll-accent-soft); color: var(--payroll-accent);"><div>✓</div><div><strong>중요 예외 0건</strong><p>정상 데이터는 시스템이 처리하고 있습니다.</p></div></div>';
    }

    const primary = document.querySelector('[data-payroll-primary]');
    if (primary) {
      primary.textContent = result.primaryAction.label;
      primary.dataset.action = result.primaryAction.id;
    }

    const demoControls = document.querySelector('[data-demo-controls]');
    if (demoControls) {
      demoControls.innerHTML = demoSnapshots.map((item, index) => `
        <button type="button" data-demo-index="${index}" aria-pressed="${index === state.demoIndex}">${escapeHtml(item.label)}</button>
      `).join('');
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
      render();
      return;
    }

    const primary = event.target.closest('[data-payroll-primary]');
    if (primary) {
      state.demoIndex = Math.min(state.demoIndex + 1, demoSnapshots.length - 1);
      render();
    }
  });

  render();
})();
