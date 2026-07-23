(() => {
  'use strict';
  const worker = 'general_worker';
  const managerRoles = new Set(['super_admin', 'operations_manager', 'department_lead', 'field_lead']);
  const el = id => document.getElementById(id);
  const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };
  const array = value => Array.isArray(value) ? value : [];
  const routeCopy = {
    super_admin: ['시스템 관리 대시보드', '계정 승인과 현재 운영 정보를 안전하게 확인하세요.'],
    ceo: ['대표이사 요약', '중요 공지와 주요 일정부터 간결하게 확인하세요.'],
    operations_manager: ['운영총괄 대시보드', '중요한 처리 항목과 변경사항을 확인하세요.'],
    department_lead: ['부서 운영 대시보드', '우리 부서의 일정·공지와 관리 자료를 확인하세요.'],
    field_lead: ['현장 실행 홈', '오늘 작업반과 현장 안내를 먼저 확인하세요.']
  };
  function openPanel(id) { document.dispatchEvent(new CustomEvent('taejang-open-app-panel', { detail: { id } })); }
  function button(label, action) { const node = text('button', label, 'button button-quiet'); node.type = 'button'; node.addEventListener('click', action); return node; }
  function card(title, body, { value, action, wide = false, preparing = false } = {}) {
    const node = document.createElement('article'); node.className = `dashboard-card${wide ? ' wide' : ''}`;
    node.append(text('span', preparing ? '준비 중' : '현재 정보', `status-label${preparing ? ' preparing' : ''}`), text('h3', title));
    if (value) node.append(text('p', value, 'dashboard-value'));
    node.append(text('p', body)); if (action) node.append(button(action.label, action.run)); return node;
  }
  function menu(route) {
    const nav = el('app-nav'); nav.replaceChildren();
    const items = [{ label: '대시보드', run: () => { document.dispatchEvent(new Event('taejang-dashboard-refresh')); window.TaejangDashboard.render(); }, current: true }];
    if (managerRoles.has(route)) items.push({ label: '오늘 관리', run: () => openPanel('today-admin-panel') });
    if (managerRoles.has(route)) items.push({ label: '일정 관리', run: () => openPanel('schedule-admin-panel') }, { label: '공지 관리', run: () => openPanel('notice-admin-panel') }, { label: '안내 관리', run: () => openPanel('guidance-admin-panel') }, { label: '작업방법 관리', run: () => openPanel('today-admin-panel') });
    if (route === 'super_admin') items.push({ label: '계정 승인', href: '../staff/?admin=1' });
    items.forEach(item => { const node = item.href ? document.createElement('a') : document.createElement('button'); if (item.href) { node.href = item.href; node.className = 'button button-quiet'; node.textContent = item.label; } else { node.type = 'button'; node.textContent = item.label; node.addEventListener('click', item.run); } if (item.current) node.setAttribute('aria-current', 'page'); nav.append(node); });
  }
  async function dashboardData(route) {
    const app = window.TaejangApp;
    const calls = [app.rpc('get_my_schedule_list', { p_limit: 5 }), app.rpc('get_my_notice_list', { p_limit: 5 }), app.rpc('get_my_work_guide_list', {})];
    if (route === 'super_admin') calls.push(app.rpc('list_pending_profiles'));
    const settled = await Promise.allSettled(calls);
    return settled.map(result => result.status === 'fulfilled' ? array(result.value) : []);
  }
  async function render() {
    const route = window.TaejangApp?.getRoute?.(); if (!route || route === worker) return;
    const main = el('dashboard-main'); main.replaceChildren(text('p', '현재 정보를 불러오고 있습니다.', 'message'));
    const [schedules, notices, guides, pending = []] = await dashboardData(route);
    const [heading, copy] = routeCopy[route] || ['업무 안내', '현재 사용할 수 있는 업무 정보를 확인하세요.'];
    main.replaceChildren(); const intro = document.createElement('header'); intro.className = 'dashboard-intro'; intro.append(text('p', new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full', timeZone: 'Asia/Seoul' }).format(new Date()), 'eyebrow'), text('h2', heading), text('p', copy)); main.append(intro);
    const grid = document.createElement('section'); grid.className = 'dashboard-grid'; grid.setAttribute('aria-label', '현재 업무 요약');
    if (route === 'super_admin') grid.append(card('가입·계정 승인 대기', pending.length ? '보호된 계정 승인 화면에서 확인하세요.' : '현재 승인 대기 항목이 없습니다.', { value: pending.length ? `${pending.length}건` : undefined, action: { label: '가입 승인 열기', run: () => { window.location.href = '../staff/?admin=1'; } } }));
    if (route === 'ceo') grid.append(card('전체 운영 세부 화면', '현재는 역할별 보안 권한을 유지하며 후속 단계에서 연결합니다.', { preparing: true }));
    grid.append(card(route === 'field_lead' ? '오늘 작업과 장소' : '오늘 일정', schedules.length ? schedules[0].title : '현재 나에게 적용되는 일정이 없습니다.', { value: schedules.length ? `${schedules.length}건` : undefined, action: managerRoles.has(route) ? { label: '일정 관리', run: () => openPanel('schedule-admin-panel') } : undefined }));
    const important = notices.filter(item => item.importance === 'urgent' || item.importance === 'important');
    grid.append(card('중요공지', important.length ? important[0].title : '현재 중요한 공지가 없습니다.', { value: important.length ? `${important.length}건` : undefined, action: managerRoles.has(route) ? { label: '공지 관리', run: () => openPanel('notice-admin-panel') } : undefined }));
    if (route !== 'ceo') grid.append(card(route === 'field_lead' ? '변경된 작업방법' : '작업방법', guides.length ? '현재 열람 가능한 작업방법이 있습니다.' : '현재 열람 가능한 작업방법이 없습니다.', { value: guides.length ? `${guides.length}개` : undefined, action: managerRoles.has(route) ? { label: '작업방법 관리', run: () => openPanel('today-admin-panel') } : undefined }));
    if (route === 'operations_manager') grid.append(card('근로자지원 특이사항', '후속 기능에서 안전하게 연결할 예정입니다.', { preparing: true }));
    if (['worker_support_lead', 'worker_support_staff'].includes(route)) grid.append(card('근로자지원 업무', '민감정보를 포함하지 않는 바로가기만 후속 기능에서 연결합니다.', { preparing: true }));
    if (['promotion_lead', 'promotion_staff'].includes(route)) grid.append(card('홍보 업무', '홍보 모듈이 준비되면 이 위치에서 연결합니다.', { preparing: true }));
    main.append(grid);
    const quick = document.createElement('section'); quick.className = 'dashboard-section'; quick.append(text('h2', '빠른 이동')); const links = document.createElement('div'); links.className = 'quick-links';
    if (managerRoles.has(route)) { links.append(button('오늘 관리', () => openPanel('today-admin-panel')), button('일정 관리', () => openPanel('schedule-admin-panel')), button('공지 관리', () => openPanel('notice-admin-panel')), button('안내 관리', () => openPanel('guidance-admin-panel'))); }
    if (route === 'super_admin') links.append(button('가입 승인', () => { window.location.href = '../staff/?admin=1'; }));
    if (links.childElementCount) { quick.append(links); main.append(quick); }
  }
  function setup(event) {
    const route = event.detail.route; if (route === worker) return;
    el('desktop-app-shell').hidden = false; el('desktop-role-label').textContent = event.detail.label; el('desktop-page-title').textContent = routeCopy[route]?.[0] || '업무 안내'; el('desktop-user-label').textContent = `${window.TaejangApp.getContext().display_name || '사용자'} · ${event.detail.label}`; menu(route);
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
