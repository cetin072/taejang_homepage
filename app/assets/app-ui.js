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

  const moduleFailures = new Map();

  function recordModuleFailure(source, dataKey) {
    moduleFailures.set(dataKey, source);
  }

  function loadScriptOnce(source, dataKey) {
    const existing = document.querySelector(`script[data-${dataKey}]`);
    if (existing) {
      if (existing.dataset.loaded === '1') return Promise.resolve({ source, key: dataKey, ok: true });
      if (existing.dataset.loadFailed === '1') {
        recordModuleFailure(source, dataKey);
        return Promise.resolve({ source, key: dataKey, ok: false });
      }
      return new Promise(resolve => {
        existing.addEventListener('load', () => resolve({ source, key: dataKey, ok: true }), { once: true });
        existing.addEventListener('error', () => {
          existing.dataset.loadFailed = '1';
          recordModuleFailure(source, dataKey);
          resolve({ source, key: dataKey, ok: false });
        }, { once: true });
      });
    }
    return new Promise(resolve => {
      const script = document.createElement('script');
      script.src = source;
      script.async = false;
      script.dataset[dataKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = '1';
      script.addEventListener('load', () => {
        script.dataset.loaded = '1';
        resolve({ source, key: dataKey, ok: true });
      }, { once: true });
      script.addEventListener('error', () => {
        script.dataset.loadFailed = '1';
        recordModuleFailure(source, dataKey);
        resolve({ source, key: dataKey, ok: false });
      }, { once: true });
      document.head.append(script);
    });
  }

  function ensureFailureNotice() {
    let notice = document.querySelector('[data-feature-health-notice]');
    if (notice) return notice;
    const workspace = document.querySelector('.app-workspace');
    if (!workspace) return null;
    notice = document.createElement('div');
    notice.className = 'message error feature-health-notice';
    notice.dataset.featureHealthNotice = '1';
    notice.setAttribute('role', 'alert');
    notice.hidden = true;
    const main = document.getElementById('dashboard-main');
    if (main) workspace.insertBefore(notice, main);
    else workspace.append(notice);
    return notice;
  }

  function showFeatureFailure(label = '일부 업무 기능') {
    const notice = ensureFailureNotice();
    if (!notice) return;
    const copy = document.createElement('span');
    copy.textContent = `${label}을 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.`;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button button-quiet';
    retry.textContent = '다시 시도';
    retry.addEventListener('click', () => window.location.reload());
    notice.replaceChildren(copy, retry);
    notice.hidden = false;
  }

  function showAggregateFailure() {
    if (!moduleFailures.size) return;
    showFeatureFailure('일부 업무 기능');
  }

  const featureHealth = {
    failedKeys: () => [...moduleFailures.keys()],
    hasFailed: key => moduleFailures.has(key),
    showFailure: showFeatureFailure,
    retry: () => window.location.reload()
  };
  window.TaejangFeatureHealth = featureHealth;

  loadStyleOnce('assets/dashboard-accent-theme.css', 'dashboard-accent-theme');
  loadStyleOnce('assets/support-radar.css', 'support-radar');

  // Start independent feature requests together, but do not release app-ready until
  // every module has registered or failed. `async = false` keeps dynamically
  // inserted classic scripts executing in insertion order.
  const FEATURE_MODULES = [
    ['assets/app-workspace-surface.js', 'app-workspace-surface'],
    ['assets/pwa-install.js', 'pwa-install'],
    ['assets/attendance-location.js', 'attendance-location'],
    ['assets/worker-mobile-v1.js', 'worker-mobile-v1'],
    ['assets/attendance-admin.js', 'attendance-admin'],
    ['assets/attendance-integrity-ui.js', 'attendance-integrity-ui'],
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
    ['assets/issue-146-end-to-end.js', 'issue-146-end-to-end'],
    ['assets/promotion-approved-delete-ux.js', 'promotion-approved-delete-ux'],
    ['assets/support-radar.js', 'support-radar'],
    ['assets/support-radar-notices.js', 'support-radar-notices'],
    ['assets/support-radar-dedupe.js', 'support-radar-dedupe'],
    ['assets/support-radar-assignment.js', 'support-radar-assignment'],
    ['assets/support-radar-alerts.js', 'support-radar-alerts'],
    ['assets/support-radar-report.js', 'support-radar-report'],
    ['assets/support-radar-my-work.js', 'support-radar-my-work'],
    ['assets/support-radar-review.js', 'support-radar-review'],
    ['assets/support-radar-profile-polish.js', 'support-radar-profile-polish'],
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

  const featureModulesReady = Promise.all(
    FEATURE_MODULES.map(([source, key]) => loadScriptOnce(source, key))
  ).then(() => {
    modulesReady = true;
    Promise.resolve().then(showAggregateFailure);
  });

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
      showAggregateFailure();
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
