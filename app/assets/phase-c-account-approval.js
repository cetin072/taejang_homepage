(() => {
  'use strict';

  const ALLOWED_ROUTES = new Set(['promotion_lead', 'operations_manager']);
  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');

  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  const button = (label, handler, quiet = false) => {
    const node = el('button', label, `button${quiet ? ' button-quiet' : ''}`);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  };

  function closeSidebar() {
    const shell = document.getElementById('desktop-app-shell');
    shell?.classList.remove('sidebar-open');
    document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  }

  function optionSelect(items, placeholder) {
    const select = document.createElement('select');
    select.required = true;
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = placeholder;
    select.append(empty);
    (Array.isArray(items) ? items : []).forEach(item => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      select.append(option);
    });
    return select;
  }

  function field(label, control) {
    const wrap = document.createElement('label');
    wrap.append(el('span', label), control);
    return wrap;
  }

  async function approve(profile, department, position, reason, card) {
    if (!department.value || !position.value) {
      window.alert('부서와 직책을 선택해 주세요.');
      return;
    }
    const approveButton = card.querySelector('[data-approve-signup]');
    if (approveButton) approveButton.disabled = true;
    try {
      const result = await app().rpc('approve_signup_request', {
        p_target_profile_id: profile.id,
        p_department_id: department.value,
        p_position_id: position.value,
        p_reason_summary: reason.value.trim() || '신원과 소속 확인 후 가입 승인'
      });
      if (!result?.ok) throw new Error(result?.code || 'APPROVAL_FAILED');
      await openAccountApproval();
    } catch (error) {
      window.alert(app().friendlyError?.(error) || '가입 승인을 처리하지 못했습니다.');
      if (approveButton) approveButton.disabled = false;
    }
  }

  function requestCard(profile, options) {
    const card = el('article', null, 'dashboard-card');
    card.dataset.signupApprovalCard = profile.id;
    card.append(el('span', profile.requested_role_name || '가입 신청', 'status-label'));
    card.append(el('h3', profile.display_name || '이름 없음'));
    card.append(el('p', profile.work_email || '이메일 없음'));
    card.append(el('p', `신청 구분: ${profile.requested_role_name || '확인 필요'}`));

    const form = el('div', null, 'phase-c-signup-approval-form');
    const department = optionSelect(options?.departments, '부서 선택');
    const position = optionSelect(options?.positions, '직책 선택');
    const reason = document.createElement('input');
    reason.type = 'text';
    reason.maxLength = 300;
    reason.value = '신원과 소속 확인 후 가입 승인';
    form.append(field('부서', department), field('직책', position), field('처리 사유', reason));

    const actions = el('div', null, 'quick-links');
    const approveButton = button('가입 승인', () => approve(profile, department, position, reason, card));
    approveButton.dataset.approveSignup = '1';
    actions.append(approveButton);
    card.append(form, actions);
    return card;
  }

  function injectStyles() {
    if (document.querySelector('style[data-phase-c-account-approval]')) return;
    const style = document.createElement('style');
    style.dataset.phaseCAccountApproval = '1';
    style.textContent = `
      .phase-c-signup-approval-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
      .phase-c-signup-approval-form { display:grid; gap:10px; margin-top:12px; }
      .phase-c-signup-approval-form label { display:grid; gap:6px; font-weight:800; }
      .phase-c-signup-approval-form select,.phase-c-signup-approval-form input { width:100%; min-height:44px; padding:9px 10px; border:1px solid var(--app-border); border-radius:9px; background:#fff; font:inherit; }
      @media(max-width:760px){.phase-c-signup-approval-grid{grid-template-columns:1fr;}}
    `;
    document.head.append(style);
  }

  async function openAccountApproval() {
    closeSidebar();
    const target = main();
    const currentRoute = route();
    if (!target || !ALLOWED_ROUTES.has(currentRoute)) return;
    document.getElementById('desktop-page-title').textContent = '가입 승인';
    target.replaceChildren(el('p', '가입 신청을 불러오고 있습니다.', 'message'));
    try {
      const [requests, options] = await Promise.all([
        app().rpc('list_pending_signup_requests'),
        app().rpc('get_signup_approval_options')
      ]);
      const intro = el('header', null, 'dashboard-intro');
      const description = currentRoute === 'promotion_lead'
        ? '운영팀장은 홍보직원 가입 신청만 승인할 수 있습니다.'
        : '운영총괄은 운영팀장과 홍보직원 가입 신청을 승인할 수 있습니다.';
      intro.append(el('p', '계정 관리', 'eyebrow'), el('h2', '가입 승인'), el('p', description));
      const grid = el('section', null, 'phase-c-signup-approval-grid');
      const rows = Array.isArray(requests) ? requests : [];
      if (!rows.length) grid.append(el('p', '현재 승인할 가입 신청이 없습니다.', 'empty'));
      rows.forEach(profile => grid.append(requestCard(profile, options || {})));
      target.replaceChildren(intro, grid);
    } catch (error) {
      target.replaceChildren(el('p', app().friendlyError?.(error) || '가입 신청을 불러오지 못했습니다.', 'message error'));
    }
  }

  function syncNavigation() {
    const currentRoute = route();
    const nav = document.getElementById('app-nav');
    if (!nav || !ALLOWED_ROUTES.has(currentRoute)) return;
    if (nav.querySelector('[data-phase-c-account-approval-nav]')) return;
    const node = button('가입 승인', openAccountApproval, true);
    node.dataset.phaseCAccountApprovalNav = '1';
    const homepage = [...nav.children].find(child => child.textContent?.trim() === '홈페이지');
    if (homepage) nav.insertBefore(node, homepage);
    else nav.append(node);
  }

  function syncDashboard() {
    const target = main();
    const currentRoute = route();
    if (!target || !ALLOWED_ROUTES.has(currentRoute)) return;
    const heading = target.querySelector('.dashboard-intro h2')?.textContent || '';
    if (!heading.includes('대시보드') || target.querySelector('[data-phase-c-account-approval-card]')) return;
    const grid = target.querySelector('.dashboard-grid');
    if (!grid) return;
    const card = el('article', null, 'dashboard-card');
    card.dataset.phaseCAccountApprovalCard = '1';
    card.append(el('span', '계정 관리', 'status-label'), el('h3', '가입 승인'));
    card.append(el('p', currentRoute === 'promotion_lead' ? '홍보직원의 가입 신청을 확인합니다.' : '운영팀장과 홍보직원의 가입 신청을 확인합니다.'));
    card.append(button('가입 승인 열기', openAccountApproval, true));
    grid.prepend(card);
  }

  function sync() {
    syncNavigation();
    syncDashboard();
  }

  injectStyles();
  document.addEventListener('taejang-open-account-approval', openAccountApproval);
  document.addEventListener('taejang-app-ready', () => setTimeout(sync, 80));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(sync, 120));

  const start = () => {
    const shell = document.getElementById('desktop-app-shell');
    if (!shell) return;
    new MutationObserver(() => setTimeout(sync, 20)).observe(shell, { childList: true, subtree: true });
    sync();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.TaejangAccountApproval = { openAccountApproval };
})();
