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

  function loadStyleOnce(source, dataKey) {
    if (document.querySelector(`link[data-${dataKey}]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = source;
    link.dataset[dataKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = '1';
    document.head.append(link);
  }

  function loadScriptOnce(source, dataKey) {
    const existing = document.querySelector(`script[data-${dataKey}]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return Promise.resolve();
      return new Promise(resolve => {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', resolve, { once: true });
      });
    }
    return new Promise(resolve => {
      const script = document.createElement('script');
      script.src = source;
      script.async = false;
      script.dataset[dataKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = '1';
      script.addEventListener('load', () => { script.dataset.loaded = '1'; resolve(); }, { once: true });
      script.addEventListener('error', () => { script.dataset.loadFailed = '1'; resolve(); }, { once: true });
      document.head.append(script);
    });
  }

  loadStyleOnce('assets/dashboard-accent-theme.css', 'dashboard-accent-theme');

  // These modules used to be appended independently while app.js was already
  // verifying the session. On a fast app bootstrap, `taejang-app-ready` could fire
  // before one or more modules had registered their listeners. The result was a
  // nondeterministic sidebar: employee management, signup approval, renamed
  // guidance, or workspace panel guards could disappear depending on timing.
  // Load them deterministically and hold the first ready event until every module
  // has had a chance to register its listeners.
  const FEATURE_MODULES = [
    ['assets/app-workspace-surface.js', 'app-workspace-surface'],
    ['assets/pwa-install.js', 'pwa-install'],
    ['assets/worker-mobile-v1.js', 'worker-mobile-v1'],
    ['assets/attendance-admin.js', 'attendance-admin'],
    ['assets/phase-c-workspace-v2.js', 'phase-c-workspace-v2'],
    ['assets/operations-promotion-writer.js', 'operations-promotion-writer'],
    ['assets/operations-homepage-direct.js', 'operations-homepage-direct'],
    ['assets/phase-c-role-labels.js', 'phase-c-role-labels'],
    ['assets/phase-c-account-approval.js', 'phase-c-account-approval'],
    ['assets/phase-c-publication-admin.js', 'phase-c-publication-admin'],
    ['assets/phase-c-role-simulation.js', 'phase-c-role-simulation'],
    ['assets/employee-common-home-v1.js', 'employee-common-home-v1'],
    ['assets/employee-management.js', 'employee-management'],
    ['assets/operations-delete-controls.js', 'operations-delete-controls'],
    ['assets/menu-status.js', 'menu-status'],
    ['assets/phase-c-account-topbar.js', 'phase-c-account-topbar'],
    ['assets/official-channel-links.js', 'official-channel-links'],
    ['assets/role-navigation-priority.js', 'role-navigation-priority'],
    ['assets/dashboard-priority-cards.js', 'dashboard-priority-cards'],
    ['assets/ux-followup-polish.js', 'ux-followup-polish']
  ];

  let modulesReady = false;
  let replayingReady = false;
  let queuedReadyDetail = null;
  let replayScheduled = false;

  const featureModulesReady = FEATURE_MODULES.reduce(
    (promise, [source, key]) => promise.then(() => loadScriptOnce(source, key)),
    Promise.resolve()
  ).then(() => { modulesReady = true; });

  function scheduleReadyReplay() {
    if (replayScheduled) return;
    replayScheduled = true;
    featureModulesReady.then(() => {
      replayScheduled = false;
      if (!queuedReadyDetail) return;
      const detail = queuedReadyDetail;
      queuedReadyDetail = null;
      replayingReady = true;
      document.dispatchEvent(new CustomEvent('taejang-app-ready', { detail }));
      replayingReady = false;
    });
  }

  document.addEventListener('taejang-app-ready', event => {
    if (replayingReady || modulesReady) return;
    queuedReadyDetail = event.detail || {};
    event.stopImmediatePropagation();
    scheduleReadyReplay();
  }, true);

  window.TaejangFeatureModulesReady = featureModulesReady;
})();