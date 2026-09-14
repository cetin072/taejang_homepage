(() => {
  'use strict';

  const ROLE_ORDER = {
    promotion_staff: [
      '대시보드', '새 홍보글 작성', '보낸 글', '보완 요청받은 글', '공지 확인', '홈페이지'
    ],
    promotion_lead: [
      '대시보드',
      '새 홍보글 작성', '홍보글 승인·검토', '기존 글 관리', '홈페이지 내용 관리', '공지 관리',
      '팀 직원 관리', '신규 직원 등록 요청', '업무 배정', '일정 관리',
      '출근부',
      '홈페이지',
      '신규 사업 기획'
    ],
    operations_manager: [
      '대시보드',
      '직원 관리', '신규 직원 등록', '가입 승인',
      '홍보 검토', '홍보 글 작성', '홍보 글 관리',
      '홈페이지 내용 관리', '홈페이지 직접 수정',
      '업무 배정', '일정 관리',
      '공지 관리', '상시 안내 관리',
      '근태·급여관리', '출근부',
      '홈페이지'
    ],
    department_lead: [
      '대시보드',
      '팀 직원 관리', '신규 직원 등록 요청', '업무 배정', '일정 관리',
      '공지 관리', '상시 안내 관리',
      '홈페이지'
    ],
    field_lead: [
      '대시보드',
      '업무 배정', '일정 관리',
      '공지 관리', '상시 안내 관리',
      '홈페이지'
    ],
    ceo: ['대시보드', '홍보 검토', '홈페이지'],
    super_admin: [
      '대시보드',
      '계정 승인',
      '업무 배정', '일정 관리',
      '공지 관리', '상시 안내 관리',
      '홈페이지'
    ]
  };

  const ROLE_SECTIONS = {
    promotion_staff: [
      { label: '홍보', items: ['새 홍보글 작성', '보낸 글', '보완 요청받은 글'] },
      { label: '공지', items: ['공지 확인'] }
    ],
    promotion_lead: [
      { label: '홍보', items: ['새 홍보글 작성', '홍보글 승인·검토', '기존 글 관리'] },
      { label: '홈페이지', items: ['홈페이지 내용 관리'] },
      { label: '공지', items: ['공지 관리'] },
      { label: '팀 운영', items: ['팀 직원 관리', '신규 직원 등록 요청', '업무 배정', '일정 관리'] },
      { label: '근태', items: ['출근부'] }
    ],
    operations_manager: [
      { label: '직원·계정', items: ['직원 관리', '신규 직원 등록', '가입 승인'] },
      { label: '홍보', items: ['홍보 검토', '홍보 글 작성', '홍보 글 관리'] },
      { label: '홈페이지', items: ['홈페이지 내용 관리', '홈페이지 직접 수정'] },
      { label: '업무 운영', items: ['업무 배정', '일정 관리'] },
      { label: '공지', items: ['공지 관리', '상시 안내 관리'] },
      { label: '근태·급여', items: ['근태·급여관리', '출근부'] }
    ],
    department_lead: [
      { label: '팀 운영', items: ['팀 직원 관리', '신규 직원 등록 요청', '업무 배정', '일정 관리'] },
      { label: '공지·안내', items: ['공지 관리', '상시 안내 관리'] }
    ],
    field_lead: [
      { label: '현장 운영', items: ['업무 배정', '일정 관리'] },
      { label: '공지·안내', items: ['공지 관리', '상시 안내 관리'] }
    ],
    ceo: [
      { label: '승인·검토', items: ['홍보 검토'] }
    ],
    super_admin: [
      { label: '시스템 관리', items: ['계정 승인'] },
      { label: '업무 운영', items: ['업무 배정', '일정 관리'] },
      { label: '공지·안내', items: ['공지 관리', '상시 안내 관리'] }
    ]
  };

  const CHECKING = new Set(['신규 사업 기획']);
  const LABEL_RENAMES = new Map([
    ['글 관리', '홍보 글 관리'],
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

  function ensureIssue207RoleContract(nav, currentRole) {
    if (!nav) return;

    if (currentRole === 'promotion_staff') {
      let write = findByLabel(nav, ['홍보 작성', '새 홍보글 작성']);
      if (!write) {
        write = navButton('새 홍보글 작성', () => openPromotion('write'), { phaseCV2Nav: 'write', promotionWriteNav: '1' });
        nav.append(write);
      }
      write.textContent = '새 홍보글 작성';

      let revision = findByLabel(nav, ['수정·보완 요청', '보완 요청받은 글']);
      if (!revision) {
        revision = navButton('보완 요청받은 글', () => openPromotion('revision'), { phaseCV2Nav: 'revision', promotionReturnedNav: '1' });
        nav.append(revision);
      }
      revision.textContent = '보완 요청받은 글';

      if (!findByLabel(nav, '보낸 글')) {
        nav.append(navButton('보낸 글', () => window.TaejangIssue207Ux?.openSent?.(), { issue207Nav: 'sent' }));
      }
      if (!findByLabel(nav, '공지 확인')) {
        nav.append(navButton('공지 확인', () => window.TaejangIssue207Ux?.openInformationRead?.(), { issue207Nav: 'notice-read' }));
      }
      return;
    }

    if (currentRole === 'promotion_lead') {
      [...nav.children].forEach(node => {
        if (node.dataset?.phaseCV2Nav === 'revision' || ['수정·보완 요청', '보완 요청받은 글'].includes(cleanLabel(node))) node.remove();
      });

      let write = findByLabel(nav, ['홍보 작성', '새 홍보글 작성']);
      if (!write) {
        write = navButton('새 홍보글 작성', () => openPromotion('write'), { phaseCV2Nav: 'write', promotionWriteNav: '1' });
        nav.append(write);
      }
      write.textContent = '새 홍보글 작성';

      let review = findByLabel(nav, ['홍보 검토', '홍보 관리', '승인·검토', '홍보글 승인·검토']);
      if (!review) {
        review = navButton('홍보글 승인·검토', () => openPromotion('review'), { phaseCV2Nav: 'review' });
        nav.append(review);
      }
      review.textContent = '홍보글 승인·검토';

      if (!findByLabel(nav, '기존 글 관리')) {
        nav.append(navButton('기존 글 관리', () => window.TaejangPublicationAdmin?.openPublicationAdmin?.(), {
          phaseCPublicationAdmin: '1'
        }));
      }
      if (!findByLabel(nav, '홈페이지 내용 관리')) {
        nav.append(navButton('홈페이지 내용 관리', () => window.TaejangPromotionWorkspaceV2Api?.openHomepageManagement?.(), {
          phaseCV2Nav: 'homepage'
        }));
      }
      if (!findByLabel(nav, '공지 관리')) {
        nav.append(navButton('공지 관리', () => window.TaejangIssue207Ux?.openInformationHub?.(), {
          issue207Nav: 'notice-manage'
        }));
      }
    }
  }

  function normalizeLabel(node, role) {
    if (node.dataset?.navSection === 'official_channels' || node.dataset?.supportMyWorkNav || node.dataset?.supportRadarNavGroup) return;
    const current = cleanLabel(node);
    if (role === 'promotion_staff' && current === '홍보 작성') {
      node.textContent = '새 홍보글 작성';
      return;
    }
    if (role === 'promotion_staff' && current === '수정·보완 요청') {
      node.textContent = '보완 요청받은 글';
      return;
    }
    if (role === 'promotion_lead' && current === '홍보 작성') {
      node.textContent = '새 홍보글 작성';
      return;
    }
    if (role === 'promotion_lead' && ['홍보 검토', '홍보 관리', '승인·검토'].includes(current)) {
      node.textContent = '홍보글 승인·검토';
      return;
    }
    if (role === 'promotion_lead' && ['글 관리', '홍보 글 관리', '공개글 관리'].includes(current)) {
      node.textContent = '기존 글 관리';
      return;
    }
    const renamed = LABEL_RENAMES.get(current);
    if (renamed) node.textContent = renamed;
  }

  function ensurePayrollEntry(nav, currentRole) {
    if (!nav || currentRole !== 'operations_manager') return null;
    const existing = [...nav.children].find(node => cleanLabel(node) === '근태·급여관리');
    if (existing) return existing;

    const link = document.createElement('a');
    link.href = 'payroll/live.html';
    link.textContent = '근태·급여관리';
    link.className = 'app-nav-item';
    link.dataset.payrollMvpNav = '1';
    link.setAttribute('aria-label', '근태·급여관리 사전운영 화면 열기');
    nav.append(link);
    return link;
  }

  function supportGroupPriority(role) {
    if (role === 'promotion_lead') return 105;
    if (role === 'operations_manager') return 155;
    return 7900;
  }

  function priority(node, role) {
    if (node.dataset?.navSection === 'official_channels') return 9000;
    if (node.dataset?.supportMyWorkNav || node.dataset?.supportRadarNavGroup) return supportGroupPriority(role);
    const label = cleanLabel(node);
    if (CHECKING.has(label) || node.dataset.featureStatus === 'checking') return 10000;
    const order = ROLE_ORDER[role] || [];
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

    const sections = ROLE_SECTIONS[role] || [];
    sections.forEach(section => {
      const first = section.items
        .map(label => nodes.find(node => node.dataset?.navSection !== 'official_channels' && !node.dataset?.supportMyWorkNav && !node.dataset?.supportRadarNavGroup && cleanLabel(node) === label))
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
      ensureIssue207RoleContract(nav, currentRole);
      const children = [...nav.children];
      children.forEach(node => {
        normalizeLabel(node, currentRole);
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

  window.TaejangRoleNavigationPriority = { ROLE_ORDER, ROLE_SECTIONS, ensurePayrollEntry, ensureIssue207RoleContract, reorder, schedule };
})();
