// Run in <head> before the header can paint. Navigation is independent of
// the later content enhancements in site.js and the live feed.
(function () {
  'use strict';

  function setMenu(open) {
    const button = document.querySelector('[data-menu-button]');
    const nav = document.querySelector('[data-mobile-nav]');
    if (!button || !nav) return;
    nav.classList.toggle('open', open);
    document.body.classList.toggle('nav-open', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
  }

  // Delegation lets handlers be ready before the static header is parsed.
  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-menu-button]')) {
      const nav = document.querySelector('[data-mobile-nav]');
      setMenu(!nav?.classList.contains('open'));
    } else if (event.target.closest('[data-mobile-nav] a, .site-header .brand')) {
      setMenu(false);
    }
  });
  document.addEventListener('keydown', function (event) {
    const nav = document.querySelector('[data-mobile-nav]');
    if (event.key === 'Escape' && nav?.classList.contains('open')) {
      setMenu(false);
      document.querySelector('[data-menu-button]').focus();
    }
  });
  // A restored page or a change to desktop must not retain scroll locking.
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) setMenu(false);
  });
  window.matchMedia('(min-width: 1001px)').addEventListener('change', function (event) {
    if (event.matches) setMenu(false);
  });

  // If this file fails to load, the authored no-JS menu stays available.
  // Add this only after all handlers are installed, without waiting for site.js.
  document.documentElement.classList.add('js-nav-ready');
}());
