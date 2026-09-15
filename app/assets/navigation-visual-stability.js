(() => {
  'use strict';

  let settleTimer = null;
  const INITIAL_SETTLE_MS = 190;

  function nav() {
    return document.getElementById('app-nav');
  }

  function finalize() {
    const target = nav();
    if (!target) return;
    window.TaejangIssue207Ux?.ensureNavigation?.();
    window.TaejangRoleNavigationPriority?.reorder?.();
    window.TaejangRoleScreenPolish?.apply?.();
    requestAnimationFrame(() => {
      const current = nav();
      if (!current) return;
      current.style.visibility = '';
      current.dataset.navigationSettled = '1';
      document.dispatchEvent(new CustomEvent('taejang-navigation-stable'));
    });
  }

  function composeOnce() {
    const target = nav();
    if (!target) return;
    target.style.visibility = 'hidden';
    target.dataset.navigationSettled = '0';
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      finalize();
    }, INITIAL_SETTLE_MS);
  }

  function refreshWithoutFlash() {
    setTimeout(() => {
      window.TaejangIssue207Ux?.ensureNavigation?.();
      window.TaejangRoleNavigationPriority?.reorder?.();
      window.TaejangRoleScreenPolish?.apply?.();
    }, 0);
  }

  document.addEventListener('taejang-app-ready', composeOnce);
  document.addEventListener('taejang-dashboard-refresh', refreshWithoutFlash);
  window.addEventListener('pageshow', () => {
    const target = nav();
    if (target && target.dataset.navigationSettled !== '1') composeOnce();
  });

  window.TaejangNavigationVisualStability = { composeOnce, finalize };
})();