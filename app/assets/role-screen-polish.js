(() => {
  'use strict';

  const ROLE_LABELS = {
    general_worker: '일반직원',
    promotion_staff: '홍보직원',
    promotion_lead: '운영팀장',
    operations_manager: '운영총괄',
    department_lead: '부서팀장',
    field_lead: '현장반장',
    ceo: '대표이사',
    super_admin: '시스템 관리'
  };

  let navTimer = null;

  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const cleanLabel = node => (node?.textContent || '').replace(/\s*·\s*점검중\s*$/, '').trim();

  function installWorkerFallbackStyles() {
    if (document.querySelector('style[data-role-screen-polish]')) return;
    const style = document.createElement('style');
    style.dataset.roleScreenPolish = '1';
    style.textContent = `
      body.general-worker-mode { background:#f6f6f2; }
      body.general-worker-mode > .staff-shell { width:min(100%,620px); margin:0 auto; padding:0 18px 36px; }
      body.general-worker-mode .staff-header { min-height:68px; position:sticky; top:0; z-index:20; background:rgba(246,246,242,.96); backdrop-filter:blur(10px); }
      body.general-worker-mode .staff-brand { color:#173f31; font-size:24px; font-weight:900; text-decoration:none; }
      body.general-worker-mode #general-worker-board.worker-v1-hidden { display:none !important; }
      body.general-worker-mode .worker-mobile-home { display:grid; gap:18px; padding:18px 0 36px; }
      body.general-worker-mode .worker-mobile-hero { padding:8px 2px 2px; }
      body.general-worker-mode .worker-mobile-hero .worker-date { margin:0 0 4px; color:#59645f; font-size:17px; font-weight:800; }
      body.general-worker-mode .worker-mobile-hero h1 { margin:0; color:#12251e; font-size:30px; line-height:1.25; letter-spacing:-.03em; }
      body.general-worker-mode .worker-card,
      body.general-worker-mode .worker-install-card,
      body.general-worker-mode .employee-card { background:#fff; border:1px solid #deded7; border-radius:20px; padding:20px; box-shadow:0 8px 26px rgba(0,0,0,.045); }
      body.general-worker-mode .worker-card h2,
      body.general-worker-mode .worker-install-card h2,
      body.general-worker-mode .employee-card h2 { margin:0 0 10px; color:#12251e; font-size:23px; line-height:1.3; }
      body.general-worker-mode .worker-card p,
      body.general-worker-mode .worker-install-card p,
      body.general-worker-mode .employee-card p { font-size:18px; line-height:1.55; }
      body.general-worker-mode .worker-primary-button,
      body.general-worker-mode .worker-secondary-button,
      body.general-worker-mode .worker-ack-button,
      body.general-worker-mode .employee-primary-button,
      body.general-worker-mode .employee-secondary-button { width:100%; min-height:60px; border-radius:16px; font:inherit; font-size:19px; font-weight:900; cursor:pointer; }
      body.general-worker-mode .worker-primary-button,
      body.general-worker-mode .worker-ack-button,
      body.general-worker-mode .employee-primary-button { border:0; background:#173f31; color:#fff; }
      body.general-worker-mode .worker-secondary-button,
      body.general-worker-mode .employee-secondary-button { border:1px solid #d9ddd8; background:#eef1ed; color:#17211d; }
      body.general-worker-mode .employee-role-switch-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
      body.general-worker-mode .employee-role-switch-grid button { min-height:48px; padding:9px 10px; border:1px solid #d8d8d1; border-radius:13px; background:#fff; color:#17211d; font:inherit; font-weight:850; }
      body.general-worker-mode .employee-role-switch-grid button[aria-pressed="true"] { background:#173f31; border-color:#173f31; color:#fff; }
      @media(max-width:640px){
        body.general-worker-mode > .staff-shell { width:100%; padding-left:14px; padding-right:14px; }
        body.general-worker-mode .employee-role-switch-grid { grid-template-columns:1fr 1fr; }
      }
    `;
    document.head.append(style);
  }

  function installNavigationGuardStyles() {
    // Sidebar visibility is capability-driven. Do not add role-specific CSS hiding here.
  }

  function markEffectiveRole() {
    const nav = document.getElementById('app-nav');
    if (!nav) return;
    nav.dataset.effectiveRole = route() || '';
  }

  function recoverGeneralWorkerScreen() {
    if (route() !== 'general_worker') return;
    document.getElementById('general-worker-board')?.classList.add('worker-v1-hidden');

    const employeeHome = document.getElementById('employee-common-home');
    if (employeeHome) {
      document.body.classList.remove('general-worker-mode');
      document.body.classList.add('employee-home-mode');
      employeeHome.hidden = false;

      const workerHome = document.getElementById('worker-mobile-home');
      if (workerHome) workerHome.hidden = true;
      return;
    }

    // Compatibility fallback only: the canonical production surface is now
    // employee-common-home. Keep the old worker surface usable only if a stale
    // or partially loaded client still created it.
    const workerHome = document.getElementById('worker-mobile-home');
    if (!workerHome) return;
    installWorkerFallbackStyles();
    document.body.classList.add('general-worker-mode');
    document.body.classList.remove('employee-home-mode');
    workerHome.hidden = false;
  }

  function fixTopbarIdentity() {
    const label = document.getElementById('desktop-user-label');
    if (!label) return;
    const currentRoute = route();
    const displayName = app()?.getContext?.()?.display_name || '사용자';
    const roleLabel = ROLE_LABELS[currentRoute] || currentRoute || '업무';
    const current = label.textContent.trim();
    if (!current || /undefined|null/.test(current)) label.textContent = `${displayName} · ${roleLabel}`;
  }

  function suppress(node) {
    if (!node) return;
    node.hidden = true;
    node.dataset.navSuppressed = '1';
    node.setAttribute('aria-hidden', 'true');
    node.removeAttribute('aria-current');
  }

  function directItems(nav) {
    return [...nav.children];
  }

  function find(nav, labels, { visibleOnly = false } = {}) {
    const wanted = new Set(Array.isArray(labels) ? labels : [labels]);
    return directItems(nav).find(node => {
      if (visibleOnly && (node.hidden || node.dataset.navSuppressed === '1')) return false;
      return wanted.has(cleanLabel(node));
    }) || null;
  }

  function supportGroup(nav) {
    return directItems(nav).find(node => node.dataset?.supportRadarNavGroup || node.dataset?.supportMyWorkNav) || null;
  }

  function moveAfter(nav, node, anchor) {
    if (!node || !anchor || node === anchor || node.hidden) return;
    const reference = anchor.nextSibling;
    if (reference === node) return;
    nav.insertBefore(node, reference);
  }

  function removeCheckingNavigation() {
    const currentRoute = route();
    if (!currentRoute || currentRoute === 'general_worker') return;
    const nav = document.getElementById('app-nav');
    if (!nav) return;

    directItems(nav).forEach(node => {
      const label = cleanLabel(node);
      const markedChecking = node.dataset?.featureStatus === 'checking'
        || /\s*·\s*점검중\s*$/.test(node.textContent || '')
        || label === '신규 사업 기획';
      if (markedChecking) node.remove();
    });
  }

  function tidyOperationsNavigation() {
    // Kept as a compatibility hook. MASTER_ORDER owns sidebar order.
  }

  function tidyLeadNavigation() {
    // Kept as a compatibility hook. MASTER_ORDER owns sidebar order.
  }

  function apply() {
    installNavigationGuardStyles();
    markEffectiveRole();
    recoverGeneralWorkerScreen();
    fixTopbarIdentity();
    removeCheckingNavigation();
    tidyLeadNavigation();
    tidyOperationsNavigation();
  }

  function scheduleNavigationPass(delay = 150) {
    if (navTimer) clearTimeout(navTimer);
    navTimer = setTimeout(() => {
      navTimer = null;
      window.TaejangRoleNavigationPriority?.reorder?.();
      apply();
    }, delay);
  }

  document.addEventListener('taejang-app-ready', () => {
    setTimeout(() => {
      installNavigationGuardStyles();
      markEffectiveRole();
      recoverGeneralWorkerScreen();
      fixTopbarIdentity();
    }, 0);
    scheduleNavigationPass(150);
  });
  document.addEventListener('taejang-dashboard-refresh', () => scheduleNavigationPass(0));
  document.addEventListener('taejang-capabilities-ready', () => scheduleNavigationPass(0));
  document.addEventListener('taejang-navigation-changed', () => scheduleNavigationPass(0));

  window.TaejangRoleScreenPolish = { apply, recoverGeneralWorkerScreen, removeCheckingNavigation, tidyOperationsNavigation, tidyLeadNavigation };
})();
