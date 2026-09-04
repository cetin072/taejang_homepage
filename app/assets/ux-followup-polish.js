(() => {
  'use strict';

  const STATIC_ADMIN_PANELS = [
    'today-admin-panel',
    'schedule-admin-panel',
    'notice-admin-panel',
    'guidance-admin-panel'
  ];
  const EMPLOYEE_ROUTES = new Set(['operations_manager', 'promotion_lead', 'department_lead']);

  const byId = id => document.getElementById(id);
  const route = () => window.TaejangApp?.getRoute?.();

  function hideStaticAdminPanels(exceptId = null) {
    STATIC_ADMIN_PANELS.forEach(id => {
      const panel = byId(id);
      if (panel) panel.hidden = id !== exceptId;
    });
  }

  function showDashboardSurface() {
    hideStaticAdminPanels();
    const dashboard = byId('dashboard-main');
    if (dashboard) dashboard.hidden = false;
  }

  function closeSidebar() {
    byId('desktop-app-shell')?.classList.remove('sidebar-open');
    byId('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  }

  function bindSurfaceGuard() {
    const nav = byId('app-nav');
    if (!nav || nav.dataset.surfaceGuardBound) return;
    nav.dataset.surfaceGuardBound = '1';
    nav.addEventListener('click', event => {
      const target = event.target?.closest?.('button, a');
      if (!target || !nav.contains(target) || target.target === '_blank') return;
      showDashboardSurface();
    }, true);
  }

  function ensureEmployeeNavigation() {
    const currentRoute = route();
    const nav = byId('app-nav');
    if (!nav || !EMPLOYEE_ROUTES.has(currentRoute)) return;

    const existing = nav.querySelector('[data-employee-management-nav]');
    if (!existing) return;

    let create = nav.querySelector('[data-employee-new-nav]');
    if (!create) {
      create = document.createElement('button');
      create.type = 'button';
      create.className = existing.className || 'button button-quiet';
      create.dataset.employeeNewNav = '1';
      create.addEventListener('click', () => {
        closeSidebar();
        showDashboardSurface();
        window.TaejangEmployeeManagement?.openEmployeeManagement?.('new');
      });
      nav.insertBefore(create, existing.nextSibling);
    }
    create.textContent = currentRoute === 'operations_manager' ? '신규 직원 등록' : '신규 직원 등록 요청';
  }

  function configureRoleNavigation() {
    const api = window.TaejangRoleNavigationPriority;
    if (!api?.ROLE_ORDER || !api?.ROLE_SECTIONS) return;

    api.ROLE_ORDER.operations_manager = [
      '대시보드',
      '직원 관리', '신규 직원 등록',
      '홍보 검토', '홍보 글 관리', '홍보 글 작성', '홈페이지 내용 관리', '홈페이지 직접 수정',
      '업무 배정', '일정 관리',
      '공지 관리', '상시 안내 관리',
      '출근부',
      '가입 승인',
      '작업 매뉴얼',
      '홈페이지'
    ];
    api.ROLE_SECTIONS.operations_manager = [
      { label: '직원·팀 관리', items: ['직원 관리', '신규 직원 등록'] },
      { label: '홍보·홈페이지', items: ['홍보 검토', '홍보 글 관리', '홍보 글 작성', '홈페이지 내용 관리', '홈페이지 직접 수정'] },
      { label: '업무 운영', items: ['업무 배정', '일정 관리'] },
      { label: '공지·안내', items: ['공지 관리', '상시 안내 관리'] },
      { label: '근태', items: ['출근부'] },
      { label: '승인·관리', items: ['가입 승인'] },
      { label: '업무 참고', items: ['작업 매뉴얼'] }
    ];

    api.ROLE_ORDER.promotion_lead = [
      '대시보드',
      '홍보 검토', '홍보 작성', '홍보 글 관리',
      '팀 직원 관리', '신규 직원 등록 요청', '업무 배정', '일정 관리',
      '공지 관리', '상시 안내 관리',
      '홈페이지 내용 관리',
      '출근부',
      '작업 매뉴얼',
      '홈페이지',
      '신규 사업 기획'
    ];
    api.ROLE_SECTIONS.promotion_lead = [
      { label: '홍보', items: ['홍보 검토', '홍보 작성', '홍보 글 관리'] },
      { label: '팀 운영', items: ['팀 직원 관리', '신규 직원 등록 요청', '업무 배정', '일정 관리'] },
      { label: '공지·안내', items: ['공지 관리', '상시 안내 관리'] },
      { label: '홈페이지', items: ['홈페이지 내용 관리'] },
      { label: '근태', items: ['출근부'] },
      { label: '업무 참고', items: ['작업 매뉴얼'] }
    ];

    api.ROLE_ORDER.department_lead = [
      '대시보드',
      '팀 직원 관리', '신규 직원 등록 요청', '업무 배정', '일정 관리',
      '공지 관리', '상시 안내 관리',
      '작업 매뉴얼',
      '홈페이지'
    ];
    api.ROLE_SECTIONS.department_lead = [
      { label: '팀 운영', items: ['팀 직원 관리', '신규 직원 등록 요청', '업무 배정', '일정 관리'] },
      { label: '공지·안내', items: ['공지 관리', '상시 안내 관리'] },
      { label: '업무 참고', items: ['작업 매뉴얼'] }
    ];

    api.reorder?.();
  }

  function removeEmployeeTabs() {
    document.querySelectorAll('.employee-view-tabs').forEach(node => node.remove());
  }

  function labelForControl(id) {
    return byId(id)?.closest?.('label') || null;
  }

  function simplifyNoticeForm() {
    const form = byId('notice-form');
    if (!form || form.dataset.progressiveDisclosure) return;
    form.dataset.progressiveDisclosure = '1';

    const panel = byId('notice-admin-panel');
    const help = panel?.querySelector('.easy-writing-help');
    if (help) help.textContent = '제목·중요도·게시 시작·대상·내용만 먼저 적으세요. 장소·적용기간·준비물·관련 링크는 필요할 때 상세 설정에서 추가하세요.';

    const advancedIds = [
      'notice-publish-end-date', 'notice-publish-end-time',
      'notice-effective-start', 'notice-effective-end',
      'notice-location', 'notice-related-schedule', 'notice-related-guide',
      'notice-requires-ack', 'notice-materials',
      'notice-link-label', 'notice-link-url', 'notice-reason'
    ];

    const details = document.createElement('details');
    details.className = 'notice-advanced-settings';
    details.dataset.noticeAdvancedSettings = '1';
    const summary = document.createElement('summary');
    summary.textContent = '상세 설정 · 필요할 때만';
    const note = document.createElement('p');
    note.className = 'help';
    note.textContent = '게시 종료, 적용기간, 장소, 준비물, 관련 일정·작업방법, 링크와 확인 요청을 추가할 수 있습니다.';
    const grid = document.createElement('div');
    grid.className = 'form-grid notice-advanced-grid';

    advancedIds.forEach(id => {
      const label = labelForControl(id);
      if (label) grid.append(label);
    });
    details.append(summary, note, grid);

    const actions = form.querySelector('.form-actions');
    if (actions) form.insertBefore(details, actions);
    else form.append(details);

    form.addEventListener('submit', () => {
      const reason = byId('notice-reason');
      if (reason && !reason.value.trim()) reason.value = byId('notice-id')?.value ? '공지 수정' : '공지 작성';
    }, true);
  }

  function injectStyles() {
    if (document.querySelector('style[data-followup-ux]')) return;
    const style = document.createElement('style');
    style.dataset.followupUx = '1';
    style.textContent = `
      .employee-view-tabs { display:none !important; }
      .notice-advanced-settings { margin-top:14px; border:1px solid var(--app-border); border-radius:12px; background:#f7f9f7; }
      .notice-advanced-settings > summary { min-height:48px; display:flex; align-items:center; padding:10px 14px; color:var(--app-accent); font-weight:850; cursor:pointer; }
      .notice-advanced-settings > .help { margin:0; padding:0 14px 8px; }
      .notice-advanced-grid { padding:0 14px 14px; }
      @media(max-width:760px){.notice-advanced-grid{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function sync() {
    injectStyles();
    bindSurfaceGuard();
    ensureEmployeeNavigation();
    configureRoleNavigation();
    simplifyNoticeForm();
    removeEmployeeTabs();
  }

  document.addEventListener('taejang-open-app-panel', event => {
    const id = event.detail?.id;
    if (!STATIC_ADMIN_PANELS.includes(id)) return;
    hideStaticAdminPanels(id);
    const dashboard = byId('dashboard-main');
    if (dashboard) dashboard.hidden = true;
  });
  document.addEventListener('taejang-dashboard-refresh', showDashboardSurface);
  document.addEventListener('taejang-open-employee-management', showDashboardSurface);
  document.addEventListener('taejang-open-promotion-workspace', showDashboardSurface);
  document.addEventListener('taejang-app-ready', () => setTimeout(sync, 260));

  const dashboard = byId('dashboard-main');
  if (dashboard) new MutationObserver(() => removeEmployeeTabs()).observe(dashboard, { childList: true, subtree: true });

  const start = () => { sync(); setTimeout(sync, 500); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();