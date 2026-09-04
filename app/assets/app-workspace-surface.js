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

  function showDashboard() {
    hidePanels();
    const dashboard = byId('dashboard-main');
    if (dashboard) dashboard.hidden = false;
  }

  function openPanel(id) {
    if (!PANEL_IDS.includes(id)) return;
    mountPanels();
    hidePanels(id);
    const dashboard = byId('dashboard-main');
    if (dashboard) dashboard.hidden = true;
  }

  function start() {
    injectStyle();
    mountPanels();
  }

  document.addEventListener('taejang-open-app-panel', event => openPanel(event.detail?.id), true);
  document.addEventListener('taejang-dashboard-refresh', showDashboard, true);
  document.addEventListener('taejang-open-employee-management', showDashboard, true);
  document.addEventListener('taejang-open-promotion-workspace', showDashboard, true);

  start();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
})();
