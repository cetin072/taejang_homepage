(function () {
  'use strict';

  const polishHref = 'assets/css/site-polish.css';
  if (!document.querySelector(`link[href="${polishHref}"]`)) {
    const polishLink = document.createElement('link');
    polishLink.rel = 'stylesheet';
    polishLink.href = polishHref;
    document.head.append(polishLink);
  }

  const SHOW_EMPLOYEE_ENTRY = false;
  const PUBLIC_EMAIL = 'info@taejang.co.kr';
  const LEGACY_PUBLIC_EMAIL = 'taejang2025@naver.com';

  document.querySelectorAll('a[href^="mailto:"]').forEach(link => {
    const href = link.getAttribute('href') || '';
    if (href.includes(LEGACY_PUBLIC_EMAIL)) {
      link.setAttribute('href', href.replace(LEGACY_PUBLIC_EMAIL, PUBLIC_EMAIL));
    }
    if ((link.textContent || '').includes(LEGACY_PUBLIC_EMAIL)) {
      link.textContent = link.textContent.replace(LEGACY_PUBLIC_EMAIL, PUBLIC_EMAIL);
    }
  });

  if (SHOW_EMPLOYEE_ENTRY) {
    const employeeIcon = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.5"></circle><path d="M5 20c.7-4 3.1-6 7-6s6.3 2 7 6"></path></svg><span>임직원</span>';
    document.querySelectorAll('.desktop-nav').forEach(nav => {
      let link = nav.querySelector('.staff-nav, a[href="staff/"]');
      if (!link) {
        link = document.createElement('a');
        link.href = 'staff/';
        const contact = nav.querySelector('.nav-cta');
        nav.insertBefore(link, contact || null);
      }
      link.classList.add('staff-nav');
      link.setAttribute('aria-label', '임직원 로그인');
      link.innerHTML = employeeIcon;
    });

    document.querySelectorAll('[data-mobile-nav]').forEach(nav => {
      let link = nav.querySelector('a[href="staff/"]');
      if (!link) {
        link = document.createElement('a');
        link.href = 'staff/';
        const contact = [...nav.querySelectorAll('a')].find(candidate => candidate.getAttribute('href')?.includes('#contact'));
        nav.insertBefore(link, contact || null);
      }
      link.setAttribute('aria-label', '임직원 로그인');
      link.innerHTML = employeeIcon;
    });
  } else {
    document.querySelectorAll('.staff-nav, a[href="staff/"], a[href$="/staff/"]').forEach(link => link.remove());
  }

  document.querySelectorAll('a[href="resources.html"]').forEach(link => link.remove());

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
