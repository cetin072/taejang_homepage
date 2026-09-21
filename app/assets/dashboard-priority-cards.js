(() => {
  'use strict';

  const CARD_ORDER = {
    operations_manager: ['근태·급여관리', '가입 승인', '직원관리 요청', '중요 홍보 승인', '홈페이지 수정 승인'],
    promotion_lead: ['팀 직원 관리', '홍보 검토 대기', '홍보자료 작성'],
    department_lead: ['팀 직원 관리'],
    field_lead: [],
    ceo: ['홍보 상신 검토'],
    super_admin: ['계정 승인 확인'],
    promotion_staff: ['수정·보완 요청', '홍보자료 작성']
  };

  const OPERATIONS_DASHBOARD_HIDDEN = new Set(['오늘 출근부']);
  const PRIORITY_CARD_KEYS = Object.freeze({
    '근태·급여관리':'payroll.manage',
    '가입 승인':'account.approval',
    '신입 가입 승인':'account.signup-requests',
    '직원관리 요청':'employee.change-requests',
    '팀 직원 관리':'employee.team',
    '중요 홍보 승인':'promotion.operations.review',
    '홍보 검토 대기':'promotion.review.pending',
    '홍보자료 작성':'promotion.write',
    '보완 요청받은 글':'promotion.revision',
    '홍보 상신 검토':'promotion.ceo.review',
    '홈페이지 수정 승인':'homepage.change-approval',
    '오늘 출근부':'attendance.today',
    '지원사업 레이더':'support.radar'
  });
  const DEFAULT_CARD_KEY_ORDER = Object.freeze({
    operations_manager: ['payroll.manage','account.signup-requests','employee.change-requests','promotion.operations.review','homepage.change-approval','support.radar'],
    promotion_lead: ['employee.team','promotion.review.pending','promotion.write','attendance.today','support.radar'],
    department_lead: ['employee.team','attendance.today'],
    field_lead: ['attendance.today'],
    ceo: ['promotion.ceo.review'],
    super_admin: ['account.approval','account.signup-requests'],
    promotion_staff: ['promotion.revision','promotion.write']
  });
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
    node.dataset.dashboardCardKey = PRIORITY_CARD_KEYS[title] || `dashboard.${title}`;
    node.append(el('span', '현재 정보', 'status-label'), el('h3', title));
    if (value) node.append(el('p', value, 'dashboard-value'));
    node.append(el('p', body));
    if (action) node.append(button(action.label, action.run));
    return node;
  }

  function titleOf(node) { return node.querySelector('h3')?.textContent?.trim() || ''; }
  function cardKey(node) {
    const title = node.dataset?.priorityDashboardCard || titleOf(node);
    const key = node.dataset?.dashboardCardKey
      || (node.dataset?.supportRadarShortcut ? 'support.radar' : null)
      || (node.dataset?.attendanceCard ? 'attendance.today' : null)
      || (node.dataset?.phaseCAccountApprovalCard ? 'account.signup-requests' : null)
      || PRIORITY_CARD_KEYS[title]
      || title;
    if (key) node.dataset.dashboardCardKey = key;
    return key || '';
  }

  function mergeSavedOrder(saved, master) {
    const result = [...new Set((saved || []).filter(key => master.includes(key)))];
    master.forEach(key => {
      if (result.includes(key)) return;
      const masterIndex = master.indexOf(key);
      const previous = [...master.slice(0, masterIndex)].reverse().find(item => result.includes(item));
      const next = master.slice(masterIndex + 1).find(item => result.includes(item));
      if (previous) result.splice(result.indexOf(previous) + 1, 0, key);
      else if (next) result.splice(result.indexOf(next), 0, key);
      else result.push(key);
    });
    return result;
  }

  function defaultCardKeyOrder(currentRoute, visibleKeys = []) {
    const defaults = DEFAULT_CARD_KEY_ORDER[currentRoute] || [];
    return [...defaults.filter(key => visibleKeys.includes(key)), ...visibleKeys.filter(key => !defaults.includes(key))];
  }

  function removeLowPriorityOperationsCards(currentRoute, grid) {
    if (currentRoute !== 'operations_manager') return;
    [...grid.children].forEach(node => {
      if (OPERATIONS_DASHBOARD_HIDDEN.has(titleOf(node))) node.remove();
    });
  }

  function addPayrollCard(currentRoute, grid) {
    if (currentRoute !== 'operations_manager' || grid.querySelector('[data-priority-dashboard-card="근태·급여관리"]')) return;
    grid.append(card(
      '근태·급여관리',
      '오늘 근태를 직접 입력하거나 보안업체 Excel로 채운 뒤 수정·저장하고, 급여 가안과 급여대장 Excel까지 한 화면에서 확인합니다.',
      '운영총괄 1차 사용',
      {
        label: '근태·급여관리 열기',
        run: () => { window.open('payroll/live.html', '_blank', 'noopener,noreferrer'); }
      }
    ));
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
    if (grid.dataset.layoutEditing === '1' || window.TaejangPlatformUiSettings?.isDashboardEditing?.()) return;
    const personal = window.TaejangPlatformUiSettings?.getDashboardOrder?.() || [];
    const children = [...grid.children];
    const visibleKeys = children.map(cardKey);
    const master = defaultCardKeyOrder(currentRoute, visibleKeys);
    const order = personal.length ? mergeSavedOrder(personal, master) : master;
    const desired = [...children].sort((a, b) => {
      const ai = order.indexOf(cardKey(a));
      const bi = order.indexOf(cardKey(b));
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
      addPayrollCard(currentRoute, grid);
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

  window.TaejangDashboardPriorityCards = { sync, CARD_ORDER, DEFAULT_CARD_KEY_ORDER, defaultCardKeyOrder, OPERATIONS_DASHBOARD_HIDDEN };
})();
