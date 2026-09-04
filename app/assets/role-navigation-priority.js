(() => {
  'use strict';

  const ROLE_ORDER = {
    promotion_staff: [
      '대시보드', '홍보 작성', '일정 확인', '공지 확인', '자주 보는 안내', '홈페이지'
    ],
    promotion_lead: [
      '대시보드', '출근부', '홍보 검토', '홍보 작성', '팀 직원 관리', '업무 배정',
      '일정 관리', '공지 관리', '안내 관리', '홈페이지 내용 관리', '작업 매뉴얼', '홈페이지',
      '신규 사업 기획'
    ],
    operations_manager: [
      '대시보드', '가입 승인', '직원 관리', '출근부', '홍보 검토', '업무 배정',
      '일정 관리', '공지 관리', '안내 관리', '홈페이지 내용 관리', '홍보 글 작성',
      '홈페이지 직접 수정', '작업 매뉴얼', '홈페이지'
    ],
    department_lead: [
      '대시보드', '팀 직원 관리', '업무 배정', '일정 관리', '공지 관리', '안내 관리',
      '작업 매뉴얼', '홈페이지'
    ],
    field_lead: [
      '대시보드', '업무 배정', '일정 관리', '공지 관리', '안내 관리', '작업 매뉴얼', '홈페이지'
    ],
    ceo: ['대시보드', '홍보 검토', '홈페이지'],
    super_admin: [
      '대시보드', '계정 승인', '업무 배정', '일정 관리', '공지 관리', '안내 관리',
      '작업 매뉴얼', '홈페이지'
    ]
  };

  const CHECKING = new Set(['신규 사업 기획']);
  let scheduled = false;

  const route = () => window.TaejangApp?.getRoute?.();
  const cleanLabel = node => (node.textContent || '').replace(/\s*·\s*점검중\s*$/, '').trim();

  function priority(node, role) {
    if (node.dataset?.navSection === 'official_channels') return 9000;
    const label = cleanLabel(node);
    if (CHECKING.has(label) || node.dataset.featureStatus === 'checking') return 10000;
    const order = ROLE_ORDER[role] || [];
    const index = order.indexOf(label);
    if (index >= 0) return index * 10;
    if (label === '홈페이지') return 9000;
    return 8000;
  }

  function markStatus(node) {
    if (node.dataset?.navSection === 'official_channels') return;
    const label = cleanLabel(node);
    if (!CHECKING.has(label) && node.dataset.featureStatus !== 'checking') return;
    const markedLabel = `${label} · 점검중`;
    node.dataset.featureStatus = 'checking';
    node.classList.add('app-nav-checking');
    if ((node.textContent || '').trim() !== markedLabel) node.textContent = markedLabel;
    node.title = '현재 기능 점검중입니다.';
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
    const nav = document.getElementById('app-nav');
    const currentRole = route();
    if (!nav || !currentRole || currentRole === 'general_worker') return;

    const children = [...nav.children];
    children.forEach(node => {
      if (node.dataset?.navSection !== 'official_channels') node.classList.add('app-nav-item');
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

    const checking = desired.filter(node => node.dataset.featureStatus === 'checking');
    desired.forEach(node => node.classList.remove('app-nav-checking-first'));
    checking[0]?.classList.add('app-nav-checking-first');
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(reorder);
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
    new MutationObserver(schedule).observe(nav, { childList: true, subtree: true });
    schedule();
  }

  document.addEventListener('taejang-app-ready', () => setTimeout(() => { bind(); schedule(); }, 180));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(() => { schedule(); markDashboardCurrent(); }, 180));

  const start = () => { bind(); schedule(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.TaejangRoleNavigationPriority = { ROLE_ORDER, reorder };
})();