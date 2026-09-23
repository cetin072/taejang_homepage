(() => {
  'use strict';

  const MASTER_ORDER = Object.freeze([
    '대시보드',
    '직원 관리', '신규 직원 등록', '가입 승인',
    '홍보 글 작성', '보완 요청받은 글', '보낸 글', '홍보 검토',
    '발행 대기', '기존 글 관리',
    '홈페이지 내용 관리', '홈페이지 직접 수정',
    '업무 배정', '공지 등록', '공지 관리',
    '출근부', '근태 보정', '근태·급여관리', '외부 급여초안 상신', '외부 급여초안 검토',
    '기업 프로필', '지원사업 레이더', '내 지원사업',
    '신규 사업 기획'
  ]);

  const MASTER_SECTIONS = Object.freeze([
    { key: 'employee-account', label: '직원·계정', items: ['직원 관리', '신규 직원 등록', '가입 승인'] },
    { key: 'promotion', label: '홍보', items: ['홍보 글 작성', '보완 요청받은 글', '보낸 글', '홍보 검토', '발행 대기', '기존 글 관리'] },
    { key: 'homepage', label: '홈페이지', items: ['홈페이지 내용 관리', '홈페이지 직접 수정'] },
    { key: 'operations', label: '업무 운영', items: ['업무 배정', '공지 등록', '공지 관리'] },
    { key: 'payroll', label: '근태·급여', items: ['출근부', '근태 보정', '근태·급여관리', '외부 급여초안 상신', '외부 급여초안 검토'] },
    { key: 'support', label: '지원사업', items: ['기업 프로필', '지원사업 레이더', '내 지원사업'] },
    { key: 'official_channels', label: '공식 채널', items: ['홈페이지', '공식 블로그', '공식 유튜브'] }
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
  const RETIRED_NAVIGATION = new Set([
    '복구·계정 관리', '일정 관리', '일정 캘린더', '홍보글 관리·복구', '홍보글 보관·복구',
    '공지 확인', '상시 안내 관리', '공지·안내 관리', '공지·안내 확인'
  ]);
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
  let composing = false;
  let navObserver = null;

  const route = () => window.TaejangApp?.getRoute?.();
  const cleanLabel = node => (node?.textContent || '').replace(/\s*·\s*점검중\s*$/, '').replace(/\s*⋮⋮\s*$/, '').replace(/[▾▸]\s*$/, '').trim();

  function invoke(label, callback) {
    if (typeof callback === 'function') return callback();
    window.TaejangFeatureHealth?.showFailure?.(label);
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

  function menuNodes(nav) {
    return [...nav.children].filter(node =>
      (node.tagName === 'BUTTON' || node.tagName === 'A')
      && node.dataset?.navSectionToggle !== '1'
    );
  }

  function findByLabel(nav, labels) {
    const wanted = new Set(Array.isArray(labels) ? labels : [labels]);
    return menuNodes(nav).find(node => wanted.has(cleanLabel(node))) || null;
  }

  function normalizeLabel(node) {
    if (!node || node.dataset?.navSectionToggle === '1') return;
    const current = cleanLabel(node);
    const renamed = LABEL_RENAMES.get(current);
    if (renamed) node.textContent = renamed;
    const registry = window.TaejangPlatformNavigationRegistry;
    const item = registry?.itemForLabel?.(cleanLabel(node));
    if (item?.key) node.dataset.menuKey = item.key;
  }

  function ensureIssue207RoleContract(nav) {
    if (!nav) return;
    menuNodes(nav).forEach(normalizeLabel);
  }

  function removeLegacySupportGroups(nav) {
    [...nav.children].forEach(node => {
      if (node.dataset?.supportRadarNavGroup || node.dataset?.supportMyWorkNav) node.remove();
    });
  }

  function dedupeCanonicalEntries(nav) {
    const registry = window.TaejangPlatformNavigationRegistry;
    if (!registry || !nav) return false;
    const seen = new Map();
    let changed = false;

    menuNodes(nav).forEach(node => {
      const key = registry.keyForNode?.(node);
      if (!key) return;
      node.dataset.menuKey = key;

      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, node);
        return;
      }

      const existingMaster = existing.dataset?.masterMenuItem === '1';
      const candidateMaster = node.dataset?.masterMenuItem === '1';
      if (candidateMaster && !existingMaster) {
        existing.remove();
        seen.set(key, node);
      } else {
        node.remove();
      }
      changed = true;
    });
    return changed;
  }

  function capabilityAllowed(capability, legacyAllowed) {
    const app = window.TaejangApp;
    return app?.hasCapabilityContract?.()
      ? app.can?.(capability) === true
      : legacyAllowed;
  }

  function ensurePayrollEntry(nav, currentRole) {
    if (!nav || !capabilityAllowed('payroll.manage', currentRole === 'operations_manager')) return null;
    const existing = findByLabel(nav, '근태·급여관리');
    if (existing) return existing;

    const link = document.createElement('a');
    link.href = 'payroll/live.html';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '근태·급여관리';
    link.className = 'app-nav-item';
    link.dataset.payrollMvpNav = '1';
    link.dataset.capabilityAny = 'payroll.manage';
    link.dataset.menuKey = 'payroll.manage';
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
    const existing = findByLabel(nav, label);
    if (existing) return existing;

    const link = document.createElement('a');
    link.href = 'payroll/handoff.html';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    link.className = 'app-nav-item';
    link.dataset.payrollHandoffNav = '1';
    link.dataset.capabilityAny = canApprove ? 'payroll.handoff.approve' : 'payroll.handoff.review';
    link.dataset.menuKey = canApprove ? 'payroll.handoff.approve' : 'payroll.handoff.review';
    link.setAttribute('aria-label', `${label} 화면 열기`);
    nav.append(link);
    return link;
  }

  function priority(node) {
    if (node.dataset?.navSuppressed === '1') return 11000;
    const label = cleanLabel(node);
    if (CHECKING.has(label) || node.dataset?.featureStatus === 'checking') return 10000;
    const registry = window.TaejangPlatformNavigationRegistry;
    const key = registry?.keyForNode?.(node);
    const preference=window.TaejangPlatformUiSettings?.getSidebarPreference?.();
    const item=key ? registry?.byKey?.(key) : null;
    if(key && item?.section) {
      const ordered=preference?.menuOrder || [];
      const index=ordered.indexOf(key);
      if(index>=0) return index * 10;
    }
    const registryIndex = key ? registry?.orderIndex?.(key) : -1;
    if (Number.isFinite(registryIndex) && registryIndex >= 0 && registryIndex < 9000) return registryIndex * 10;
    const index = MASTER_ORDER.indexOf(label);
    if (index >= 0) return index * 10;
    return 8000;
  }

  function markStatus(node) {
    if (!node || node.dataset?.navSectionToggle === '1') return;
    const label = cleanLabel(node);
    if (!CHECKING.has(label) && node.dataset?.featureStatus !== 'checking') return;
    const markedLabel = `${label} · 점검중`;
    node.dataset.featureStatus = 'checking';
    node.classList.add('app-nav-checking');
    if ((node.textContent || '').trim() !== markedLabel) node.textContent = markedLabel;
    node.title = '현재 기능 점검중입니다.';
  }

  function sectionToggle(nav, section) {
    let node = [...nav.children].find(item => item.dataset?.navSectionToggle === '1' && item.dataset?.sectionKey === section.key);
    if (node) return node;

    node = document.createElement('button');
    node.type = 'button';
    node.className = 'app-nav-section-toggle';
    node.dataset.navSectionToggle = '1';
    node.dataset.sectionKey = section.key;
    node.setAttribute('aria-expanded', 'true');

    const label = document.createElement('span');
    label.className = 'app-nav-section-title';
    label.textContent = section.label;
    const icon = document.createElement('span');
    icon.className = 'app-nav-section-chevron';
    icon.dataset.sectionChevron = '1';
    icon.textContent = '▾';
    icon.setAttribute('aria-hidden', 'true');
    node.append(label, icon);

    node.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const api = window.TaejangPlatformUiSettings;
      if (typeof api?.toggleSection === 'function') {
        api.toggleSection(section.key);
        return;
      }
      const collapsed = node.getAttribute('aria-expanded') !== 'false';
      node.setAttribute('aria-expanded', String(!collapsed));
      icon.textContent = collapsed ? '▸' : '▾';
      menuNodes(nav)
        .filter(item => item.dataset?.navSection === section.key)
        .forEach(item => { item.hidden = collapsed; });
    });
    return node;
  }

  function buildDesiredSequence(nav, sortedNodes) {
    const registry = window.TaejangPlatformNavigationRegistry;
    const preference=window.TaejangPlatformUiSettings?.getSidebarPreference?.();
    const sectionRank=new Map((preference?.sectionOrder || []).map((key,index)=>[key,index]));
    const nodeRank = node => {
      const item = registry?.itemForNode?.(node);
      const key = item?.key || registry?.keyForNode?.(node);
      const sectionKey = registry?.sectionForItem?.(item)?.key || null;
      if (key === 'dashboard' || cleanLabel(node) === '대시보드') return -10000;
      if (sectionKey === 'official_channels') return 10000;
      if (sectionKey && sectionRank.has(sectionKey)) return sectionRank.get(sectionKey);
      if (sectionKey) {
        const defaultIndex = MASTER_SECTIONS.findIndex(section => section.key === sectionKey);
        return defaultIndex >= 0 ? defaultIndex : 8000;
      }
      if (CHECKING.has(cleanLabel(node)) || node.dataset?.featureStatus === 'checking') return 9000;
      return 8500;
    };
    const orderedNodes=[...sortedNodes].sort((a,b)=>{
      const diff = nodeRank(a) - nodeRank(b);
      return diff || sortedNodes.indexOf(a)-sortedNodes.indexOf(b);
    });
    const desired = [];
    let previousSectionKey = null;

    orderedNodes.forEach(node => {
      const item = registry?.itemForNode?.(node);
      const section = registry?.sectionForItem?.(item);
      const sectionKey = section?.key || null;
      if (sectionKey && sectionKey !== previousSectionKey) {
        desired.push(sectionToggle(nav, section));
      }
      if (!sectionKey) previousSectionKey = null;
      else previousSectionKey = sectionKey;

      if (sectionKey) node.dataset.navSection = sectionKey;
      else delete node.dataset.navSection;
      desired.push(node);
    });

    const other = [...nav.children].filter(node =>
      !desired.includes(node)
      && node.dataset?.navSectionToggle !== '1'
      && !node.dataset?.officialChannelGroup
      && !node.dataset?.supportRadarNavGroup
      && !node.dataset?.supportMyWorkNav
    );

    return [...desired, ...other];
  }

  function refreshSectionVisibility() {
    const nav = document.getElementById('app-nav');
    if (!nav) return;
    [...nav.querySelectorAll(':scope > [data-nav-section-toggle="1"]')].forEach(toggle => {
      const key = toggle.dataset.sectionKey;
      const children = menuNodes(nav).filter(node => node.dataset?.navSection === key);
      const hasUsableChild = children.some(node =>
        node.dataset?.roleHidden !== '1'
        && !node.dataset?.capabilityDenied
        && node.dataset?.navSuppressed !== '1'
      );
      toggle.hidden = !hasUsableChild;
      toggle.setAttribute('aria-hidden', String(!hasUsableChild));
    });
  }

  function updateCurrent(target) {
    if (!target || target.target === '_blank' || target.dataset?.navSectionToggle === '1') return;
    const nav = document.getElementById('app-nav');
    if (!nav) return;
    menuNodes(nav).forEach(node => node.removeAttribute('aria-current'));
    target.setAttribute('aria-current', 'page');
  }

  function markDashboardCurrent() {
    const nav = document.getElementById('app-nav');
    if (!nav) return;
    const dashboard = findByLabel(nav, '대시보드');
    if (dashboard) updateCurrent(dashboard);
  }

  function reorder() {
    scheduled = false;
    if (composing) return;
    const nav = document.getElementById('app-nav');
    const currentRole = route();
    if (!nav || !currentRole || currentRole === 'general_worker') return;

    composing = true;
    try {
      ensurePayrollEntry(nav, currentRole);
      ensurePayrollHandoffEntry(nav, currentRole);
      removeLegacySupportGroups(nav);
      nav.querySelectorAll(':scope > [data-official-channel-group]').forEach(node => node.remove());
      ensureIssue207RoleContract(nav);
      menuNodes(nav).forEach(normalizeLabel);
      menuNodes(nav).filter(node => RETIRED_NAVIGATION.has(cleanLabel(node))).forEach(node=>node.remove());
      dedupeCanonicalEntries(nav);

      const children = menuNodes(nav);
      children.forEach(node => {
        node.classList.add('app-nav-item');
        markStatus(node);
      });

      const desiredMenu = [...children].sort((a, b) => {
        const diff = priority(a) - priority(b);
        if (diff) return diff;
        return children.indexOf(a) - children.indexOf(b);
      });
      const desired = buildDesiredSequence(nav, desiredMenu);
      [...nav.querySelectorAll(':scope > [data-nav-section-toggle="1"]')].forEach(toggle => {
        if (!desired.includes(toggle)) toggle.remove();
      });
      const current = [...nav.children];
      const changed = desired.length !== current.length || desired.some((node, index) => current[index] !== node);

      if (changed) {
        const fragment = document.createDocumentFragment();
        desired.forEach(node => fragment.append(node));
        nav.append(fragment);
      }

      const checking = desiredMenu.filter(node => node.dataset.featureStatus === 'checking');
      desiredMenu.forEach(node => node.classList.remove('app-nav-checking-first'));
      checking[0]?.classList.add('app-nav-checking-first');

      window.TaejangCapabilityUiGates?.refresh?.();
      window.TaejangPlatformUiSettings?.applyRoleVisibility?.();
      window.TaejangPlatformUiSettings?.applySectionCollapse?.();
      refreshSectionVisibility();

      nav.dataset.navigationSettled = '1';
    } finally {
      composing = false;
    }
  }

  function schedule() {
    if (scheduled || composing) return;
    scheduled = true;
    setTimeout(reorder, 0);
  }

  function bindObserver(nav) {
    if (!nav || nav.dataset.navigationComposerObserver === '1') return;
    nav.dataset.navigationComposerObserver = '1';
    navObserver = new MutationObserver(mutations => {
      if (composing) return;
      if (mutations.some(mutation => mutation.type === 'childList')) schedule();
    });
    navObserver.observe(nav, { childList: true, subtree: false });
  }

  function bind() {
    const nav = document.getElementById('app-nav');
    if (!nav) return;
    bindObserver(nav);
    if (nav.dataset.priorityBound) return;
    nav.dataset.priorityBound = '1';
    nav.addEventListener('click', event => {
      const target = event.target?.closest?.('button, a');
      if (!target || !nav.contains(target) || target.dataset?.navSectionToggle === '1') return;
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

  window.TaejangRoleNavigationPriority = {
    MASTER_ORDER,
    MASTER_SECTIONS,
    ROLE_ORDER,
    ROLE_SECTIONS,
    ensurePayrollEntry,
    ensurePayrollHandoffEntry,
    ensureIssue207RoleContract,
    dedupeCanonicalEntries,
    refreshSectionVisibility,
    reorder,
    schedule
  };
})();
