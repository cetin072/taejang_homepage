(() => {
  'use strict';

  // Display-only terminology compatibility layer.
  // Authorization remains promotion_lead; only visible legacy copy is renamed.
  const LEGACY = '홍보팀장';
  const CURRENT = '운영팀장';

  function replaceText(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue?.includes(LEGACY)) {
        node.nodeValue = node.nodeValue.replaceAll(LEGACY, CURRENT);
      }
    }
  }

  function sync() {
    replaceText(document.getElementById('desktop-app-shell'));
    replaceText(document.getElementById('dashboard-main'));
  }

  document.addEventListener('taejang-app-ready', () => setTimeout(sync, 0));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(sync, 0));
  document.addEventListener('taejang-open-promotion-workspace', () => setTimeout(sync, 0));
  document.addEventListener('taejang-open-homepage-content', () => setTimeout(sync, 0));

  const start = () => {
    const shell = document.getElementById('desktop-app-shell');
    if (!shell) return;
    sync();
    new MutationObserver(sync).observe(shell, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
