(() => {
  'use strict';

  const PANEL_IDS = [
    'today-admin-panel',
    'schedule-admin-panel',
    'notice-admin-panel',
    'guidance-admin-panel'
  ];
  const PANEL_CAPABILITIES = Object.freeze({
    'today-admin-panel': 'task.manage',
    'schedule-admin-panel': 'schedule.manage',
    'notice-admin-panel': 'notice.manage',
    'guidance-admin-panel': 'guidance.manage'
  });
  const PANEL_TITLES = Object.freeze({
    'today-admin-panel': '업무 배정',
    'schedule-admin-panel': '일정 관리',
    'notice-admin-panel': '공지 관리',
    'guidance-admin-panel': '상시 안내 관리'
  });

  const byId = id => document.getElementById(id);

  function injectStyle() {
    if (document.querySelector('style[data-app-workspace-surface]')) return;
    const style = document.createElement('style');
    style.dataset.appWorkspaceSurface = '1';
    style.textContent = `
      .app-workspace > .app-workspace-panel {
        width:min(100% - 40px, var(--app-content-width));
        margin:32px auto 48px;
      }
      @media(max-width:900px){
        .app-workspace > .app-workspace-panel { width:min(100% - 28px, var(--app-content-width)); margin-top:24px; }
      }
    `;
    document.head.append(style);
  }

  function mountPanels() {
    const workspace = document.querySelector('.app-workspace');
    if (!workspace) return false;
    let mounted = false;
    PANEL_IDS.forEach(id => {
      const panel = byId(id);
      if (!panel) return;
      panel.classList.add('app-workspace-panel');
      if (panel.parentElement !== workspace) workspace.append(panel);
      mounted = true;
    });
    return mounted;
  }

  function hidePanels(exceptId = null) {
    PANEL_IDS.forEach(id => {
      const panel = byId(id);
      if (panel) panel.hidden = id !== exceptId;
    });
  }

  function setHidden(node, hidden) {
    if (node) node.hidden = hidden;
  }

  function configureTodayAdmin(view = null) {
    const panel = byId('today-admin-panel');
    if (!panel) return;
    const workManual = view === 'work_manual';
    const app = window.TaejangApp;
    const canManageGuidance = app?.hasCapabilityContract?.()
      ? Boolean(app.can?.('guidance.manage'))
      : Boolean(app?.isTodayManager?.());
    panel.dataset.workspaceView = workManual ? 'work_manual' : 'all';

    const title = byId('today-admin-title');
    const eyebrow = title?.parentElement?.querySelector?.('.eyebrow');
    const topbar = byId('desktop-page-title');
    if (workManual) {
      if (eyebrow) eyebrow.textContent = '업무 참고';
      if (title) title.textContent = '작업 매뉴얼 관리';
      if (topbar) topbar.textContent = '작업 매뉴얼';
    } else {
      if (eyebrow) eyebrow.textContent = '관리자 검증 화면';
      if (title) title.textContent = '오늘 정보 등록·수정';
      if (topbar) topbar.textContent = '업무 배정';
    }

    const refresh = byId('refresh-admin');
    const panelHelp = panel.querySelector?.(':scope > .help');
    const boardDate = byId('admin-board-date')?.closest?.('label');
    const todayRecords = byId('admin-records-title')?.closest?.('.admin-records');
    const taskEditor = byId('task-form')?.closest?.('details');
    const informationEditor = byId('information-form')?.closest?.('details');
    const guideEditor = byId('guide-form')?.closest?.('details');
    const stepEditor = byId('guide-step-editor');
    const previewEditor = byId('guide-preview')?.closest?.('details');
    const guideRecords = byId('guide-manage-list')?.closest?.('.admin-records');

    setHidden(refresh, workManual);
    setHidden(panelHelp, workManual);
    setHidden(boardDate, workManual);
    setHidden(todayRecords, workManual);
    setHidden(taskEditor, workManual);
    setHidden(informationEditor, workManual);
    setHidden(guideEditor, !canManageGuidance);
    setHidden(stepEditor, !canManageGuidance);
    setHidden(previewEditor, !canManageGuidance);
    setHidden(guideRecords, !canManageGuidance);

    if (workManual && guideEditor) guideEditor.open = true;
  }

  function showDashboard() {
    hidePanels();
    const dashboard = byId('dashboard-main');
    if (dashboard) dashboard.hidden = false;
  }

  function openPanel(id, view = null) {
    const app = window.TaejangApp;
    const capability = PANEL_CAPABILITIES[id];
    const allowed = app?.hasCapabilityContract?.()
      ? Boolean(app.can?.(capability))
      : Boolean(app?.isTodayManager?.());
    if (!PANEL_IDS.includes(id) || !capability || !allowed) return;
    mountPanels();
    hidePanels(id);
    if (id === 'today-admin-panel') configureTodayAdmin(view);
    if (id === 'notice-admin-panel') {
      const noticeView = view === 'create' ? 'create' : 'manage';
      document.dispatchEvent(new CustomEvent('taejang-open-notice-admin', { detail: { view: noticeView } }));
    }
    const topbar = byId('desktop-page-title');
    if (topbar) {
      topbar.textContent = id === 'notice-admin-panel' && view === 'create'
        ? '공지 등록'
        : (PANEL_TITLES[id] || '업무');
    }
    const dashboard = byId('dashboard-main');
    if (dashboard) dashboard.hidden = true;
  }

  function start() {
    injectStyle();
    mountPanels();
  }

  document.addEventListener('taejang-open-app-panel', event => openPanel(event.detail?.id, event.detail?.view), true);
  document.addEventListener('taejang-dashboard-refresh', showDashboard, true);
  document.addEventListener('taejang-open-employee-management', showDashboard, true);
  document.addEventListener('taejang-open-promotion-workspace', showDashboard, true);

  start();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
})();
