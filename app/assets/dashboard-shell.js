(() => {
  'use strict';
  const worker = 'general_worker';
  const managerRoles = new Set(['super_admin', 'operations_manager', 'department_lead', 'field_lead']);
  // Promotion leads own the three operational panels below, but not the broader guidance
  // administration surface or the operations-manager payroll surface.
  const workManagementRoles = new Set([...managerRoles, 'promotion_lead']);
  const promotionWorkspaceRoles = new Set(['promotion_staff', 'promotion_lead', 'operations_manager', 'ceo']);
  const el = id => document.getElementById(id);
  const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };
  const array = value => Array.isArray(value) ? value : [];
  const routeCopy = {
    super_admin: ['대시보드', '계정 승인과 현재 운영 정보를 안전하게 확인하세요.'],
    ceo: ['대시보드', '중요 홍보 상신 안건과 핵심 운영 정보를 간결하게 확인하세요.'],
    operations_manager: ['대시보드', '승인과 오늘 처리할 핵심 항목부터 확인하세요.'],
    department_lead: ['대시보드', '우리 부서의 직원·업무 현황과 필요한 관리 기능을 확인하세요.'],
    field_lead: ['대시보드', '오늘 필요한 현장 업무 정보를 확인하세요.'],
    promotion_lead: ['대시보드', '출근부·홍보 검토·홍보 작성 등 오늘의 우선 업무부터 확인하세요.'],
    promotion_staff: ['대시보드', '보완 요청받은 글과 태장 소식 작성·승인 요청을 한 화면에서 처리하세요.']
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
  const DASHBOARD_CARD_KEYS = Object.freeze({
    '홍보 검토 대기':'promotion.review.pending',
    '홍보자료 작성':'promotion.write',
    '보완 요청받은 글':'promotion.revision',
    '중요 홍보 승인':'promotion.operations.review',
    '홍보 상신 검토':'promotion.ceo.review',
    '계정 승인 확인':'account.approval',
    '신입 가입 승인':'account.signup-requests',
    '근태·급여관리':'payroll.manage',
    '직원관리 요청':'employee.change-requests',
    '팀 직원 관리':'employee.team',
    '홈페이지 수정 승인':'homepage.change-approval',
    '오늘 출근부':'attendance.view',
    '지원사업 레이더':'support.radar',
    '공지 등록':'notice.create',
    '공지 관리':'notice.manage'
  });

  function featureUnavailable(key, label) {
    const health = window.TaejangFeatureHealth;
    if (!health?.hasFailed?.(key)) return false;
    health.showFailure?.(label);
    return true;
  }
  function openPanel(id, view = null) {
    if (featureUnavailable('app-workspace-surface', '관리 화면')) return;
    document.dispatchEvent(new CustomEvent('taejang-open-app-panel', { detail: { id, view } }));
  }
  function openPromotion(mode = 'review') {
    if (featureUnavailable('phase-c-workspace-v2', '홍보 업무 기능')) return;
    const open = window.TaejangPromotionWorkspaceV2Api?.openPromotion;
    if (typeof open === 'function') return open(mode);
    document.dispatchEvent(new CustomEvent('taejang-open-promotion-workspace', { detail: { mode } }));
  }
  function openEmployee(view = 'existing') {
    if (featureUnavailable('employee-management', '직원 관리 기능')) return;
    const api = window.TaejangEmployeeManagement?.openEmployeeManagement;
    if (api) return api(view);
    window.TaejangFeatureHealth?.showFailure?.('직원 관리 기능');
  }
  function openSignupApproval() {
    if (featureUnavailable('phase-c-account-approval', '가입 승인 기능')) return;
    const api = window.TaejangAccountApproval?.openAccountApproval;
    if (api) return api();
    window.TaejangFeatureHealth?.showFailure?.('가입 승인 기능');
  }
  function openPromotionWrite() {
    closeSidebar();
    const route = window.TaejangApp?.getRoute?.();
    if (route === 'operations_manager' && typeof window.TaejangOperationsPromotionWriter?.open === 'function') {
      return window.TaejangOperationsPromotionWriter.open();
    }
    return openPromotion('write');
  }
  function openSentPromotion() {
    closeSidebar();
    const api = window.TaejangIssue207Ux?.openSent;
    if (typeof api === 'function') return api();
    window.TaejangFeatureHealth?.showFailure?.('보낸 글 기능');
  }
  function openExistingPromotion() {
    closeSidebar();
    const api = window.TaejangPublicationAdmin?.openPublicationAdmin;
    if (typeof api === 'function') return api();
    window.TaejangFeatureHealth?.showFailure?.('기존 글 관리 기능');
  }
  function openHomepageManagement() {
    closeSidebar();
    const canonical = window.TaejangIssue146?.openHomepageSlots;
    if (typeof canonical === 'function') return canonical();
    const fallback = window.TaejangPromotionWorkspaceV2Api?.openHomepageManagement;
    if (typeof fallback === 'function') return fallback();
    document.dispatchEvent(new CustomEvent('taejang-open-homepage-content'));
  }
  function openHomepageDirect() {
    closeSidebar();
    const api = window.TaejangOperationsHomepageDirect?.open;
    if (typeof api === 'function') return api();
    window.TaejangFeatureHealth?.showFailure?.('홈페이지 직접 수정 기능');
  }
  function openAttendance() {
    closeSidebar();
    const api = window.TaejangAttendanceAdmin?.openAttendance;
    if (typeof api === 'function') return api();
    window.TaejangFeatureHealth?.showFailure?.('출근부 기능');
  }
  function openAttendanceCorrection() {
    closeSidebar();
    const api = window.TaejangAttendanceIntegrity?.openCorrectionScreen;
    if (typeof api === 'function') return api();
    window.TaejangFeatureHealth?.showFailure?.('근태 보정 기능');
  }
  function openSupport(view) {
    closeSidebar();
    if (view === 'mywork') {
      if (featureUnavailable('support-radar-my-work', '내 지원사업 기능')) return;
      const openMyWork = window.TaejangSupportRadarMyWork?.renderList;
      if (typeof openMyWork === 'function') return openMyWork();
      return window.TaejangFeatureHealth?.showFailure?.('내 지원사업 기능');
    }
    if (featureUnavailable('support-radar', '지원사업 기능')) return;
    const open = window.TaejangSupportRadar?.open;
    if (typeof open === 'function') return open(view === 'profile' ? 'profile' : 'dashboard');
    window.TaejangFeatureHealth?.showFailure?.('지원사업 기능');
  }
  function button(label, action) { const node = text('button', label, 'button button-quiet'); node.type = 'button'; node.addEventListener('click', action); return node; }
  function closeSidebar() { const shell = el('desktop-app-shell'); if (!shell) return; shell.classList.remove('sidebar-open'); el('sidebar-toggle')?.setAttribute('aria-expanded', 'false'); }
  function card(title, body, { value, action, state } = {}) {
    const node = document.createElement('article'); node.className = 'dashboard-card';
    node.dataset.dashboardCardKey = DASHBOARD_CARD_KEYS[title] || `dashboard.${title}`;
    if (state) node.dataset.state = state;
    node.append(text('span', state === 'error' || state === 'forbidden' ? '확인 필요' : '현재 정보', 'status-label'), text('h3', title));
    if (value) node.append(text('p', value, 'dashboard-value'));
    node.append(text('p', body)); if (action) node.append(button(action.label, action.run)); return node;
  }
  function classifyFailure(error) {
    const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
    const code = String(error?.code || '').toLowerCase();
    if (status === 401 || status === 403 || code === '42501' || code.includes('forbidden') || code.includes('permission')) return 'forbidden';
    return 'error';
  }
  function settledState(result) {
    return result.status === 'fulfilled'
      ? { status: 'success', value: array(result.value), error: null }
      : { status: classifyFailure(result.reason), value: [], error: result.reason };
  }
  function failedState(error) {
    return { status: classifyFailure(error), value: [], error };
  }
  function successState(value) {
    return { status: 'success', value, error: null };
  }
  function failureCopy(kind, subject) {
    return kind === 'forbidden'
      ? `${subject}을 볼 권한을 확인할 수 없습니다. 다시 로그인하거나 관리자에게 문의해 주세요.`
      : `${subject}을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.`;
  }
  function setDashboardTopbar(route) {
    const title = el('desktop-page-title');
    if (title) title.textContent = topbarCopy[route] || '업무';
    const label = el('desktop-role-label');
    if (label) { label.textContent = ''; label.hidden = true; }
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
    const route = window.TaejangApp?.getRoute?.();
    if (route) setDashboardTopbar(route);
    const intro = document.createElement('header'); intro.className = 'dashboard-intro';
    intro.append(text('p', '홍보팀 · 점검중', 'eyebrow'), text('h2', '신규 사업 기획'), text('p', '신규 사업 기획 기능은 아직 연결 전입니다. 현재는 다른 실제 업무 메뉴를 이용해 주세요.'));
    intro.append(button('대시보드로', goDashboard));
    main.replaceChildren(intro);
  }
  function markMenuNode(node, item) {
    const registryItem = item.key
      ? window.TaejangPlatformNavigationRegistry?.byKey?.(item.key)
      : window.TaejangPlatformNavigationRegistry?.itemForLabel?.(item.label);
    const menuKey = item.key || registryItem?.key;
    if (menuKey) node.dataset.menuKey = menuKey;
    node.dataset.masterMenuItem = '1';
    const capabilities = Array.isArray(item.capabilities) && item.capabilities.length
      ? item.capabilities
      : (registryItem?.capabilities || []);
    if (capabilities.length) {
      node.dataset.capabilityAny = capabilities.join('|');
    }
    if (item.dataKey === 'employee-management') node.dataset.employeeManagementNav = '1';
    if (item.dataKey === 'employee-new') node.dataset.employeeNewNav = '1';
    if (item.dataKey === 'account-approval') node.dataset.phaseCAccountApprovalNav = '1';
    if (item.dataKey === 'payroll-mvp') node.dataset.payrollMvpNav = '1';
    if (item.dataKey === 'payroll-handoff-review' || item.dataKey === 'payroll-handoff-submit') node.dataset.payrollHandoffNav = '1';
    if (item.dataKey === 'promotion-write') {
      node.dataset.promotionWriteNav = '1';
      node.dataset.phaseCV2Nav = 'write';
    }
    if (item.dataKey === 'promotion-returned') {
      node.dataset.promotionReturnedNav = '1';
      node.dataset.phaseCV2Nav = 'revision';
    }
  }
  function makeOfficialChannelLinks() {
    const channels = window.TaejangOfficialChannels?.list || [];
    return channels.map(channel => {
      const link = document.createElement('a');
      link.href = channel.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = channel.label;
      link.className = 'app-nav-item app-nav-official-channel';
      link.dataset.officialChannelLink = channel.id;
      link.dataset.channel = channel.id;
      link.dataset.menuKey = `public.${channel.id}`;
      link.setAttribute('aria-label', `${channel.label} 새 탭에서 열기`);
      return link;
    });
  }

  function masterMenuItems() {
    return [
      { label: '대시보드', run: goDashboard, current: true },
      {
        label: '직원 관리',
        run: () => openEmployee('existing'),
        dataKey: 'employee-management',
        capabilities: ['employee.view_all', 'employee.view_scoped']
      },
      {
        label: '신규 직원 등록',
        run: () => openEmployee('new'),
        dataKey: 'employee-new',
        capabilities: ['employee.create', 'employee.request_change']
      },
      {
        label: '가입 승인',
        run: openSignupApproval,
        dataKey: 'account-approval',
        capabilities: ['employee.onboard', 'account.approve', 'account.reject']
      },
      {
        key: 'promotion.write',
        label: '홍보 글 작성',
        run: openPromotionWrite,
        dataKey: 'promotion-write',
        capabilities: ['promotion.write','promotion.edit_any_unpublished']
      },
      {
        key: 'promotion.revision',
        label: '보완 요청받은 글',
        run: () => openPromotion('revision'),
        dataKey: 'promotion-returned',
        capabilities: ['promotion.edit_own','promotion.edit_any_unpublished']
      },
      {
        key: 'promotion.sent',
        label: '보낸 글',
        run: openSentPromotion,
        capabilities: ['promotion.write']
      },
      {
        key: 'promotion.review',
        label: '홍보 검토',
        run: () => openPromotion('review'),
        capabilities: ['promotion.review_lead', 'promotion.review_operations', 'promotion.review_ceo']
      },
      {
        key: 'promotion.publication',
        label: '발행 대기',
        run: () => openPromotion('review'),
        capabilities: ['promotion.queue_publication']
      },
      {
        key: 'promotion.existing',
        label: '기존 글 관리',
        run: openExistingPromotion,
        capabilities: ['promotion.manage_recent_public','promotion.archive','promotion.restore']
      },
      {
        key: 'homepage.content',
        label: '홈페이지 내용 관리',
        run: openHomepageManagement,
        capabilities: ['homepage.draft','homepage.review','homepage.approve_apply']
      },
      {
        key: 'homepage.direct',
        label: '홈페이지 직접 수정',
        run: openHomepageDirect,
        capabilities: ['homepage.direct_edit']
      },
      {
        label: '업무 배정',
        run: () => openPanel('today-admin-panel'),
        capabilities: ['task.manage']
      },
      {
        key: 'notice.create',
        label: '공지 등록',
        run: () => openPanel('notice-admin-panel', 'create'),
        capabilities: ['notice.manage']
      },
      {
        key: 'notice.manage',
        label: '공지 관리',
        run: () => openPanel('notice-admin-panel', 'manage'),
        capabilities: ['notice.manage']
      },
      {
        key: 'attendance.view',
        label: '출근부',
        run: openAttendance,
        capabilities: ['attendance.admin_view']
      },
      {
        key: 'attendance.correct',
        label: '근태 보정',
        run: openAttendanceCorrection,
        capabilities: ['attendance.correct']
      },
      {
        label: '근태·급여관리',
        href: 'payroll/live.html',
        dataKey: 'payroll-mvp',
        capabilities: ['payroll.manage'],
        newTab: true
      },
      {
        label: '외부 급여초안 상신',
        href: 'payroll/handoff.html',
        dataKey: 'payroll-handoff-submit',
        capabilities: ['payroll.handoff.review'],
        newTab: true
      },
      {
        label: '외부 급여초안 검토',
        href: 'payroll/handoff.html',
        dataKey: 'payroll-handoff-review',
        capabilities: ['payroll.handoff.approve'],
        newTab: true
      },
      {
        key: 'support.profile',
        label: '기업 프로필',
        run: () => openSupport('profile'),
        capabilities: ['support_radar.management_view', 'support_radar.management_edit']
      },
      {
        key: 'support.radar',
        label: '지원사업 레이더',
        run: () => openSupport('radar'),
        capabilities: ['support_radar.management_view']
      },
      {
        key: 'support.mywork',
        label: '내 지원사업',
        run: () => openSupport('mywork'),
        capabilities: ['support_radar.assigned_work']
      },
    ];
  }

  function menu(_route) {
    const nav = el('app-nav');
    nav.replaceChildren();

    masterMenuItems().forEach(item => {
      const node = item.href ? document.createElement('a') : document.createElement('button');
      if (item.href) {
        node.href = item.href;
        node.textContent = item.label;
        if (item.newTab) {
          node.target = '_blank';
          node.rel = 'noopener noreferrer';
        }
      } else {
        node.type = 'button';
        node.textContent = item.label;
        node.addEventListener('click', () => {
          closeSidebar();
          item.run();
        });
      }
      markMenuNode(node, item);
      if (item.current) node.setAttribute('aria-current', 'page');
      nav.append(node);
    });

    nav.append(...makeOfficialChannelLinks());
  }

  async function dashboardData(route) {
    const app = window.TaejangApp;
    let pending = successState([]);
    let promotion = successState(null);
    if (route === 'super_admin') {
      try { pending = successState(array(await app.rpc('list_pending_profiles'))); }
      catch (error) { pending = failedState(error); }
    }
    if (promotionWorkspaceRoles.has(route)) {
      try { promotion = successState(await app.rpc('get_my_promotion_workspace')); }
      catch (error) { promotion = failedState(error); }
    }
    return { pending, promotion };
  }
  async function render() {
    const route = window.TaejangApp?.getRoute?.(); if (!route || route === worker) return;
    const main = el('dashboard-main'); main.replaceChildren(text('p', '현재 정보를 불러오고 있습니다.', 'message'));
    const { pending, promotion } = await dashboardData(route);
    const [heading, copy] = routeCopy[route] || ['대시보드', '현재 사용할 수 있는 업무 정보를 확인하세요.'];
    setDashboardTopbar(route);
    main.replaceChildren();
    const intro = document.createElement('header'); intro.className = 'dashboard-intro';
    intro.append(text('p', new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full', timeZone: 'Asia/Seoul' }).format(new Date()), 'eyebrow'), text('h2', heading), text('p', copy));
    main.append(intro);
    const grid = document.createElement('section'); grid.className = 'dashboard-grid'; grid.setAttribute('aria-label', '현재 업무 요약');

    if (route === 'promotion_lead') {
      if (promotion.status === 'success') {
        const reviewCount = array(promotion.value?.review_items).length;
        grid.append(card('홍보 검토 대기', reviewCount ? '직원이 올린 검토 안건이 있습니다. 운영팀장의 우선 업무입니다.' : '현재 검토 대기 안건이 없습니다.', {
          value: reviewCount ? `${reviewCount}건` : undefined,
          action: { label: '홍보 검토 열기', run: () => openPromotion('review') }
        }));
      } else {
        grid.append(card('홍보 검토 대기', failureCopy(promotion.status, '홍보 검토 정보'), { state: promotion.status, action: { label: '다시 불러오기', run: goDashboard } }));
      }
      grid.append(card('홍보자료 작성', '필요하면 운영팀장도 직접 홍보자료를 작성할 수 있습니다.', { action: { label: '홍보 작성 열기', run: () => openPromotion('write') } }));
    }
    if (route === 'promotion_staff') {
      if (promotion.status === 'success') {
        const mine = array(promotion.value?.my_items);
        const revisionCount = mine.filter(item => item.lifecycle === 'needs_revision').length;
        grid.append(card(
          '보완 요청받은 글',
          revisionCount ? '운영팀장 검토에서 돌아온 글이 있습니다. 내용을 확인하고 수정한 뒤 다시 승인 요청하세요.' : '현재 보완 요청받은 글이 없습니다.',
          {
            value: revisionCount ? `${revisionCount}건` : undefined,
            action: { label: '보완 글 확인', run: () => openPromotion('revision') }
          }
        ));
      } else {
        grid.append(card('보완 요청받은 글', failureCopy(promotion.status, '보완 요청받은 글 정보'), { state: promotion.status, action: { label: '다시 불러오기', run: goDashboard } }));
      }
      grid.append(card('홍보자료 작성', '태장 소식을 작성해 운영팀장에게 승인 요청합니다.', { action: { label: '새 태장 소식 작성', run: () => openPromotion('write') } }));
    }
    if (route === 'operations_manager') grid.append(card('중요 홍보 승인', '중요 콘텐츠와 대표이사 상신이 필요한 안건을 우선 확인합니다.', { action: { label: '홍보 검토 열기', run: () => openPromotion('review') } }));
    if (route === 'ceo') grid.append(card('홍보 상신 검토', '운영총괄이 실제로 상신한 중요 콘텐츠를 확인합니다.', { action: { label: '홍보 검토 열기', run: () => openPromotion('review') } }));
    if (route === 'super_admin') {
      if (pending.status === 'success') {
        grid.append(card('계정 승인 확인', pending.value.length ? '보호된 계정 승인 화면에서 확인하세요.' : '현재 승인 대기 항목이 없습니다.', { value: pending.value.length ? `${pending.value.length}건` : undefined, action: { label: '계정 승인 열기', run: () => { window.location.href = '../staff/?admin=1'; } } }));
      } else {
        grid.append(card('계정 승인 확인', failureCopy(pending.status, '승인 대기 정보'), { state: pending.status, action: { label: '다시 불러오기', run: goDashboard } }));
      }
    }

    main.append(grid);
  }
  function ensureHomepageAction() {
    const actions = document.querySelector('.app-user-actions');
    if (!actions || actions.querySelector('[data-homepage-action]')) return;
    const link = document.createElement('a');
    link.href = '../index.html'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'button button-quiet'; link.textContent = '홈페이지'; link.dataset.homepageAction = '1';
    actions.insertBefore(link, el('desktop-logout-button'));
  }

  function ensureSettingsAction() {
    const actions = document.querySelector('.app-user-actions');
    if (!actions) return;
    const current = actions.querySelector('[data-platform-settings-action]');
    const app = window.TaejangApp;
    const allowed = app?.hasCapabilityContract?.()
      ? app.can?.('platform.navigation.manage') === true
      : app?.getRoute?.() === 'operations_manager';
    if (!allowed) {
      current?.remove();
      return;
    }
    if (current) return;
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'button button-quiet';
    node.textContent = '설정';
    node.dataset.platformSettingsAction = '1';
    node.addEventListener('click', () => {
      closeSidebar();
      document.dispatchEvent(new CustomEvent('taejang-open-platform-settings'));
    });
    actions.insertBefore(node, actions.querySelector('[data-homepage-action]') || el('desktop-logout-button'));
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
    setDashboardTopbar(route);
    el('desktop-user-label').textContent = `${window.TaejangApp.getContext().display_name || '사용자'} · ${event.detail.label}`;
    menu(route);
    bindBrandToDashboard(); ensureHomepageAction(); ensureSettingsAction();
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
  window.TaejangDashboard = { render, dashboardData, classifyFailure };
})();
