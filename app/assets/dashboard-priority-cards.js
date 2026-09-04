(() => {
  'use strict';

  const CARD_ORDER = {
    operations_manager: ['가입 승인', '직원관리 요청', '중요 홍보 승인', '홈페이지 수정 승인'],
    promotion_lead: ['오늘 출근부', '팀 직원 관리', '홍보 검토 대기', '홍보자료 작성', '중요공지', '가까운 일정'],
    department_lead: ['팀 직원 관리', '중요공지', '가까운 일정'],
    field_lead: ['오늘 작업과 장소', '중요공지'],
    ceo: ['홍보 상신 검토', '중요공지', '가까운 일정'],
    super_admin: ['계정 승인 확인', '중요공지', '가까운 일정'],
    promotion_staff: ['수정·보완 요청', '홍보자료 작성', '중요공지', '가까운 일정']
  };

  const OPERATIONS_DASHBOARD_HIDDEN = new Set(['오늘 출근부', '중요공지', '가까운 일정']);
  let rendering = false;
  let scheduled = false;
  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');
  const el = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value !== undefined && value !== null) node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const button = (label, handler) => {
    const node = el('button', label, 'button button-quiet');
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  };

  function card(title, body, value, action) {
    const node = el('article', null, 'dashboard-card');
    node.dataset.priorityDashboardCard = title;
    node.append(el('span', '현재 정보', 'status-label'), el('h3', title));
    if (value) node.append(el('p', value, 'dashboard-value'));
    node.append(el('p', body));
    if (action) node.append(button(action.label, action.run));
    return node;
  }

  function titleOf(node) { return node.querySelector('h3')?.textContent?.trim() || ''; }

  function removeLowPriorityOperationsCards(currentRoute, grid) {
    if (currentRoute !== 'operations_manager') return;
    [...grid.children].forEach(node => {
      if (OPERATIONS_DASHBOARD_HIDDEN.has(titleOf(node))) node.remove();
    });
  }

  async function addEmployeeCard(currentRoute, grid) {
    if (!['operations_manager', 'promotion_lead', 'department_lead'].includes(currentRoute)) return;
    if (grid.querySelector('[data-priority-dashboard-card="직원관리 요청"], [data-priority-dashboard-card="팀 직원 관리"]')) return;
    try {
      const context = await app().rpc('get_employee_management_context');
      const requests = Array.isArray(context?.change_requests) ? context.change_requests : [];
      if (currentRoute === 'operations_manager' && !requests.length) return;
      const title = currentRoute === 'operations_manager' ? '직원관리 요청' : '팀 직원 관리';
      const body = currentRoute === 'operations_manager'
        ? '팀장이 보낸 직원 등록·수정 요청을 확인하세요.'
        : (requests.length ? '내가 보낸 직원 등록·수정 요청 상태를 확인하세요.' : '우리 팀 직원정보와 필요한 변경 요청을 관리합니다.');
      const value = requests.length ? `${requests.length}건` : undefined;
      if (!grid.isConnected) return;
      grid.append(card(title, body, value, {
        label: currentRoute === 'operations_manager' ? '직원 관리 열기' : '팀 직원 관리 열기',
        run: () => window.TaejangEmployeeManagement?.openEmployeeManagement?.()
      }));
    } catch { /* Dashboard remains usable if employee summary is unavailable. */ }
  }

  async function addHomepageApprovalCard(currentRoute, grid) {
    if (currentRoute !== 'operations_manager' || grid.querySelector('[data-priority-dashboard-card="홈페이지 수정 승인"]')) return;
    try {
      const requests = await app().rpc('get_homepage_change_requests');
      const pending = (Array.isArray(requests) ? requests : []).filter(item => item.status === 'pending');
      if (!pending.length || !grid.isConnected) return;
      grid.append(card('홈페이지 수정 승인', '운영팀장이 요청한 홈페이지 글·사진 변경을 확인하세요.', `${pending.length}건`, {
        label: '홈페이지 요청 검토',
        run: () => window.TaejangHomepageContent?.open?.()
      }));
    } catch { /* Optional summary only. */ }
  }

  function reorderCards(currentRoute, grid) {
    const order = CARD_ORDER[currentRoute] || [];
    const children = [...grid.children];
    const desired = [...children].sort((a, b) => {
      const ai = order.indexOf(titleOf(a));
      const bi = order.indexOf(titleOf(b));
      const ap = ai < 0 ? 9000 : ai;
      const bp = bi < 0 ? 9000 : bi;
      return ap - bp || children.indexOf(a) - children.indexOf(b);
    });
    if (!desired.some((node, index) => children[index] !== node)) return;
    const fragment = document.createDocumentFragment();
    desired.forEach(node => fragment.append(node));
    grid.append(fragment);
  }

  async function sync() {
    scheduled = false;
    if (rendering) return;
    const currentRoute = route();
    const target = main();
    const grid = target?.querySelector('.dashboard-grid');
    const heading = target?.querySelector('.dashboard-intro h2')?.textContent || '';
    const specialDashboard = currentRoute === 'field_lead' || currentRoute === 'ceo';
    if (!currentRoute || !grid || (!heading.includes('대시보드') && !specialDashboard)) return;
    rendering = true;
    try {
      removeLowPriorityOperationsCards(currentRoute, grid);
      await addEmployeeCard(currentRoute, grid);
      await addHomepageApprovalCard(currentRoute, grid);
      if (grid.isConnected) {
        removeLowPriorityOperationsCards(currentRoute, grid);
        reorderCards(currentRoute, grid);
      }
    } finally { rendering = false; }
  }

  function scheduleSync(delay = 40) {
    if (scheduled) return;
    scheduled = true;
    setTimeout(sync, delay);
  }

  function bindObserver() {
    const target = main();
    if (!target || target.dataset.priorityCardsObserved) return;
    target.dataset.priorityCardsObserved = '1';
    new MutationObserver(() => scheduleSync()).observe(target, { childList: true, subtree: true });
  }

  document.addEventListener('taejang-app-ready', () => setTimeout(() => { bindObserver(); scheduleSync(); }, 260));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(scheduleSync, 260));

  const start = () => bindObserver();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.TaejangDashboardPriorityCards = { sync, CARD_ORDER, OPERATIONS_DASHBOARD_HIDDEN };
})();
