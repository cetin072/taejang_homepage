(() => {
  'use strict';

  const INCOMPLETE_MENU_LABELS = new Set(['신규 사업 기획']);

  function mark(root = document) {
    root.querySelectorAll?.('#app-nav button, .quick-links button').forEach(node => {
      const label = (node.textContent || '').trim();
      if (label.endsWith('· 점검중')) return;
      if (!INCOMPLETE_MENU_LABELS.has(label)) return;
      node.textContent = `${label} · 점검중`;
      node.dataset.featureStatus = 'checking';
      node.title = '현재 기능 점검중입니다.';
    });
  }

  document.addEventListener('taejang-app-ready', () => setTimeout(() => mark(), 120));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(() => mark(), 150));

  const start = () => {
    const shell = document.getElementById('desktop-app-shell');
    if (!shell) return;
    new MutationObserver(() => mark(shell)).observe(shell, { childList: true, subtree: true });
    mark(shell);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
