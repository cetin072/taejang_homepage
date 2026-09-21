(() => {
  'use strict';

  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');
  const canOnboard = () => app()?.hasCapabilityContract?.()
    ? Boolean(app()?.can?.('employee.onboard'))
    : ['promotion_lead', 'operations_manager'].includes(route());
  let dashboardSyncing = false;

  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  const button = (label, handler, quiet = false) => {
    const node = el('button', label, 'button' + (quiet ? ' button-quiet' : ''));
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  };

  function closeSidebar() {
    document.getElementById('desktop-app-shell')?.classList.remove('sidebar-open');
    document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  }

  function selectControl(items, placeholder) {
    const select = document.createElement('select');
    select.required = true;
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = placeholder;
    select.append(empty);
    (Array.isArray(items) ? items : []).forEach(item => {
      const option = document.createElement('option');
      option.value = item.id || item.code;
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

  function setCardBusy(card, busy) {
    card.querySelectorAll('button,select,input').forEach(node => { node.disabled = busy; });
  }

  async function approve(profile, controls, card) {
    if (!controls.department.value || !controls.position.value || !controls.role.value) {
      window.alert('부서, 직책, 업무 권한을 모두 선택해 주세요.');
      return;
    }

    setCardBusy(card, true);
    try {
      const result = await app().rpc('approve_employee_signup_request', {
        p_target_profile_id: profile.id,
        p_department_id: controls.department.value,
        p_position_id: controls.position.value,
        p_role_code: controls.role.value,
        p_attendance_required: controls.attendance.checked,
        p_reason_summary: controls.reason.value.trim() || '신입 가입요청 확인 후 직원 생성 및 계정 승인'
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
    if (!window.confirm((profile.display_name || '이 신청') + '의 가입 요청을 거절할까요?')) return;

    setCardBusy(card, true);
    try {
      const result = await app().rpc('reject_employee_signup_request', {
        p_target_profile_id: profile.id,
        p_reason_summary: reason
      });
      if (!result?.ok) throw new Error(result?.code || 'REJECTION_FAILED');
      await openAccountApproval();
    } catch (error) {
      window.alert(app().friendlyError?.(error) || error.message || '가입 거절을 처리하지 못했습니다.');
      setCardBusy(card, false);
    }
  }

  function requestCard(profile, options) {
    const card = el('article', null, 'dashboard-card');
    card.dataset.signupApprovalCard = profile.id;
    card.append(el('span', '신입 가입 요청', 'status-label'));
    card.append(el('h3', profile.display_name || '이름 없음'));

    const applicant = el('dl', null, 'phase-c-signup-applicant');
    [
      ['이메일', profile.work_email || '-'],
      ['전화번호', profile.phone || '-'],
      ['입사일', profile.hired_on || '-']
    ].forEach(([label, value]) => {
      applicant.append(el('dt', label), el('dd', value));
    });

    const form = el('div', null, 'phase-c-signup-approval-form');
    const department = selectControl(options?.departments, '부서 선택');
    const position = selectControl(options?.positions, '직책 선택');
    const role = selectControl(options?.roles, '업무 권한 선택');

    const attendance = document.createElement('input');
    attendance.type = 'checkbox';
    attendance.checked = true;
    const attendanceField = el('label', null, 'phase-c-signup-check');
    attendanceField.append(attendance, el('span', '근태 기록 대상'));

    const reason = document.createElement('input');
    reason.type = 'text';
    reason.maxLength = 300;
    reason.value = '신입 가입요청 확인 후 직원 생성 및 계정 승인';

    const rejectReason = document.createElement('input');
    rejectReason.type = 'text';
    rejectReason.maxLength = 300;
    rejectReason.placeholder = '예: 입사 취소, 잘못된 신청';

    form.append(
      field('부서', department),
      field('직책', position),
      field('업무 권한', role),
      attendanceField,
      field('승인 처리 사유', reason),
      field('거절 사유', rejectReason)
    );

    const help = el(
      'p',
      '승인하면 직원번호를 자동 발급하고 Person·Employee를 생성한 뒤 이 가입 계정과 연결합니다. 이름이나 전화번호로 기존 직원을 자동 연결하지 않습니다.',
      'help'
    );

    const actions = el('div', null, 'quick-links');
    const controls = { department, position, role, attendance, reason };
    const approveButton = button('직원 생성 후 가입 승인', () => approve(profile, controls, card));
    approveButton.dataset.approveSignup = '1';
    const rejectButton = button('가입 거절', () => reject(profile, rejectReason, card));
    rejectButton.className = 'button button-danger';
    rejectButton.dataset.rejectSignup = '1';
    actions.append(approveButton, rejectButton);

    card.append(applicant, form, help, actions);
    return card;
  }

  function injectStyles() {
    if (document.querySelector('style[data-phase-c-account-approval]')) return;
    const style = document.createElement('style');
    style.dataset.phaseCAccountApproval = '1';
    style.textContent = [
      '.phase-c-signup-approval-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;}',
      '.phase-c-signup-applicant{display:grid;grid-template-columns:max-content 1fr;gap:5px 12px;margin:12px 0;padding:12px;border-radius:12px;background:#f7f8f4;}',
      '.phase-c-signup-applicant dt{font-weight:900;color:#52665b}.phase-c-signup-applicant dd{margin:0;word-break:break-all;}',
      '.phase-c-signup-approval-form{display:grid;gap:10px;margin-top:12px;}',
      '.phase-c-signup-approval-form label{display:grid;gap:6px;font-weight:800;}',
      '.phase-c-signup-approval-form select,.phase-c-signup-approval-form input[type="text"]{width:100%;min-height:44px;padding:9px 10px;border:1px solid var(--app-border);border-radius:9px;background:#fff;font:inherit;}',
      '.phase-c-signup-check{display:flex!important;grid-template-columns:none!important;flex-direction:row;align-items:center;gap:9px!important;min-height:42px;}',
      '.phase-c-signup-check input{width:20px;height:20px;}',
      '@media(max-width:760px){.phase-c-signup-approval-grid{grid-template-columns:1fr;}}'
    ].join('\n');
    document.head.append(style);
  }

  async function openAccountApproval() {
    closeSidebar();
    const target = main();
    if (!target || !canOnboard()) return;
    document.getElementById('desktop-page-title').textContent = '가입 승인';
    target.replaceChildren(el('p', '신입 가입 요청을 불러오고 있습니다.', 'message'));

    try {
      const [requests, options] = await Promise.all([
        app().rpc('list_employee_signup_requests'),
        app().rpc('get_employee_signup_approval_options')
      ]);

      const intro = el('header', null, 'dashboard-intro');
      intro.append(
        el('p', '신입 온보딩', 'eyebrow'),
        el('h2', '가입 요청 승인'),
        el('p', '신입은 이름·이메일·전화번호·입사일만 신청합니다. 담당자가 부서·직책·권한·근태대상을 확인하고 승인하면 직원 마스터와 계정 연결이 한 번에 생성됩니다.')
      );

      const grid = el('section', null, 'phase-c-signup-approval-grid');
      const rows = Array.isArray(requests) ? requests : [];
      if (!rows.length) grid.append(el('p', '현재 승인할 신입 가입 요청이 없습니다.', 'empty'));
      rows.forEach(profile => grid.append(requestCard(profile, options || {})));
      target.replaceChildren(intro, grid);
    } catch (error) {
      target.replaceChildren(el('p', app().friendlyError?.(error) || '가입 요청을 불러오지 못했습니다.', 'message error'));
    }
  }

  async function syncDashboard() {
    const target = main();
    if (!target || !canOnboard() || dashboardSyncing) return;
    const heading = target.querySelector('.dashboard-intro h2')?.textContent || '';
    if (!heading.includes('대시보드') || target.querySelector('[data-phase-c-account-approval-card]')) return;
    const grid = target.querySelector('.dashboard-grid');
    if (!grid) return;

    dashboardSyncing = true;
    try {
      const requests = await app().rpc('list_employee_signup_requests');
      const rows = Array.isArray(requests) ? requests : [];
      if (!rows.length || !grid.isConnected || !canOnboard()) return;
      const card = el('article', null, 'dashboard-card');
      card.dataset.phaseCAccountApprovalCard = '1';
      card.dataset.dashboardCardKey = 'account.signup-requests';
      card.append(el('span', '승인 필요', 'status-label'), el('h3', '신입 가입 승인'));
      card.append(el('p', rows.length + '건의 가입 요청을 확인해야 합니다.', 'dashboard-value'));
      card.append(el('p', '부서·직책·권한을 확인하면 직원 생성과 계정 연결까지 한 번에 처리됩니다.'));
      card.append(button('가입 승인 열기', openAccountApproval, true));
      grid.prepend(card);
    } catch {
      // Dashboard remains usable if signup summary is unavailable.
    } finally {
      dashboardSyncing = false;
    }
  }

  injectStyles();
  document.addEventListener('taejang-open-account-approval', openAccountApproval);
  document.addEventListener('taejang-app-ready', () => setTimeout(syncDashboard, 120));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(syncDashboard, 160));
  document.addEventListener('taejang-capabilities-ready', () => setTimeout(syncDashboard, 0));

  window.TaejangAccountApproval = { openAccountApproval, syncDashboard };
})();