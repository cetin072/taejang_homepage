(() => {
  'use strict';
  const worker = 'general_worker';
  const managerRoles = new Set(['super_admin', 'operations_manager', 'department_lead', 'field_lead']);
  const promotionWorkspaceRoles = new Set(['promotion_staff', 'promotion_lead', 'operations_manager', 'ceo']);
  const el = id => document.getElementById(id);
  const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };
  const array = value => Array.isArray(value) ? value : [];
  const routeCopy = {
    super_admin: ['시스템 관리 대시보드', '계정 승인과 현재 운영 정보를 안전하게 확인하세요.'],
    ceo: ['대표이사 요약', '중요 공지와 주요 일정부터 간결하게 확인하세요.'],
    operations_manager: ['운영총괄 대시보드', '승인과 오늘 처리할 핵심 항목부터 확인하세요.'],
    department_lead: ['부서 운영 대시보드', '우리 부서의 일정·공지와 관리 자료를 확인하세요.'],
    field_lead: ['현장 실행 홈', '오늘 작업반과 현장 안내를 먼저 확인하세요.'],
    promotion_lead: ['운영팀장 대시보드', '출근부·팀 직원·홍보 검토 등 오늘의 우선 업무부터 확인하세요.'],
    promotion_staff: ['홍보직원 대시보드', '보완 요청과 콘텐츠 작성·승인 요청을 한 화면에서 처리하세요.']
  };
  const topbarCopy = {
    super_admin: '시스템 관리',
    ceo: '대표이사',
    operations_manager: '운영총괄',
    department_lead: '부서팀장',
    field_lead: '현장반장',
    promotion_lead: '운영팀장',
    promotion_staff: '홍보직원'
  };
  function openPanel(id) { document.dispatchEvent(new CustomEvent('taejang-open-app-panel', { detail: { id } })); }
  function openPromotion(mode = 'review') { document.dispatchEvent(new CustomEvent('taejang-open-promotion-workspace', { detail: { mode } })); }
  function button(label, action) { const node = text('button', label, 'button button-quiet'); node.type = 'button'; node.addEventListener('click', action); return node; }
  function closeSidebar() { const shell = el('desktop-app-shell'); if (!shell) return; shell.classList.remove('sidebar-open'); el('sidebar-toggle')?.setAttribute('aria-expanded', 'false'); }
  function card(title, body, { value, action } = {}) {
    const node = document.createElement('article'); node.className = 'dashboard-card';
    node.append(text('span', '현재 정보', 'status-label'), text('h3', title));
    if (value) node.append(text('p', value, 'dashboard-value'));
    node.append(text('p', body)); if (action) node.append(button(action.label, action.run)); return node;
  }
  function setDashboardTopbar(route) {
    const title = el('desktop-page-title');
    if (title) title.textContent = topbarCopy[route] || '업무';
  }
  function goDashboard() {
    closeSidebar();
    const route = window.TaejangApp?.getRoute?.();
    if (route) setDashboardTopbar(route);
    document.dispatchEvent(new CustomEvent('taejang-dashboard-refresh'));
  }
  function renderBusinessPlanning() {
    closeSidebar();
    const main = el('dashboard-main');
    if (!main) return;
    el('desktop-page-title').textContent = '신규 사업 기획';
    const intro = document.createElement('header'); intro.className = 'dashboard-intro';
    intro.append(text('p', '홍보팀 · 점검중', 'eyebrow'), text('h2', '신규 사업 기획'), text('p', '신규 사업 기획 기능은 아직 연결 전입니다. 현재는 다른 실제 업무 메뉴를 이용해 주세요.'));
    intro.append(button('대시보드로', goDashboard));
    main.replaceChildren(intro);
  }
  function menu(route) {
    const nav = el('app-nav'); nav.replaceChildren();
    const items = [{ label: '대시보드', run: goDashboard, current: true }];
    if (route === 'promotion_staff') items.push({ label: '홍보 작성', run: () => openPromotion('write') });
    if (route === 'promotion_lead') {
      items.push(
        { label: '홍보 검토', run: () => openPromotion('review') },
        { label: '홍보 작성', run: () => openPromotion('write') },
        { label: '신규 사업 기획', run: renderBusinessPlanning }
      );
    }
    if (route === 'operations_manager' || route === 'ceo') items.push({ label: '홍보 검토', run: () => openPromotion('review') });
    if (managerRoles.has(route)) items.push({ label: '업무 배정', run: () => openPanel('today-admin-panel') });
    if (managerRoles.has(route)) items.push(
      { label: '일정 관리', run: () => openPanel('schedule-admin-panel') },
      { label: '공지 관리', run: () => openPanel('notice-admin-panel') },
      { label: '안내 관리', run: () => openPanel('guidance-admin-panel') },
      { label: '작업 매뉴얼', run: () => openPanel('today-admin-panel') }
    );
    if (route === 'super_admin') items.push({ label: '계정 승인', href: '../staff/?admin=1' });
    items.push({ label: '홈페이지', href: '../index.html', newTab: true });
    items.forEach(item => {
      const node = item.href ? document.createElement('a') : document.createElement('button');
      if (item.href) {
        node.href = item.href; node.textContent = item.label;
        if (item.newTab) { node.target = '_blank'; node.rel = 'noopener noreferrer'; }
      } else {
        node.type = 'button'; node.textContent = item.label; node.addEventListener('click', () => { closeSidebar(); item.run(); });
      }
      if (item.current) node.setAttribute('aria-current', 'page');
      nav.append(node);
    });
  }
  async function dashboardData(route) {
    const app = window.TaejangApp;
    const settled = await Promise.allSettled([
      app.rpc('get_my_schedule_list', { p_limit: 5 }),
      app.rpc('get_my_notice_list', { p_limit: 5 })
    ]);
    const schedules = settled[0].status === 'fulfilled' ? array(settled[0].value) : [];
    const notices = settled[1].status === 'fulfilled' ? array(settled[1].value) : [];
    let pending = [];
    let promotion = null;
    if (route === 'super_admin') {
      try { pending = array(await app.rpc('list_pending_profiles')); } catch { pending = []; }
    }
    if (promotionWorkspaceRoles.has(route)) {
      try { promotion = await app.rpc('get_my_promotion_workspace'); } catch { promotion = null; }
    }
    return { schedules, notices, pending, promotion };
  }
  async function render() {
    const route = window.TaejangApp?.getRoute?.(); if (!route || route === worker) return;
    const main = el('dashboard-main'); main.replaceChildren(text('p', '현재 정보를 불러오고 있습니다.', 'message'));
    const { schedules, notices, pending, promotion } = await dashboardData(route);
    const [heading, copy] = routeCopy[route] || ['업무 안내', '현재 사용할 수 있는 업무 정보를 확인하세요.'];
    setDashboardTopbar(route);
    main.replaceChildren();
    const intro = document.createElement('header'); intro.className = 'dashboard-intro';
    intro.append(text('p', new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full', timeZone: 'Asia/Seoul' }).format(new Date()), 'eyebrow'), text('h2', heading), text('p', copy));
    main.append(intro);
    const grid = document.createElement('section'); grid.className = 'dashboard-grid'; grid.setAttribute('aria-label', '현재 업무 요약');

    if (route === 'promotion_lead') {
      const reviewCount = array(promotion?.review_items).length;
      grid.append(card('홍보 검토 대기', reviewCount ? '직원이 올린 검토 안건이 있습니다. 운영팀장의 우선 업무입니다.' : '현재 검토 대기 안건이 없습니다.', {
        value: reviewCount ? `${reviewCount}건` : undefined,
        action: { label: '홍보 검토 열기', run: () => openPromotion('review') }
      }));
      grid.append(card('홍보자료 작성', '필요하면 운영팀장도 직접 홍보자료를 작성할 수 있습니다.', { action: { label: '홍보 작성 열기', run: () => openPromotion('write') } }));
    }
    if (route === 'promotion_staff') {
      const mine = array(promotion?.my_items);
      const revisionCount = mine.filter(item => item.lifecycle === 'needs_revision').length;
      if (revisionCount) grid.append(card('수정·보완 요청', '운영팀장에게서 보완 요청이 왔습니다. 먼저 확인하고 수정하세요.', { value: `${revisionCount}건`, action: { label: '보완 내용 확인', run: () => openPromotion('write') } }));
      grid.append(card('홍보자료 작성', '홈페이지 글·외부 콘텐츠·보도자료를 작성하고 승인 요청합니다.', { action: { label: '홍보 작성 열기', run: () => openPromotion('write') } }));
    }
    if (route === 'operations_manager') grid.append(card('중요 홍보 승인', '중요 콘텐츠와 대표이사 상신이 필요한 안건을 우선 확인합니다.', { action: { label: '홍보 검토 열기', run: () => openPromotion('review') } }));
    if (route === 'ceo') grid.append(card('홍보 상신 검토', '운영총괄이 실제로 상신한 중요 콘텐츠를 확인합니다.', { action: { label: '홍보 검토 열기', run: () => openPromotion('review') } }));
    if (route === 'super_admin') grid.append(card('계정 승인 확인', pending.length ? '보호된 계정 승인 화면에서 확인하세요.' : '현재 승인 대기 항목이 없습니다.', { value: pending.length ? `${pending.length}건` : undefined, action: { label: '계정 승인 열기', run: () => { window.location.href = '../staff/?admin=1'; } } }));

    grid.append(card(route === 'field_lead' ? '오늘 작업과 장소' : '가까운 일정', schedules.length ? schedules[0].title : '현재 나에게 적용되는 일정이 없습니다.', { value: schedules.length ? `${schedules.length}건` : undefined, action: managerRoles.has(route) ? { label: '일정 관리', run: () => openPanel('schedule-admin-panel') } : undefined }));
    const important = notices.filter(item => item.importance === 'urgent' || item.importance === 'important');
    grid.append(card('중요공지', important.length ? important[0].title : '현재 중요한 공지가 없습니다.', { value: important.length ? `${important.length}건` : undefined, action: managerRoles.has(route) ? { label: '공지 관리', run: () => openPanel('notice-admin-panel') } : undefined }));
    main.append(grid);
  }
  function ensureHomepageAction() {
    const actions = document.querySelector('.app-user-actions');
    if (!actions || actions.querySelector('[data-homepage-action]')) return;
    const link = document.createElement('a');
    link.href = '../index.html'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'button button-quiet'; link.textContent = '홈페이지'; link.dataset.homepageAction = '1';
    actions.insertBefore(link, el('desktop-logout-button'));
  }
  function bindBrandToDashboard() {
    document.querySelectorAll('.staff-brand, .app-logo').forEach(brand => {
      brand.href = '#'; brand.setAttribute('aria-label', '업무 대시보드로 이동');
      if (brand.dataset.dashboardBrandBound) return;
      brand.dataset.dashboardBrandBound = '1';
      brand.addEventListener('click', event => { event.preventDefault(); goDashboard(); });
    });
  }
  function setup(event) {
    const route = event.detail.route; if (route === worker) return;
    el('desktop-app-shell').hidden = false;
    el('desktop-role-label').textContent = event.detail.label;
    setDashboardTopbar(route);
    el('desktop-user-label').textContent = `${window.TaejangApp.getContext().display_name || '사용자'} · ${event.detail.label}`;
    menu(route);
    bindBrandToDashboard(); ensureHomepageAction();
    const shell = el('desktop-app-shell');
    if (!shell.dataset.ready) {
      shell.dataset.ready = 'true';
      const toggle = el('sidebar-toggle'); toggle.addEventListener('click', () => { const open = shell.classList.toggle('sidebar-open'); toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기'); });
      el('desktop-logout-button').addEventListener('click', () => el('logout-button').click());
    }
    render();
  }
  document.addEventListener('taejang-app-ready', setup);
  document.addEventListener('taejang-dashboard-refresh', render);
  window.TaejangDashboard = { render };
})();