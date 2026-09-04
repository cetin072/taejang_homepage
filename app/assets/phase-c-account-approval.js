(() => {
  'use strict';

  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');
  let dashboardSyncing = false;

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
    document.getElementById('desktop-app-shell')?.classList.remove('sidebar-open');
    document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  }

  function roleSelect(items) {
    const select = document.createElement('select');
    select.required = true;
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = '권한 선택'; select.append(empty);
    (Array.isArray(items) ? items : []).forEach(item => {
      const option = document.createElement('option'); option.value = item.code; option.textContent = item.name; select.append(option);
    });
    return select;
  }

  function employeeSelect(items) {
    const select = document.createElement('select');
    select.required = true;
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = '연결할 직원 선택'; select.append(empty);
    (Array.isArray(items) ? items : []).forEach(item => {
      const option = document.createElement('option');
      option.value = item.employee_uuid;
      option.textContent = `${item.employee_id} · ${item.full_name} · ${item.department_name} · ${item.position_name}`;
      option.dataset.department = item.department_name;
      option.dataset.position = item.position_name;
      select.append(option);
    });
    return select;
  }

  function field(label, control) {
    const wrap = document.createElement('label');
    wrap.append(el('span', label), control);
    return wrap;
  }

  function setCardBusy(card, busy) {
    card.querySelectorAll('button').forEach(node => { node.disabled = busy; });
  }

  async function approve(profile, employee, role, reason, card) {
    if (!employee.value || !role.value) {
      window.alert('실제 직원과 권한을 모두 선택해 주세요.');
      return;
    }
    setCardBusy(card, true);
    try {
      const result = await app().rpc('approve_signup_request_with_employee', {
        p_target_profile_id: profile.id,
        p_employee_uuid: employee.value,
        p_role_code: role.value,
        p_reason_summary: reason.value.trim() || '실제 직원 확인 후 계정 연결 및 가입 승인'
      });
      if (!result?.ok) throw new Error(result?.code || 'APPROVAL_FAILED');
      await openAccountApproval();
    } catch (error) {
      window.alert(app().friendlyError?.(error) || error.message || '가입 승인을 처리하지 못했습니다.');
      setCardBusy(card, false);
    }
  }

  async function reject(profile, rejectReason, card) {
    const reason = rejectReason.value.trim();
    if (!reason) {
      window.alert('가입 거절 사유를 입력해 주세요.');
      rejectReason.focus();
      return;
    }
    const name = profile.display_name || '이 신청';
    if (!window.confirm(`${name}의 가입 신청을 거절할까요?\n거절된 계정은 업무플랫폼을 사용할 수 없습니다.`)) return;

    setCardBusy(card, true);
    try {
      const result = await app().rpc('record_pending_decision', {
        p_target_profile_id: profile.id,
        p_decision: 'rejected',
        p_reason_summary: reason
      });
      if (!result?.ok) throw new Error(result?.code || 'REJECTION_FAILED');
      await openAccountApproval();
    } catch (error) {
      window.alert(app().friendlyError?.(error) || error.message || '가입 거절을 처리하지 못했습니다.');
      setCardBusy(card, false);
    }
  }

  function requestCard(profile, options, employees) {
    const card = el('article', null, 'dashboard-card');
    card.dataset.signupApprovalCard = profile.id;
    card.append(el('span', '임직원 계정 신청', 'status-label'));
    card.append(el('h3', profile.display_name || '이름 없음'));
    card.append(el('p', profile.work_email || '이메일 없음'));

    const form = el('div', null, 'phase-c-signup-approval-form');
    const employee = employeeSelect(employees);
    const role = roleSelect(options?.roles);
    const linkedSummary = el('p', '직원을 선택하면 등록된 부서·직책으로 계정이 승인됩니다.', 'help');
    employee.addEventListener('change', () => {
      const selected = employee.selectedOptions?.[0];
      linkedSummary.textContent = employee.value
        ? `연결 정보: ${selected?.dataset.department || '-'} · ${selected?.dataset.position || '-'}`
        : '직원을 선택하면 등록된 부서·직책으로 계정이 승인됩니다.';
    });

    const reason = document.createElement('input');
    reason.type = 'text'; reason.maxLength = 300; reason.value = '실제 직원 확인 후 계정 연결 및 가입 승인';

    const rejectReason = document.createElement('input');
    rejectReason.type = 'text'; rejectReason.maxLength = 300;
    rejectReason.placeholder = '예: 직원 아님, 중복 신청';

    form.append(
      field('실제 직원', employee),
      linkedSummary,
      field('업무 권한', role),
      field('승인 처리 사유', reason),
      field('거절 사유', rejectReason)
    );

    const actions = el('div', null, 'quick-links');
    const approveButton = button('직원 연결 후 가입 승인', () => approve(profile, employee, role, reason, card));
    approveButton.dataset.approveSignup = '1';
    const rejectButton = button('가입 거절', () => reject(profile, rejectReason, card));
    rejectButton.className = 'button button-danger';
    rejectButton.dataset.rejectSignup = '1';
    actions.append(approveButton, rejectButton);
    card.append(form, actions);
    return card;
  }

  function injectStyles() {
    if (document.querySelector('style[data-phase-c-account-approval]')) return;
    const style = document.createElement('style'); style.dataset.phaseCAccountApproval = '1';
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
    if (!target || route() !== 'operations_manager') return;
    document.getElementById('desktop-page-title').textContent = '가입 승인';
    target.replaceChildren(el('p', '가입 신청과 직원 마스터를 불러오고 있습니다.', 'message'));
    try {
      const [requests, options, employees] = await Promise.all([
        app().rpc('list_pending_signup_requests'),
        app().rpc('get_signup_approval_options'),
        app().rpc('get_signup_employee_options')
      ]);
      const intro = el('header', null, 'dashboard-intro');
      intro.append(
        el('p', '운영총괄 고유 권한', 'eyebrow'),
        el('h2', '임직원 계정 승인'),
        el('p', '실제 직원은 직원 마스터와 연결해 승인하고, 잘못된 신청이나 비직원 신청은 사유를 남겨 거절합니다. 이름이나 이메일로 자동매칭하지 않습니다.')
      );
      if (!Array.isArray(employees) || !employees.length) {
        intro.append(el('p', '연결 가능한 직원이 없습니다. 먼저 사이드바의 직원 관리에서 직원을 등록하거나 기존 직원을 확인하세요.', 'message'));
      }
      const grid = el('section', null, 'phase-c-signup-approval-grid');
      const rows = Array.isArray(requests) ? requests : [];
      if (!rows.length) grid.append(el('p', '현재 승인할 임직원 계정 신청이 없습니다.', 'empty'));
      rows.forEach(profile => grid.append(requestCard(profile, options || {}, employees || [])));
      target.replaceChildren(intro, grid);
    } catch (error) {
      target.replaceChildren(el('p', app().friendlyError?.(error) || '가입 신청을 불러오지 못했습니다.', 'message error'));
    }
  }

  function syncNavigation() {
    const nav = document.getElementById('app-nav');
    if (!nav || route() !== 'operations_manager') return;
    if (nav.querySelector('[data-phase-c-account-approval-nav]')) return;
    const node = button('가입 승인', openAccountApproval, true); node.dataset.phaseCAccountApprovalNav = '1';
    const homepage = [...nav.children].find(child => child.textContent?.trim() === '홈페이지');
    if (homepage) nav.insertBefore(node, homepage); else nav.append(node);
  }

  async function syncDashboard() {
    const target = main();
    if (!target || route() !== 'operations_manager' || dashboardSyncing) return;
    const heading = target.querySelector('.dashboard-intro h2')?.textContent || '';
    if (!heading.includes('대시보드') || target.querySelector('[data-phase-c-account-approval-card]')) return;
    const grid = target.querySelector('.dashboard-grid'); if (!grid) return;

    dashboardSyncing = true;
    try {
      const requests = await app().rpc('list_pending_signup_requests');
      const rows = Array.isArray(requests) ? requests : [];
      if (!rows.length || !grid.isConnected || route() !== 'operations_manager') return;
      const card = el('article', null, 'dashboard-card'); card.dataset.phaseCAccountApprovalCard = '1';
      card.append(el('span', '승인 필요', 'status-label'), el('h3', '가입 승인'));
      card.append(el('p', `${rows.length}건의 가입 신청을 확인해야 합니다.`, 'dashboard-value'));
      card.append(el('p', '직원 여부를 확인한 뒤 승인하거나 사유를 남겨 거절하세요.'));
      card.append(button('가입 승인 열기', openAccountApproval, true));
      grid.prepend(card);
    } catch { /* Dashboard remains usable if signup summary is unavailable. */ }
    finally { dashboardSyncing = false; }
  }

  function sync() { syncNavigation(); syncDashboard(); }

  injectStyles();
  document.addEventListener('taejang-open-account-approval', openAccountApproval);
  document.addEventListener('taejang-app-ready', () => setTimeout(sync, 80));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(sync, 120));

  const start = () => {
    const shell = document.getElementById('desktop-app-shell'); if (!shell) return;
    new MutationObserver(() => setTimeout(sync, 20)).observe(shell, { childList: true, subtree: true });
    sync();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();

  window.TaejangAccountApproval = { openAccountApproval };
})();
