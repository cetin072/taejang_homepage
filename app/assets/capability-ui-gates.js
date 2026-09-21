(() => {
  'use strict';

  const PANEL_CAPABILITIES = Object.freeze({
    'today-admin-panel': 'task.manage',
    'schedule-admin-panel': 'schedule.manage',
    'notice-admin-panel': 'notice.manage',
    'guidance-admin-panel': 'guidance.manage'
  });

  const NAV_CAPABILITIES = Object.freeze({
    '업무 배정': 'task.manage',
    '일정 관리': 'schedule.manage',
    '공지 관리': 'notice.manage',
    '상시 안내 관리': 'guidance.manage',
    '복구·계정 관리': 'account.view_management'
  });

  const NAV_CAPABILITY_ANY = Object.freeze({
    '홍보 검토': ['promotion.review_lead', 'promotion.review_operations', 'promotion.review_ceo'],
    '홍보 글 작성': ['promotion.write', 'promotion.edit_any_unpublished'],
    '보완 요청받은 글': ['promotion.edit_own', 'promotion.edit_any_unpublished'],
    '기존 글 관리': ['promotion.manage_recent_public', 'promotion.archive', 'promotion.restore'],
    '홍보글 관리·복구': ['promotion.archive', 'promotion.restore', 'promotion.hide', 'promotion.republish'],
    '발행 대기': ['promotion.queue_publication'],
    '홈페이지 내용 관리': ['homepage.draft', 'homepage.review', 'homepage.approve_apply'],
    '홈페이지 직접 수정': ['homepage.direct_edit'],
    '근태·급여관리': ['payroll.manage'],
    '외부 급여초안 검토': ['payroll.handoff.approve'],
    '외부 급여초안 상신': ['payroll.handoff.review'],
    '출근부': ['attendance.admin_view'],
    '근태 보정': ['attendance.correct'],
    '지원사업 레이더': ['support_radar.management_view', 'support_radar.assigned_work'],
    '기업 프로필': ['support_radar.management_view', 'support_radar.management_edit']
  });

  const EMPLOYEE_ENTRY_CAPABILITIES = Object.freeze([
    'employee.view_all',
    'employee.view_scoped',
    'employee.create'
  ]);
  const EMPLOYEE_NAV_LABELS = new Set([
    '직원 관리',
    '팀 직원 관리',
    '신규 직원 등록',
    '신규 직원 등록 요청'
  ]);
  const ACCOUNT_APPROVAL_CAPABILITIES = Object.freeze([
    'employee.onboard',
    'account.approve',
    'account.reject'
  ]);

  const cleanLabel = node => (node?.textContent || '').replace(/\s*·\s*점검중\s*$/, '').trim();
  const hasContract = () => Boolean(window.TaejangApp?.hasCapabilityContract?.());
  const can = capability => Boolean(window.TaejangApp?.can?.(capability));
  const canAny = capabilities => capabilities.some(can);

  function showDenied(label) {
    const health = window.TaejangFeatureHealth;
    if (health?.showFailure) {
      health.showFailure(`${label} 권한`);
      return;
    }
    const notice = document.getElementById('app-status-message');
    if (!notice) return;
    notice.textContent = `${label}을 사용할 권한이 없습니다.`;
    notice.classList.add('error');
    notice.hidden = false;
  }

  function applyNavigationState(node, allowed, capabilityLabel) {
    node.hidden = !allowed;
    node.setAttribute('aria-hidden', String(!allowed));
    node.toggleAttribute('disabled', !allowed && node.tagName === 'BUTTON');
    if (!allowed) node.dataset.capabilityDenied = capabilityLabel;
    else delete node.dataset.capabilityDenied;
  }

  function pruneNavigation() {
    if (!hasContract()) return;
    const nav = document.getElementById('app-nav');
    if (!nav) return;

    [...nav.querySelectorAll('button, a')].forEach(node => {
      const label = cleanLabel(node);
      const declaredAny = String(node.dataset?.capabilityAny || '')
        .split('|')
        .map(value => value.trim())
        .filter(Boolean);
      if (declaredAny.length) {
        applyNavigationState(node, canAny(declaredAny), declaredAny.join('|'));
        return;
      }
      const anyCapabilities = NAV_CAPABILITY_ANY[label];
      if (anyCapabilities) {
        applyNavigationState(node, canAny(anyCapabilities), anyCapabilities.join('|'));
        return;
      }
      const capability = NAV_CAPABILITIES[label];
      if (capability) {
        applyNavigationState(node, can(capability), capability);
        return;
      }
      if (EMPLOYEE_NAV_LABELS.has(label)) {
        applyNavigationState(node, canAny(EMPLOYEE_ENTRY_CAPABILITIES), EMPLOYEE_ENTRY_CAPABILITIES.join('|'));
        return;
      }
      if (label === '가입 승인') {
        applyNavigationState(node, canAny(ACCOUNT_APPROVAL_CAPABILITIES), ACCOUNT_APPROVAL_CAPABILITIES.join('|'));
      }
    });
  }

  function bindNavigationObserver() {
    const nav = document.getElementById('app-nav');
    if (!nav || nav.dataset.capabilityObserverBound === '1') return;
    nav.dataset.capabilityObserverBound = '1';
    new MutationObserver(() => queueMicrotask(pruneNavigation)).observe(nav, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  document.addEventListener('taejang-open-app-panel', event => {
    if (!hasContract()) return;
    const panelId = event.detail?.id;
    const capability = PANEL_CAPABILITIES[panelId];
    if (!capability || can(capability)) return;
    event.stopImmediatePropagation();
    event.preventDefault?.();
    const labels = {
      'today-admin-panel': '업무 배정',
      'schedule-admin-panel': '일정 관리',
      'notice-admin-panel': '공지 관리',
      'guidance-admin-panel': '상시 안내 관리'
    };
    showDenied(labels[panelId] || '관리 기능');
  }, true);

  document.addEventListener('taejang-open-employee-management', event => {
    if (!hasContract() || canAny(EMPLOYEE_ENTRY_CAPABILITIES)) return;
    event.stopImmediatePropagation();
    event.preventDefault?.();
    showDenied('직원 관리');
  }, true);

  document.addEventListener('taejang-open-account-approval', event => {
    if (!hasContract() || canAny(ACCOUNT_APPROVAL_CAPABILITIES)) return;
    event.stopImmediatePropagation();
    event.preventDefault?.();
    showDenied('가입 승인');
  }, true);

  document.addEventListener('click', event => {
    if (!hasContract()) return;
    const target = event.target?.closest?.('button,a');
    if (!target) return;
    const label = cleanLabel(target);
    if (label !== '복구·계정 관리' || can('account.view_management')) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    showDenied('복구·계정 관리');
  }, true);

  function refreshUi() {
    bindNavigationObserver();
    pruneNavigation();
  }

  document.addEventListener('taejang-app-ready', () => queueMicrotask(refreshUi));
  document.addEventListener('taejang-capabilities-ready', () => queueMicrotask(refreshUi));

  window.TaejangCapabilityUiGates = {
    PANEL_CAPABILITIES,
    NAV_CAPABILITIES,
    EMPLOYEE_ENTRY_CAPABILITIES,
    ACCOUNT_APPROVAL_CAPABILITIES,
    refresh: refreshUi
  };
})();