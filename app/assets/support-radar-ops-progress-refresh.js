(() => {
  'use strict';

  const state = { noticeId: null, refreshing: false };
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value ?? '';
    return node;
  };
  const array = value => Array.isArray(value) ? value : [];
  const canUse = () => Boolean(window.TaejangSupportRadarAccess?.canManagementEdit?.());
  const statusLabel = value => ({
    reviewing: '검토 중',
    contacting_agency: '기관 문의',
    collecting_documents: '자료 수집',
    drafting_application: '신청서 작성',
    ready_to_submit: '제출 준비',
    submitted: '제출 완료',
    selected: '선정',
    not_selected: '미선정',
    cancelled: '취소'
  })[value] || value || '없음';

  function formatDateTime(value) {
    if (!value) return '기록 없음';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Seoul'
    }).format(date);
  }

  function stat(label, value, note = '') {
    const node = document.createElement('article');
    node.className = 'support-radar-stat';
    node.append(text('span', label, 'support-radar-muted'), text('strong', value));
    if (note) node.append(text('span', note, 'support-radar-muted'));
    return node;
  }

  async function refresh(noticeId) {
    if (!noticeId || state.refreshing) return;
    state.refreshing = true;
    try {
      await window.TaejangSupportRadarNotices?.renderDetail?.(noticeId);
    } finally {
      state.refreshing = false;
    }
  }

  function inject(noticeId, data) {
    if (!canUse() || !noticeId || !data?.application) return;
    const root = document.getElementById('dashboard-main')?.querySelector('.support-radar-shell');
    if (!root) return;

    root.querySelector('[data-support-ops-live-progress]')?.remove();

    const panel = document.createElement('section');
    panel.className = 'support-radar-section';
    panel.dataset.supportOpsLiveProgress = '1';
    panel.dataset.noticeId = noticeId;
    panel.append(
      text('h3', '담당자 진행 현황'),
      text('p', '담당자가 저장한 최신 진행내용입니다. 다른 탭이나 기기에서 수정한 뒤 최신 상태를 다시 확인할 수 있습니다.', 'support-radar-muted')
    );

    const assignees = array(data.assignments).map(item => item.display_name).filter(Boolean);
    const summary = document.createElement('div');
    summary.className = 'support-radar-summary';
    summary.append(
      stat('담당자', assignees.join(', ') || '미지정'),
      stat('현재 상태', statusLabel(data.application.status)),
      stat('다음 행동', data.application.next_action || '기록 없음'),
      stat('최근 업데이트', formatDateTime(data.application.updated_at))
    );
    panel.append(summary);

    const actions = document.createElement('div');
    actions.className = 'support-radar-actions';
    const refreshButton = text('button', '최신 상태 확인', 'button button-quiet');
    refreshButton.type = 'button';
    refreshButton.addEventListener('click', () => refresh(noticeId));
    actions.append(refreshButton);
    panel.append(actions);

    const assignmentPanel = root.querySelector('[data-support-assignment-panel]');
    if (assignmentPanel) assignmentPanel.insertAdjacentElement('afterend', panel);
    else {
      const decisionHeading = [...root.querySelectorAll('h3')].find(node => node.textContent === '운영총괄 결정');
      const decisionSection = decisionHeading?.closest('.support-radar-section');
      if (decisionSection) decisionSection.insertAdjacentElement('afterend', panel);
      else root.append(panel);
    }
  }

  document.addEventListener('taejang-support-radar-rendered', event => {
    if (!canUse()) return;
    if (event.detail?.surface !== 'notice-detail') {
      state.noticeId = null;
      return;
    }
    state.noticeId = event.detail.noticeId || null;
    const noticeId = state.noticeId;
    const data = event.detail.data;
    queueMicrotask(() => inject(noticeId, data));
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.noticeId || state.refreshing) return;
    const panel = document.querySelector('[data-support-ops-live-progress]');
    if (!panel || panel.dataset.noticeId !== state.noticeId) return;
    refresh(state.noticeId);
  });
})();