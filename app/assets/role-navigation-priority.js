(() => {
  'use strict';

  const MASTER_ORDER = Object.freeze([
    '대시보드',
    '직원 관리', '신규 직원 등록', '가입 승인', '복구·계정 관리',
    '홍보 검토', '홍보 글 작성', '보낸 글', '보완 요청받은 글',
    '기존 글 관리', '홍보글 관리·복구', '발행 대기',
    '홈페이지 내용 관리', '홈페이지 직접 수정',
    '업무 배정', '일정 관리', '일정 캘린더',
    '공지 관리', '상시 안내 관리',
    '근태·급여관리', '외부 급여초안 검토', '외부 급여초안 상신',
    '출근부', '근태 보정',
    '홈페이지',
    '신규 사업 기획'
  ]);

  const MASTER_SECTIONS = Object.freeze([
    { label: '직원·계정', items: ['직원 관리', '신규 직원 등록', '가입 승인', '복구·계정 관리'] },
    { label: '홍보', items: ['홍보 검토', '홍보 글 작성', '보낸 글', '보완 요청받은 글', '기존 글 관리', '홍보글 관리·복구', '발행 대기'] },
    { label: '홈페이지', items: ['홈페이지 내용 관리', '홈페이지 직접 수정'] },
    { label: '업무 운영', items: ['업무 배정', '일정 관리', '일정 캘린더'] },
    { label: '공지·안내', items: ['공지 관리', '상시 안내 관리'] },
    { label: '근태·급여', items: ['근태·급여관리', '외부 급여초안 검토', '외부 급여초안 상신', '출근부', '근태 보정'] }
  ]);

  const DESKTOP_ROLES = Object.freeze([
    'promotion_staff', 'promotion_lead', 'operations_manager', 'department_lead',
    'field_lead', 'ceo', 'super_admin', 'worker_support_lead',
    'worker_support_staff', 'office_staff', 'work_assistant', 'external_guide'
  ]);

  const ROLE_ORDER = Object.freeze(Object.fromEntries(
    DESKTOP_ROLES.map(role => [role, MASTER_ORDER])
  ));
  const ROLE_SECTIONS = Object.freeze(Object.fromEntries(
    DESKTOP_ROLES.map(role => [role, MASTER_SECTIONS])
  ));

  const CHECKING = new Set(['신규 사업 기획']);
  const LABEL_RENAMES = new Map([
    ['팀 직원 관리', '직원 관리'],
    ['신규 직원 등록 요청', '신규 직원 등록'],
    ['계정 승인', '가입 승인'],
    ['홍보 작성', '홍보 글 작성'],
    ['새 홍보글 작성', '홍보 글 작성'],
    ['수정·보완 요청', '보완 요청받은 글'],
    ['홍보글 승인·검토', '홍보 검토'],
    ['홍보 관리', '홍보 검토'],
    ['승인·검토', '홍보 검토'],
    ['글 관리', '기존 글 관리'],
    ['홍보 글 관리', '기존 글 관리'],
    ['공개글 관리', '기존 글 관리'],
    ['홍보글 보관·복구', '홍보글 관리·복구'],
    ['안내 관리', '상시 안내 관리']
  ]);
  let scheduled = false;
  let reordering = false;

  const route = () => window.TaejangApp?.getRoute?.();
  const cleanLabel = node => (node.textContent || '').replace(/\s*·\s*점검중\s*$/, '').trim();

  function invoke(label, callback) {
    if (typeof callback === 'function') return callback();
    window.TaejangFeatureHealth?.showFailure?.(label);
  }

  function openPromotion(mode) {
    const api = window.TaejangPromotionWorkspaceV2Api?.openPromotion;
    if (typeof api === 'function') return api(mode);
    document.dispatchEvent(new CustomEvent('taejang-open-promotion-workspace', { detail: { mode } }));
  }

  function navButton(label, callback, dataset = {}) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.className = 'app-nav-item';
    Object.entries(dataset).forEach(([key, value]) => { node.dataset[key] = value; });
    node.addEventListener('click', () => invoke(label, callback));
    return node;
  }

  function findByLabel(nav, labels) {
    const wanted = new Set(Array.isArray(labels) ? labels : [labels]);
    return [...nav.children].find(node => wanted.has(cleanLabel(node))) || null;
  }

  function ensureIssue207RoleContract(nav) {
    if (!nav) return;
    [...nav.children].forEach(node => normalizeLabel(node));
  }

  function normalizeLabel(node) {
    if (node.dataset?.navSection === 'official_channels' || node.dataset?.supportMyWorkNav || node.dataset?.supportRadarNavGroup) return;
    const current = cleanLabel(node);
    const renamed = LABEL_RENAMES.get(current);
    if (renamed) node.textContent = renamed;
  }

  function capabilityAllowed(capability, legacyAllowed) {
    const app = window.TaejangApp;
    return app?.hasCapabilityContract?.()
      ? app.can?.(capability) === true
      : legacyAllowed;
  }

  function ensurePayrollEntry(nav, currentRole) {
    if (!nav || !capabilityAllowed('payroll.manage', currentRole === 'operations_manager')) return null;
    const existing = [...nav.children].find(node => cleanLabel(node) === '근태·급여관리');
    if (existing) return existing;

    const link = document.createElement('a');
    link.href = 'payroll/live.html';
    link.textContent = '근태·급여관리';
    link.className = 'app-nav-item';
    link.dataset.payrollMvpNav = '1';
    link.dataset.capabilityAny = 'payroll.manage';
    link.setAttribute('aria-label', '근태·급여관리 사전운영 화면 열기');
    nav.append(link);
    return link;
  }

  function ensurePayrollHandoffEntry(nav, currentRole) {
    if (!nav) return null;
    const canApprove = capabilityAllowed('payroll.handoff.approve', currentRole === 'operations_manager');
    const canReview = capabilityAllowed('payroll.handoff.review', currentRole === 'promotion_lead');
    if (!canApprove && !canReview) return null;

    const label = canApprove ? '외부 급여초안 검토' : '외부 급여초안 상신';
    const existing = [...nav.children].find(node => cleanLabel(node) === label);
    if (existing) return existing;

    const link = document.createElement('a');
    link.href = 'payroll/handoff.html';
    link.textContent = label;
    link.className = 'app-nav-item';
    link.dataset.payrollHandoffNav = '1';
    link.dataset.capabilityAny = canApprove ? 'payroll.handoff.approve' : 'payroll.handoff.review';
    link.setAttribute('aria-label', `${label} 화면 열기`);
    nav.append(link);
    return link;
  }

  function supportGroupPriority() {
    return 235;
  }

  function priority(node, role) {
    if (node.dataset?.navSuppressed === '1' || node.hidden) return 11000;
    if (node.dataset?.navSection === 'official_channels') return 9000;
    if (node.dataset?.supportMyWorkNav || node.dataset?.supportRadarNavGroup) return supportGroupPriority(role);
    const label = cleanLabel(node);
    if (CHECKING.has(label) || node.dataset.featureStatus === 'checking') return 10000;
    const order = MASTER_ORDER;
    const index = order.indexOf(label);
    if (index >= 0) return index * 10;
    if (label === '홈페이지') return 9000;
    return 8000;
  }

  function markStatus(node) {
    if (node.dataset?.navSection === 'official_channels' || node.dataset?.supportMyWorkNav || node.dataset?.supportRadarNavGroup) return;
    const label = cleanLabel(node);
    if (!CHECKING.has(label) && node.dataset.featureStatus !== 'checking') return;
    const markedLabel = `${label} · 점검중`;
    node.dataset.featureStatus = 'checking';
    node.classList.add('app-nav-checking');
    if ((node.textContent || '').trim() !== markedLabel) node.textContent = markedLabel;
    node.title = '현재 기능 점검중입니다.';
  }

  function decorateSections(nodes, role) {
    nodes.forEach(node => {
      if (node.dataset?.supportMyWorkNav || node.dataset?.supportRadarNavGroup) return;
      node.classList.remove('app-nav-section-start');
      delete node.dataset.sectionLabel;
    });

    const sections = MASTER_SECTIONS;
    sections.forEach(section => {
      const first = section.items
        .map(label => nodes.find(node => !node.hidden && node.dataset?.navSuppressed !== '1' && node.dataset?.navSection !== 'official_channels' && !node.dataset?.supportMyWorkNav && !node.dataset?.supportRadarNavGroup && cleanLabel(node) === label))
        .find(Boolean);
      if (!first) return;
      first.classList.add('app-nav-section-start');
      first.dataset.sectionLabel = section.label;
    });
  }

  function updateCurrent(target) {
    if (!target || target.target === '_blank') return;
    const nav = document.getElementById('app-nav');
    if (!nav) return;
    [...nav.children].forEach(node => node.removeAttribute('aria-current'));
    target.setAttribute('aria-current', 'page');
  }

  function markDashboardCurrent() {
    const nav = document.getElementById('app-nav');
    if (!nav) return;
    const dashboard = [...nav.children].find(node => cleanLabel(node) === '대시보드');
    if (dashboard) updateCurrent(dashboard);
  }

  function reorder() {
    scheduled = false;
    if (reordering) return;
    const nav = document.getElementById('app-nav');
    const currentRole = route();
    if (!nav || !currentRole || currentRole === 'general_worker') return;

    reordering = true;
    try {
      ensurePayrollEntry(nav, currentRole);
      ensurePayrollHandoffEntry(nav, currentRole);
      ensureIssue207RoleContract(nav);
      const children = [...nav.children];
      children.forEach(node => {
        normalizeLabel(node);
        if (node.dataset?.navSection !== 'official_channels' && !node.dataset?.supportMyWorkNav && !node.dataset?.supportRadarNavGroup) node.classList.add('app-nav-item');
        markStatus(node);
      });

      const desired = [...children].sort((a, b) => {
        const diff = priority(a, currentRole) - priority(b, currentRole);
        if (diff) return diff;
        return children.indexOf(a) - children.indexOf(b);
      });
      const changed = desired.some((node, index) => children[index] !== node);
      if (changed) {
        const fragment = document.createDocumentFragment();
        desired.forEach(node => fragment.append(node));
        nav.append(fragment);
      }

      decorateSections(desired, currentRole);
      const checking = desired.filter(node => node.dataset.featureStatus === 'checking');
      desired.forEach(node => node.classList.remove('app-nav-checking-first'));
      checking[0]?.classList.add('app-nav-checking-first');
      nav.dataset.navigationSettled = '1';
    } finally {
      reordering = false;
    }
  }

  function schedule() {
    if (scheduled || reordering) return;
    scheduled = true;
    setTimeout(reorder, 0);
  }

  function bind() {
    const nav = document.getElementById('app-nav');
    if (!nav || nav.dataset.priorityBound) return;
    nav.dataset.priorityBound = '1';
    nav.addEventListener('click', event => {
      const target = event.target?.closest?.('button, a');
      if (!target || !nav.contains(target)) return;
      updateCurrent(target);
    });
  }

  document.addEventListener('taejang-app-ready', () => { bind(); schedule(); });
  document.addEventListener('taejang-dashboard-refresh', () => { schedule(); setTimeout(markDashboardCurrent, 0); });
  document.addEventListener('taejang-open-promotion-workspace', schedule);
  document.addEventListener('taejang-navigation-changed', schedule);

  const start = () => { bind(); schedule(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.TaejangRoleNavigationPriority = { MASTER_ORDER, MASTER_SECTIONS, ROLE_ORDER, ROLE_SECTIONS, ensurePayrollEntry, ensurePayrollHandoffEntry, ensureIssue207RoleContract, reorder, schedule };
})();