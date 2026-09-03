(() => {
  'use strict';

  const STORAGE_KEY = 'taejang-role-simulation-v1';
  const LABELS = {
    promotion_staff: '홍보직원',
    promotion_lead: '운영팀장'
  };
  let switching = false;

  const app = () => window.TaejangApp;
  const context = () => app()?.getContext?.();

  function installStyles() {
    if (document.querySelector('style[data-role-simulation]')) return;
    const style = document.createElement('style');
    style.dataset.roleSimulation = '1';
    style.textContent = `
      .role-simulation-switcher {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: #fff;
      }
      .role-simulation-switcher .button {
        min-height: 34px !important;
        padding: 7px 9px !important;
        font-size: .82rem;
      }
      .role-simulation-switcher .button[aria-pressed="true"] {
        background: #173f2c;
        color: #fff;
        border-color: #173f2c;
      }
      .role-simulation-banner {
        margin: 0;
        padding: 8px 14px;
        background: #fff3cd;
        border-bottom: 1px solid #e5cc79;
        color: #4b3b00;
        font-weight: 800;
        text-align: center;
      }
      .role-simulation-banner strong { color: #7a2f00; }
      @media (max-width: 900px) {
        .role-simulation-switcher {
          position: fixed;
          left: 10px;
          right: 10px;
          bottom: 10px;
          z-index: 50;
          justify-content: center;
          box-shadow: 0 8px 28px rgba(0,0,0,.16);
        }
        .role-simulation-switcher .button { flex: 1 1 0; }
        body:has(.role-simulation-switcher) { padding-bottom: 72px; }
      }
    `;
    document.head.append(style);
  }

  function renderBanner(simulation) {
    document.querySelector('[data-role-simulation-banner]')?.remove();
    if (!simulation?.active) return;
    const shell = document.getElementById('desktop-app-shell');
    const workspace = shell?.querySelector('.app-workspace');
    if (!workspace) return;
    const banner = document.createElement('p');
    banner.className = 'role-simulation-banner';
    banner.dataset.roleSimulationBanner = '1';
    const label = LABELS[simulation.role_code] || simulation.role_code;
    banner.append('권한 체험 중: ', Object.assign(document.createElement('strong'), { textContent: label }), ' · 이 화면에서는 해당 역할의 서버 권한만 행사됩니다.');
    const topbar = workspace.querySelector('.app-topbar');
    if (topbar?.nextSibling) workspace.insertBefore(banner, topbar.nextSibling);
    else workspace.append(banner);
  }

  async function switchMode(roleCode) {
    if (switching) return;
    switching = true;
    document.querySelectorAll('[data-role-simulation-button]').forEach(button => { button.disabled = true; });
    try {
      await app().rpc('set_role_simulation_mode', { p_role_code: roleCode });
      if (roleCode) sessionStorage.setItem(STORAGE_KEY, roleCode);
      else sessionStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    } catch (error) {
      switching = false;
      document.querySelectorAll('[data-role-simulation-button]').forEach(button => { button.disabled = false; });
      window.alert(app()?.friendlyError?.(error) || '권한 화면을 전환하지 못했습니다.');
    }
  }

  function makeButton(label, roleCode, pressed) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-quiet';
    button.textContent = label;
    button.dataset.roleSimulationButton = roleCode || 'actual';
    button.setAttribute('aria-pressed', String(pressed));
    button.addEventListener('click', () => switchMode(roleCode));
    return button;
  }

  function installSwitcher() {
    installStyles();
    const current = context();
    const simulation = current?.role_simulation;
    const actions = document.querySelector('.app-user-actions');
    if (!actions || !simulation?.can_switch) return;

    // A simulation must belong to this browser tab. Closing the tab or logging
    // in again without the local marker restores the real account automatically.
    const localMode = sessionStorage.getItem(STORAGE_KEY);
    if (simulation.active && localMode !== simulation.role_code) {
      switchMode(null);
      return;
    }
    if (!simulation.active && localMode) sessionStorage.removeItem(STORAGE_KEY);

    let switcher = actions.querySelector('[data-role-simulation-switcher]');
    if (switcher) switcher.remove();
    switcher = document.createElement('div');
    switcher.className = 'role-simulation-switcher';
    switcher.dataset.roleSimulationSwitcher = '1';
    switcher.setAttribute('aria-label', '권한 체험 화면 전환');

    const activeRole = simulation.active ? simulation.role_code : null;
    switcher.append(
      makeButton('홍보직원 보기', 'promotion_staff', activeRole === 'promotion_staff'),
      makeButton('운영팀장 보기', 'promotion_lead', activeRole === 'promotion_lead'),
      makeButton('운영총괄 복귀', null, !activeRole)
    );
    actions.prepend(switcher);
    renderBanner(simulation);

    const userLabel = document.getElementById('desktop-user-label');
    if (userLabel && simulation.active) {
      userLabel.textContent = `${current.display_name || '사용자'} · ${LABELS[simulation.role_code] || simulation.role_code} 체험`;
    }

    const desktopLogout = document.getElementById('desktop-logout-button');
    if (desktopLogout && !desktopLogout.dataset.roleSimulationLogoutBound) {
      desktopLogout.dataset.roleSimulationLogoutBound = '1';
      desktopLogout.addEventListener('click', async event => {
        const latest = context()?.role_simulation;
        if (!latest?.active || switching) {
          sessionStorage.removeItem(STORAGE_KEY);
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        switching = true;
        try { await app().rpc('set_role_simulation_mode', { p_role_code: null }); } catch { /* expires automatically */ }
        sessionStorage.removeItem(STORAGE_KEY);
        switching = false;
        document.getElementById('logout-button')?.click();
      }, true);
    }
  }

  document.addEventListener('taejang-app-ready', () => requestAnimationFrame(installSwitcher));
  document.addEventListener('taejang-dashboard-refresh', () => requestAnimationFrame(installSwitcher));
})();
