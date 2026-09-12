(() => {
  'use strict';

  const terminalStatuses = new Set(['selected', 'not_selected', 'cancelled']);
  const state = { saving: false };
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value ?? '';
    return node;
  };
  const canUse = () => Boolean(window.TaejangSupportRadarAccess?.canManagementEdit?.());
  const money = value => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? `${new Intl.NumberFormat('ko-KR').format(amount)}원` : '0원';
  };
  const formatDateTime = value => {
    if (!value) return '아직 기록되지 않음';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Seoul'
    }).format(date);
  };
  const resultLabel = value => ({ selected: '선정', not_selected: '미선정', cancelled: '취소' })[value] || value || '미기록';

  function stat(label, value) {
    const node = document.createElement('article');
    node.className = 'support-radar-stat';
    node.append(text('span', label, 'support-radar-muted'), text('strong', value));
    return node;
  }

  function field(label, input) {
    const wrap = document.createElement('label');
    wrap.append(text('span', label), input);
    return wrap;
  }

  function syncBenefitInputs(status, cash, inKind) {
    const selected = status === 'selected';
    cash.disabled = !selected;
    inKind.disabled = !selected;
    if (!selected) {
      cash.value = '';
      inKind.value = '';
    }
  }

  async function saveResult(noticeId, data, status, summary, cash, inKind, saveButton) {
    if (!canUse() || state.saving) return;
    if (!terminalStatuses.has(status.value)) {
      window.alert('선정, 미선정 또는 취소 중 결과를 선택해주세요.');
      return;
    }

    state.saving = true;
    saveButton.disabled = true;
    try {
      await window.TaejangApp.rpc('support_update_application_status', {
        p_notice_id: noticeId,
        p_status: status.value,
        p_next_action: data.application.next_action || null,
        p_result_summary: summary.value.trim() || null,
        p_actual_cash_benefit: status.value === 'selected' && cash.value !== '' ? Number(cash.value) : null,
        p_actual_in_kind_value: status.value === 'selected' && inKind.value !== '' ? Number(inKind.value) : null
      });
      await window.TaejangSupportRadarNotices?.renderDetail?.(noticeId);
    } catch (error) {
      window.alert(window.TaejangApp.friendlyError(error));
    } finally {
      state.saving = false;
      saveButton.disabled = false;
    }
  }

  function inject(noticeId, data) {
    if (!canUse() || !noticeId || !data?.application) return;
    const root = document.getElementById('dashboard-main')?.querySelector('.support-radar-shell');
    if (!root) return;

    root.querySelector('[data-support-result-record]')?.remove();

    const panel = document.createElement('section');
    panel.className = 'support-radar-section';
    panel.dataset.supportResultRecord = '1';
    panel.append(
      text('h3', '결과·수혜이력'),
      text('p', '최종 결과와 실제 지원 규모를 기록합니다. 선정 금액은 지원사업 KPI의 실제 수혜 합계에 자동 반영됩니다.', 'support-radar-muted')
    );

    if (terminalStatuses.has(data.application.status)) {
      const selected = data.application.status === 'selected';
      const summary = document.createElement('div');
      summary.className = 'support-radar-summary';
      summary.append(
        stat('최종 결과', resultLabel(data.application.status)),
        stat('결과 기록일', formatDateTime(data.application.result_recorded_at)),
        stat('실제 현금지원', selected ? money(data.application.actual_cash_benefit) : '해당 없음'),
        stat('실제 현물가치', selected ? money(data.application.actual_in_kind_value) : '해당 없음')
      );
      panel.append(summary);
      if (data.application.result_summary) panel.append(text('p', `결과 메모: ${data.application.result_summary}`, 'support-radar-note'));
    } else {
      panel.append(text('p', '아직 최종 결과가 기록되지 않았습니다.', 'support-radar-warning'));
    }

    const controls = document.createElement('div');
    controls.className = 'support-radar-grid';

    const status = document.createElement('select');
    [['', '결과 선택'], ['selected', '선정'], ['not_selected', '미선정'], ['cancelled', '취소']].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = value === data.application.status;
      status.append(option);
    });

    const summaryInput = document.createElement('textarea');
    summaryInput.rows = 3;
    summaryInput.maxLength = 5000;
    summaryInput.placeholder = '예: 최종 선정 통보 수신, 지원금 1,000만원 확정';
    summaryInput.value = data.application.result_summary || '';

    const cash = document.createElement('input');
    cash.type = 'number';
    cash.min = '0';
    cash.step = '1';
    cash.placeholder = '실제 현금지원액';
    cash.value = data.application.actual_cash_benefit ?? '';

    const inKind = document.createElement('input');
    inKind.type = 'number';
    inKind.min = '0';
    inKind.step = '1';
    inKind.placeholder = '실제 현물가치';
    inKind.value = data.application.actual_in_kind_value ?? '';

    syncBenefitInputs(status.value, cash, inKind);
    status.addEventListener('change', () => syncBenefitInputs(status.value, cash, inKind));

    const saveButton = text('button', '결과 저장', 'button');
    saveButton.type = 'button';
    saveButton.addEventListener('click', () => saveResult(noticeId, data, status, summaryInput, cash, inKind, saveButton));

    controls.append(
      field('최종 결과', status),
      field('결과 메모', summaryInput),
      field('실제 현금지원액', cash),
      field('실제 현물가치', inKind),
      saveButton
    );
    panel.append(controls);

    const progressHeading = [...root.querySelectorAll('h3')].find(node => node.textContent === '신청 진행');
    const progressSection = progressHeading?.closest('.support-radar-section');
    if (progressSection) progressSection.insertAdjacentElement('afterend', panel);
    else root.append(panel);
  }

  document.addEventListener('taejang-support-radar-rendered', event => {
    if (!canUse() || event.detail?.surface !== 'notice-detail') return;
    const noticeId = event.detail.noticeId || null;
    const data = event.detail.data;
    queueMicrotask(() => inject(noticeId, data));
  });
})();
