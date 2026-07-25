(function () {
  'use strict';

  const polishHref = 'assets/css/site-polish.css';
  if (!document.querySelector(`link[href="${polishHref}"]`)) {
    const polishLink = document.createElement('link');
    polishLink.rel = 'stylesheet';
    polishLink.href = polishHref;
    document.head.append(polishLink);
  }

  const menuBtn = document.querySelector('[data-menu-button]');
  const mobileNav = document.querySelector('[data-mobile-nav]');
  if (menuBtn && mobileNav) {
    function setMenu(open) {
      mobileNav.classList.toggle('open', open);
      document.body.classList.toggle('nav-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
    }

    menuBtn.addEventListener('click', function () {
      setMenu(!mobileNav.classList.contains('open'));
    });
    mobileNav.querySelectorAll('a').forEach(link => link.addEventListener('click', function () {
      setMenu(false);
    }));
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && mobileNav.classList.contains('open')) {
        setMenu(false);
        menuBtn.focus();
      }
    });
  }

  document.querySelectorAll('[data-faq-button]').forEach(button => {
    button.addEventListener('click', function () {
      const item = button.closest('.faq-item');
      const wasOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(candidate => {
        candidate.classList.remove('open');
        const question = candidate.querySelector('[data-faq-button]');
        if (question) question.setAttribute('aria-expanded', 'false');
      });
      if (!wasOpen) {
        item.classList.add('open');
        button.setAttribute('aria-expanded', 'true');
      }
    });
  });

  const year = document.querySelector('[data-current-year]');
  if (year) year.textContent = new Date().getFullYear();
}());
