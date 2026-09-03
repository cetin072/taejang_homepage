(() => {
  'use strict';

  function installStyles() {
    if (document.querySelector('style[data-phase-c-account-topbar]')) return;
    const style = document.createElement('style');
    style.dataset.phaseCAccountTopbar = '1';
    style.textContent = `
      @media (min-width: 901px) {
        body:has(#desktop-app-shell:not([hidden])) > .staff-shell > .staff-header {
          display: none !important;
        }
        body:has(#desktop-app-shell:not([hidden])) > .staff-shell {
          padding-bottom: 0;
        }
        #desktop-app-shell:not([hidden]) {
          min-height: 100vh;
          margin-top: 0;
          margin-bottom: 0;
        }
        #desktop-app-shell:not([hidden]) .app-topbar {
          position: sticky;
          top: 0;
          z-index: 24;
          min-height: 78px;
          padding-top: 12px;
          padding-bottom: 12px;
          box-shadow: 0 8px 20px rgba(22, 53, 38, .05);
        }
        #desktop-app-shell:not([hidden]) .app-user-actions {
          margin-left: auto;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          padding: 6px;
          border: 1px solid var(--app-border);
          border-radius: 14px;
          background: #f7faf8;
        }
        #desktop-app-shell:not([hidden]) .app-user-label {
          display: inline-flex;
          align-items: center;
          min-height: 38px;
          padding: 0 10px;
          color: var(--app-text);
          font-size: .9rem;
          font-weight: 800;
          white-space: nowrap;
        }
        #desktop-app-shell:not([hidden]) .app-user-actions .button {
          min-height: 38px;
          padding: 8px 12px;
          border-radius: 9px;
          white-space: nowrap;
        }
        #desktop-app-shell:not([hidden]) #desktop-logout-button {
          background: #173f2c;
          color: #fff;
        }
        #desktop-app-shell:not([hidden]) #desktop-logout-button:hover,
        #desktop-app-shell:not([hidden]) #desktop-logout-button:focus-visible {
          background: #0f3020;
          color: #fff;
        }
      }

      @media (max-width: 900px) {
        #desktop-app-shell:not([hidden]) .app-user-actions {
          margin-left: auto;
          gap: 6px;
        }
        #desktop-app-shell:not([hidden]) .app-user-actions [data-homepage-action],
        #desktop-app-shell:not([hidden]) .app-user-label {
          display: none;
        }
        #desktop-app-shell:not([hidden]) #desktop-logout-button {
          min-height: 40px;
          padding: 8px 11px;
        }
      }
    `;
    document.head.append(style);
  }

  function enhance() {
    installStyles();
    const logout = document.getElementById('desktop-logout-button');
    const user = document.getElementById('desktop-user-label');
    const actions = document.querySelector('.app-user-actions');
    if (!actions || !logout) return;
    actions.setAttribute('aria-label', '내 계정과 로그아웃');
    logout.setAttribute('aria-label', '현재 계정에서 로그아웃');
    if (user) user.setAttribute('title', user.textContent.trim());
  }

  document.addEventListener('taejang-app-ready', () => requestAnimationFrame(enhance));
  document.addEventListener('taejang-dashboard-refresh', () => requestAnimationFrame(enhance));
  if (document.readyState !== 'loading') enhance();
})();
