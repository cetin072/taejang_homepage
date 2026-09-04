(function () {
  'use strict';

  const sharedStyleHrefs = [
    'assets/css/site-polish.css',
    'assets/css/mobile-layout-fixes.css',
    'assets/css/listing-polish.css',
    'assets/css/photo-mode.css',
    'assets/css/engagement-polish.css'
  ];

  sharedStyleHrefs.forEach(href => {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.append(link);
  });

  // General public launch gate remains closed; the limited employee field pilot
  // explicitly enables only the staff entry while the pilot is being evaluated.
  const SHOW_EMPLOYEE_ENTRY = false;
  const SHOW_EMPLOYEE_ENTRY_FOR_FIELD_PILOT = true;
  const OPENING_HIDDEN_FROM = '2026-08-13';
  const FOOTER_CHANNEL_LINKS = [
    ['https://youtube.com/@taejangofficial', '태장 공식 유튜브'],
    ['https://blog.naver.com/taejang-official', '태장 공식 블로그']
  ];

  function getSeoulDateKey(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const value = type => parts.find(part => part.type === type)?.value || '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  }

  function currentPageName() {
    const path = window.location.pathname.split('/').filter(Boolean).pop() || 'index.html';
    return path.endsWith('.html') ? path : 'index.html';
  }

  function normalizedHref(link) {
    return (link.getAttribute('href') || '')
      .split(/[?#]/)[0]
      .replace(/^\.\//, '')
      .replace(/^\//, '');
  }

  function isCurrentNavigationTarget(page, targetPage, href) {
    if (href.includes('#')) return false;
    if (targetPage === page) return true;
    return page === 'activities.html' && targetPage === 'archive.html';
  }

  // Core public links are authored in HTML. JavaScript may annotate them, but it
  // must not delete/rebuild the menu or invent missing core navigation entries.
  function markCurrentNavigation() {
    const page = currentPageName();
    document.querySelectorAll('.desktop-nav, [data-mobile-nav]').forEach(nav => {
      nav.querySelectorAll(':scope > a').forEach(link => {
        if (link.classList.contains('staff-nav') || normalizedHref(link) === 'staff/') return;
        const href = link.getAttribute('href') || '';
        const targetPage = normalizedHref(link) || 'index.html';
        link.removeAttribute('aria-current');
        if (isCurrentNavigationTarget(page, targetPage, href)) {
          link.setAttribute('aria-current', 'page');
        }
      });
    });
  }

  // Footer shortcuts/contact details are also authored in HTML. Only optional
  // official-channel/staff enhancements are added here without replacing them.
  function enhanceFooter() {
    const page = currentPageName();
    document.querySelectorAll('.footer').forEach(footer => {
      const columns = footer.querySelectorAll('.footer-top > div');
      const shortcuts = columns[1];
      shortcuts?.querySelectorAll('a').forEach(link => {
        const href = link.getAttribute('href') || '';
        const targetPage = normalizedHref(link) || 'index.html';
        link.removeAttribute('aria-current');
        if (isCurrentNavigationTarget(page, targetPage, href)) {
          link.setAttribute('aria-current', 'page');
        }
      });

      const footerTop = footer.querySelector('.footer-top');
      if (footerTop && !footerTop.querySelector('[data-footer-official-channels]')) {
        const channels = document.createElement('div');
        channels.dataset.footerOfficialChannels = '';
        const heading = document.createElement('h3');
        heading.textContent = '공식 채널';
        channels.appendChild(heading);
        FOOTER_CHANNEL_LINKS.forEach(([href, label]) => {
          const link = document.createElement('a');
          link.href = href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = label;
          channels.appendChild(link);
        });
        footerTop.appendChild(channels);
      }

      const footerLegal = footer.querySelector('.footer-bottom > div:last-child');
      if (footerLegal && !footerLegal.querySelector('[data-footer-staff-login]')) {
        footerLegal.appendChild(document.createTextNode(' · '));
        const staffLogin = document.createElement('a');
        staffLogin.href = 'staff/';
        staffLogin.textContent = '임직원 로그인';
        staffLogin.dataset.footerStaffLogin = '';
        footerLegal.appendChild(staffLogin);
      }
    });
  }

  // Legacy opening notices remain hidden after their event date. The static
  // source is being retired page-by-page; this guard remains as backward safety.
  const announcement = document.querySelector('.announcement');
  if (announcement && getSeoulDateKey(new Date()) >= OPENING_HIDDEN_FROM) {
    announcement.hidden = true;
  }

  markCurrentNavigation();

  if (SHOW_EMPLOYEE_ENTRY || SHOW_EMPLOYEE_ENTRY_FOR_FIELD_PILOT) {
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
        nav.appendChild(link);
      }
      link.setAttribute('aria-label', '임직원 로그인');
      link.innerHTML = employeeIcon;
    });
  } else {
    document.querySelectorAll('.staff-nav, a[href="staff/"], a[href$="/staff/"]').forEach(link => link.remove());
  }

  enhanceFooter();

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