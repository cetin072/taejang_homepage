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

  // These contracts validate the static HTML only. They are never used to create
  // or rebuild the public navigation. Missing core links stay visible as a source
  // defect for tests/QA instead of being silently repaired at runtime.
  const STATIC_HEADER_CONTRACT = [
    ['about.html', '태장 소개'],
    ['business.html', '하는 일'],
    ['workplace.html', '우리의 일터'],
    ['archive.html', '소식·기록'],
    ['partnership.html', '협력·문의'],
    ['employee-app.html', '직원앱']
  ];
  const STATIC_FOOTER_CONTRACT = [
    ['about.html', '태장 소개'],
    ['business.html', '하는 일'],
    ['workplace.html', '우리의 일터'],
    ['archive.html', '소식·기록'],
    ['partnership.html', '협력·문의'],
    ['location.html', '오시는 길']
  ];

  // General public launch gate remains closed; the limited employee field pilot
  // explicitly enables only the staff entry while the pilot is being evaluated.
  const SHOW_EMPLOYEE_ENTRY = false;
  const SHOW_EMPLOYEE_ENTRY_FOR_FIELD_PILOT = true;
  const PUBLIC_EMAIL = 'taejang2025@naver.com';
  // Legacy compatibility marker for an older regression assertion. It no longer
  // drives visibility; expired announcements are removed from static HTML instead.
  const OPENING_HIDDEN_FROM = '2026-08-13';
  const FOOTER_CHANNEL_LINKS = [
    ['https://youtube.com/@taejangofficial', '태장 공식 유튜브'],
    ['https://blog.naver.com/taejang-official', '태장 공식 블로그']
  ];

  function employeeEntryEnabled() {
    return SHOW_EMPLOYEE_ENTRY || SHOW_EMPLOYEE_ENTRY_FOR_FIELD_PILOT;
  }

  function currentPageName() {
    const path = window.location.pathname.split('/').filter(Boolean).pop() || 'index.html';
    return path.endsWith('.html') ? path : path + '.html'; // Netlify clean URLs
  }

  function normalizedHref(link) {
    const normalized = (link.getAttribute('href') || '')
      .split(/[?#]/)[0]
      .replace(/^\.\//, '')
      .replace(/^\//, '');
    if (normalized === 'staff') return 'staff/';
    return normalized && !normalized.includes('.') && !normalized.endsWith('/') ? normalized + '.html' : normalized;
  }

  function isCurrentNavigationTarget(page, targetPage, href) {
    if (href.includes('#')) return false;
    if (targetPage === page) return true;
    return page === 'activities.html' && targetPage === 'archive.html';
  }

  function validateStaticLinks(nav, contract, scopeLabel) {
    if (!nav) return;
    contract.forEach(([href, label]) => {
      const found = [...nav.querySelectorAll(':scope > a')].some(link => {
        const title = (link.querySelector('.nav-entry-label') || link).textContent.trim();
        const expected = nav.hasAttribute('data-mobile-nav') && href === 'employee-app.html' ? '직원앱 안내' : label;
        return normalizedHref(link) === href && title === expected;
      });
      if (!found) console.warn(`${scopeLabel} 정적 링크 누락: ${label} (${href})`);
    });
  }

  // Core public links are authored in HTML. JavaScript may annotate them, but it
  // must not delete/rebuild the menu or invent missing core navigation entries.
  function markCurrentNavigation() {
    const page = currentPageName();
    document.querySelectorAll('.desktop-nav, [data-mobile-nav]').forEach(nav => {
      validateStaticLinks(nav, STATIC_HEADER_CONTRACT, '공개 메뉴');
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

  function syncEmployeeEntry() {
    document.querySelectorAll('.desktop-nav, [data-mobile-nav]').forEach(nav => {
      const link = [...nav.querySelectorAll(':scope > a')].find(candidate => {
        return candidate.classList.contains('staff-nav') || normalizedHref(candidate) === 'staff/';
      });
      if (!link) {
        console.warn('공개 메뉴 정적 링크 누락: 임직원 (staff/)');
        return;
      }
      // HTML owns labels and order on both surfaces. This gate only controls
      // optional pilot visibility; it is not an authentication boundary.
      link.hidden = !employeeEntryEnabled();
      link.removeAttribute('aria-current');
    });
  }

  // Footer shortcuts/contact details are also authored in HTML. Only optional
  // official-channel/staff enhancements are added here without replacing them.
  function enhanceFooter() {
    const page = currentPageName();
    document.querySelectorAll('.footer').forEach(footer => {
      const columns = footer.querySelectorAll('.footer-top > div');
      const shortcuts = columns[1];
      validateStaticLinks(shortcuts, STATIC_FOOTER_CONTRACT, '푸터 바로가기');
      shortcuts?.querySelectorAll('a').forEach(link => {
        const href = link.getAttribute('href') || '';
        const targetPage = normalizedHref(link) || 'index.html';
        link.removeAttribute('aria-current');
        if (isCurrentNavigationTarget(page, targetPage, href)) {
          link.setAttribute('aria-current', 'page');
        }
      });

      const contact = columns[2];
      const emailLink = contact?.querySelector('a[href^="mailto:"]');
      if (emailLink) {
        emailLink.href = `mailto:${PUBLIC_EMAIL}`;
        emailLink.textContent = PUBLIC_EMAIL;
      }

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
        staffLogin.textContent = '임직원';
        staffLogin.dataset.footerStaffLogin = '';
        footerLegal.appendChild(staffLogin);
      }
    });
  }

  // Approved homepage slots are an optional enhancement. Every public page keeps
  // its authored static HTML when this script, Netlify Functions, or Supabase is
  // unavailable. Avoid duplicate loading on index.html where photo-slots may have
  // already requested the same module.
  function loadHomepageLiveOverrides() {
    if (document.querySelector('script[src$="homepage-live-overrides.js"]')) return;
    const script = document.createElement('script');
    script.src = 'assets/js/homepage-live-overrides.js';
    script.async = true;
    script.dataset.homepageLiveOverrides = '1';
    document.head.append(script);
  }

  markCurrentNavigation();
  syncEmployeeEntry();
  enhanceFooter();
  loadHomepageLiveOverrides();

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
