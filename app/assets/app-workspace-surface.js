(() => {
  'use strict';

  const PANEL_IDS = [
    'schedule-admin-panel',
    'notice-admin-panel',
    'guidance-admin-panel'
  ];
  const PANEL_CAPABILITIES = Object.freeze({
    'schedule-admin-panel': 'schedule.manage',
    'notice-admin-panel': 'notice.manage',
    'guidance-admin-panel': 'guidance.manage'
  });
  const PANEL_TITLES = Object.freeze({
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

  function showDashboard() {
    mountPanels();
    hidePanels();
    const dashboard = byId('dashboard-main');
    if (dashboard) dashboard.hidden = false;
  }

  function bindNavigationSurfaceReset() {
    const nav = byId('app-nav');
    if (!nav || nav.dataset.workspaceSurfaceResetBound === '1') return;
    nav.dataset.workspaceSurfaceResetBound = '1';
    nav.addEventListener('click', event => {
      const target = event.target?.closest?.('button, a');
      if (!target || !nav.contains(target)) return;
      if (target.dataset?.navSectionToggle === '1') return;
      if (target.tagName === 'A' && target.target === '_blank') return;
      // Every in-app sidebar destination starts from one canonical surface state.
      // The destination handler may immediately open another legacy panel again.
      showDashboard();
    }, true);
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
    bindNavigationSurfaceReset();
  }

  document.addEventListener('taejang-open-app-panel', event => openPanel(event.detail?.id, event.detail?.view), true);
  document.addEventListener('taejang-dashboard-refresh', showDashboard, true);
  document.addEventListener('taejang-open-employee-management', showDashboard, true);
  document.addEventListener('taejang-open-promotion-workspace', showDashboard, true);
  document.addEventListener('taejang-open-homepage-content', showDashboard, true);
  document.addEventListener('taejang-open-account-approval', showDashboard, true);
  document.addEventListener('taejang-open-platform-settings', showDashboard, true);

  window.TaejangAppWorkspaceSurface = {
    showDashboard,
    openPanel,
    hidePanels,
    mountPanels
  };

  start();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
})();
