(() => {
  'use strict';

  const PANEL_IDS = [
    'today-admin-panel',
    'schedule-admin-panel',
    'notice-admin-panel',
    'guidance-admin-panel'
  ];

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
    setHidden(guideEditor, false);
    setHidden(stepEditor, false);
    setHidden(previewEditor, false);
    setHidden(guideRecords, false);

    if (workManual && guideEditor) guideEditor.open = true;
  }

  function showDashboard() {
    hidePanels();
    const dashboard = byId('dashboard-main');
    if (dashboard) dashboard.hidden = false;
  }

  function openPanel(id, view = null) {
    if (!PANEL_IDS.includes(id)) return;
    mountPanels();
    hidePanels(id);
    if (id === 'today-admin-panel') configureTodayAdmin(view);
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