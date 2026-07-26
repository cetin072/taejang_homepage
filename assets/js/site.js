(function () {
  'use strict';

  const sharedStyleHrefs = [
    'assets/css/site-polish.css',
    'assets/css/mobile-layout-fixes.css',
    'assets/css/listing-polish.css'
  ];

  sharedStyleHrefs.forEach(href => {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.append(link);
  });

  const SHOW_EMPLOYEE_ENTRY = false;
  const PUBLIC_EMAIL = 'info@taejang.co.kr';
  const LEGACY_PUBLIC_EMAIL = 'taejang2025@naver.com';
  const OPENING_DATE = '2026-08-12';
  const OPENING_HIDDEN_FROM = '2026-08-13';
  const OPENING_INVITATION_URL = 'https://taejang-news01.netlify.app/';
  const PUBLIC_NAV_LINKS = [
    ['index.html#about', '태장 소개'],
    ['index.html#business', '사업과 역량'],
    ['workplace.html', '우리의 일터'],
    ['activities.html', '태장의 활동'],
    ['archive.html', '콘텐츠 소식'],
    ['partnership.html', '기업 협력'],
    ['index.html#contact', '문의하기', 'nav-cta']
  ];
  const FOOTER_LINKS = [
    ['index.html#about', '태장 소개'],
    ['about.html', '태장 자세히 보기'],
    ['workplace.html', '우리의 일터'],
    ['index.html#business', '사업과 역량'],
    ['activities.html', '태장의 활동'],
    ['archive.html', '콘텐츠 소식'],
    ['partnership.html', '기업 협력'],
    ['index.html#contact', '문의하기']
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

  function hrefForCurrentPage(href, page) {
    if (page === 'index.html' && href.startsWith('index.html#')) {
      return href.slice('index.html'.length);
    }
    return href;
  }

  function ensureContentHubLink(nav) {
    if (!nav) return;
    const contentLinks = [...nav.querySelectorAll('a')].filter(link => {
      const href = (link.getAttribute('href') || '').split(/[?#]/)[0].replace(/^\.\//, '');
      return href === 'archive.html';
    });
    contentLinks.slice(1).forEach(link => link.remove());
  }

  function normalizeHeaderNavigation() {
    const page = currentPageName();
    document.querySelectorAll('.desktop-nav, [data-mobile-nav]').forEach(nav => {
      const isDesktop = nav.classList.contains('desktop-nav');
      nav.replaceChildren();

      PUBLIC_NAV_LINKS.forEach(([href, label, className]) => {
        const link = document.createElement('a');
        link.href = hrefForCurrentPage(href, page);
        link.textContent = label;
        if (isDesktop && className) link.classList.add(className);

        const targetPage = href.split('#')[0] || 'index.html';
        if (!href.includes('#') && targetPage === page) {
          link.setAttribute('aria-current', 'page');
        }
        nav.appendChild(link);
      });
      ensureContentHubLink(nav);
    });
  }

  function normalizeFooter() {
    const page = currentPageName();
    document.querySelectorAll('.footer').forEach(footer => {
      const columns = footer.querySelectorAll('.footer-top > div');
      const summary = columns[0]?.querySelector('p');
      if (summary) {
        summary.textContent = '장애인과 함께 오래 일할 기회를 만드는 자회사형 장애인 표준사업장입니다.';
      }

      const shortcuts = columns[1];
      if (shortcuts) {
        shortcuts.querySelectorAll('a').forEach(link => link.remove());
        FOOTER_LINKS.forEach(([href, label]) => {
          const link = document.createElement('a');
          link.href = hrefForCurrentPage(href, page);
          link.textContent = label;
          const targetPage = href.split('#')[0] || 'index.html';
          if (targetPage === page && !href.includes('#')) link.setAttribute('aria-current', 'page');
          shortcuts.appendChild(link);
        });
      }
    });
  }

  const announcement = document.querySelector('.announcement');
  if (announcement) {
    if (getSeoulDateKey(new Date()) >= OPENING_HIDDEN_FROM) {
      announcement.hidden = true;
    } else {
      const date = document.createElement('strong');
      date.textContent = OPENING_DATE.replaceAll('-', '.');
      const invitation = document.createElement('a');
      invitation.href = OPENING_INVITATION_URL;
      invitation.target = '_blank';
      invitation.rel = 'noopener';
      invitation.textContent = '초대장 보기';
      announcement.replaceChildren(date, document.createTextNode(' 태장 신규 사업장 개소식 · '), invitation);
    }
  }

  document.querySelectorAll('a[href^="mailto:"]').forEach(link => {
    const href = link.getAttribute('href') || '';
    if (href.includes(LEGACY_PUBLIC_EMAIL)) {
      link.setAttribute('href', href.replace(LEGACY_PUBLIC_EMAIL, PUBLIC_EMAIL));
    }
    if ((link.textContent || '').includes(LEGACY_PUBLIC_EMAIL)) {
      link.textContent = link.textContent.replace(LEGACY_PUBLIC_EMAIL, PUBLIC_EMAIL);
    }
  });

  normalizeHeaderNavigation();

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
  normalizeFooter();

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