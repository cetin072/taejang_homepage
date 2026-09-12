(() => {
  'use strict';

  const mobileMedia = window.matchMedia?.('(max-width: 900px)');

  function closeSidebar() {
    const shell = document.getElementById('desktop-app-shell');
    if (!shell?.classList.contains('sidebar-open')) return false;
    shell.classList.remove('sidebar-open');
    const toggle = document.getElementById('sidebar-toggle');
    toggle?.setAttribute('aria-expanded', 'false');
    toggle?.setAttribute('aria-label', '메뉴 열기');
    return true;
  }

  function isMobile() {
    return mobileMedia ? mobileMedia.matches : window.innerWidth <= 900;
  }

  document.addEventListener('click', event => {
    if (!isMobile()) return;
    const shell = document.getElementById('desktop-app-shell');
    if (!shell?.classList.contains('sidebar-open')) return;

    const sidebar = document.getElementById('app-sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (sidebar?.contains(target) || toggle?.contains(target)) return;

    if (closeSidebar()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !isMobile()) return;
    if (closeSidebar()) document.getElementById('sidebar-toggle')?.focus();
  });
})();
