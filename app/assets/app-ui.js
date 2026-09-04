(() => {
  'use strict';

  // app.js loads its Supabase config asynchronously, but the browser can fire the
  // initial pageshow event before that fetch finishes. app.js verifies again after
  // config loading, so suppress only the premature pageshow.
  window.addEventListener('pageshow', event => {
    if (!window.TaejangApp) event.stopImmediatePropagation();
  }, true);

  const element = id => document.getElementById(id);
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value || '';
    return node;
  };
  const clear = id => element(id).replaceChildren();
  const message = (id, value, error = false) => {
    const target = element(id);
    target.textContent = value;
    target.classList.toggle('error', error);
    target.hidden = !value;
  };
  const imageOrNotice = (url, alt, emptyText) => {
    if (!url) return text('p', emptyText, 'image-notice');
    const image = document.createElement('img');
    image.src = url;
    image.alt = alt || '작업방법 이미지';
    image.className = 'guide-image';
    image.addEventListener('error', () => {
      image.replaceWith(text('p', '이미지를 불러오지 못했습니다. 글 안내를 확인하세요.', 'image-notice'));
    }, { once: true });
    return image;
  };
  window.TaejangAppUi = { element, text, clear, message, imageOrNotice };

  function loadOnce(source, dataKey) {
    if (document.querySelector(`script[data-${dataKey}]`)) return;
    const script = document.createElement('script');
    script.src = source;
    script.async = false;
    script.dataset[dataKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = '1';
    document.head.append(script);
  }

  function loadStyleOnce(source, dataKey) {
    if (document.querySelector(`link[data-${dataKey}]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = source;
    link.dataset[dataKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = '1';
    document.head.append(link);
  }

  loadStyleOnce('assets/dashboard-accent-theme.css', 'dashboard-accent-theme');

  // Mount legacy manager panels into the app workspace before any feature module
  // can open them. This prevents the visible screen from dropping below the shell.
  loadOnce('assets/app-workspace-surface.js', 'app-workspace-surface');

  // PWA install support is deliberately network-first: authenticated work data is
  // never cached by the service worker. The employee home remains read/confirm-only
  // except for attendance actions and role-specific work shortcuts.
  loadOnce('assets/pwa-install.js', 'pwa-install');
  loadOnce('assets/worker-mobile-v1.js', 'worker-mobile-v1');
  loadOnce('assets/attendance-admin.js', 'attendance-admin');

  // Phase C workspace V2 owns promotion writing/revision/review and homepage
  // request/approval management. Operations authoring and direct homepage editing
  // are optional sidebar tools and do not replace the promotion team's main flow.
  loadOnce('assets/phase-c-workspace-v2.js', 'phase-c-workspace-v2');
  loadOnce('assets/operations-promotion-writer.js', 'operations-promotion-writer');
  loadOnce('assets/operations-homepage-direct.js', 'operations-homepage-direct');
  loadOnce('assets/phase-c-role-labels.js', 'phase-c-role-labels');
  loadOnce('assets/phase-c-account-approval.js', 'phase-c-account-approval');
  loadOnce('assets/phase-c-publication-admin.js', 'phase-c-publication-admin');
  loadOnce('assets/phase-c-role-simulation.js', 'phase-c-role-simulation');
  loadOnce('assets/employee-common-home-v1.js', 'employee-common-home-v1');
  loadOnce('assets/employee-management.js', 'employee-management');
  loadOnce('assets/operations-delete-controls.js', 'operations-delete-controls');
  loadOnce('assets/menu-status.js', 'menu-status');
  loadOnce('assets/phase-c-account-topbar.js', 'phase-c-account-topbar');
  loadOnce('assets/official-channel-links.js', 'official-channel-links');

  // Final role-based presentation runs after feature modules. These modules only
  // reorder or summarize already-permitted features and never grant permissions.
  loadOnce('assets/role-navigation-priority.js', 'role-navigation-priority');
  loadOnce('assets/dashboard-priority-cards.js', 'dashboard-priority-cards');
  loadOnce('assets/ux-followup-polish.js', 'ux-followup-polish');
})();