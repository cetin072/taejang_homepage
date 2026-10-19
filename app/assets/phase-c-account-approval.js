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

  function selectControl(items, placeholder, valueKey = 'id') {
    const select = document.createElement('select');
    select.required = true;
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = placeholder;
    select.append(empty);
    (Array.isArray(items) ? items : []).forEach(item => {
      const option = document.createElement('option');
      // Department/position RPC inputs are UUIDs; role RPC input is its code.
      option.value = item[valueKey] || '';
      option.textContent = item.name;
      select.append(option);
    });
    return select;
  }

  function field(label, control) {
    control.setAttribute('aria-label', label);
    const wrap = document.createElement('label');
    wrap.append(el('span', label), control);
    return wrap;
  }

  function setCardBusy(card, busy) {
    card.querySelectorAll('button,select,input').forEach(node => { node.disabled = busy; });
  }

  async function approve(profile, controls, card) {
    const existing = controls.mode.value === 'existing';
    if (!controls.role.value) {
      window.alert('업무 권한을 선택해 주세요.');
      return;
    }

    let nameMismatch = false;
    let hireMismatch = false;
    let candidate = null;

    if (existing) {
      candidate = controls.employees.find(item => item.employee_uuid === controls.employee.value);
      if (!candidate) {
        window.alert('기존 직원번호를 선택해 주세요.');
        return;
      }
      if (!controls.confirmEmployeeId.value.trim()
          || controls.confirmEmployeeId.value.trim() !== candidate.employee_id) {
        window.alert('기존 직원번호를 정확히 입력해 확인해 주세요.');
        return;
      }
      if (!controls.identityConfirmed.checked) {
        window.alert('직원번호와 신청자의 인적사항을 직접 확인해 주세요.');
        return;
      }
      const normalized = value => String(value || '').replace(/\s+/g, '').toLocaleLowerCase('ko-KR');
      nameMismatch = normalized(profile.display_name) !== normalized(candidate.full_name);
      hireMismatch = String(profile.hired_on || '').slice(0, 10) !== String(candidate.hired_on || '').slice(0, 10);
      if ((nameMismatch || hireMismatch) && !controls.mismatchConfirmed.checked) {
        window.alert('이름 또는 입사일이 다릅니다. 직원 신원을 다시 확인하고 불일치 확인에 체크해 주세요.');
        return;
      }
    } else if (route() !== 'operations_manager') {
      window.alert('신규 직원 생성 승인은 운영총괄만 처리할 수 있습니다.');
      return;
    } else if (!controls.department.value || !controls.position.value) {
      window.alert('부서, 직책, 업무 권한을 모두 선택해 주세요.');
      return;
    }

    const confirmCopy = existing
      ? `가입 신청: ${profile.display_name || '이름 없음'} / ${profile.hired_on || '입사일 없음'}\n`
        + `기존 직원: ${candidate.employee_id} · ${candidate.full_name} / ${candidate.hired_on || '-'}\n`
        + `기존 직원번호·근태·급여 기록을 유지하고 앱 계정만 연결할까요?`
      : `정말 새로운 채용 직원이 맞나요?\n${profile.display_name || '이름 없음'}의 새 직원번호와 Employee 기록을 생성합니다.`;
    if (!window.confirm(confirmCopy)) return;

    setCardBusy(card, true);
    try {
      const result = existing
        ? await app().rpc('approve_existing_employee_signup_request', {
          p_target_profile_id: profile.id,
          p_employee_uuid: candidate.employee_uuid,
          p_role_code: controls.role.value,
          p_confirm_employee_id: controls.confirmEmployeeId.value.trim(),
          p_identity_mismatch_confirmed: controls.mismatchConfirmed.checked,
          p_reason_summary: controls.reason.value.trim() || '기존 직원번호 확인 후 앱 계정 연결'
        })
        : await app().rpc('approve_employee_signup_request', {
          p_target_profile_id: profile.id,
          p_department_id: controls.department.value,
          p_position_id: controls.position.value,
          p_role_code: controls.role.value,
          p_attendance_required: controls.attendance.checked,
          p_reason_summary: controls.reason.value.trim() || '신규 채용 확인 후 직원 생성 및 계정 승인'
        });
      if (!result?.ok) throw new Error(result?.code || 'APPROVAL_FAILED');
      await openAccountApproval();
    } catch (error) {
      const code = error?.message || error?.code;
      const reasonByCode = {
        INVALID_ROLE: '선택한 업무 권한을 확인할 수 없습니다. 새로고침 후 다시 선택해 주세요.',
        ROLE_NOT_ASSIGNABLE: '운영팀장은 일반 근로자 또는 홍보직원 권한만 부여할 수 있습니다.',
        ROLE_NOT_AVAILABLE: '현재 사용할 수 없는 업무 권한입니다.',
        SIGNUP_APPROVAL_FORBIDDEN: '현재 계정에는 가입 승인 권한이 없습니다.',
        EXISTING_EMPLOYEE_LINK_REQUIRED: '운영팀장은 신규 직원 생성 대신 기존 직원 연결로 승인해 주세요.',
        SIGNUP_APPLICANT_NOT_READY: '이미 처리됐거나 가입 정보가 부족한 신청입니다. 목록을 다시 확인해 주세요.',
        PROFILE_NOT_PENDING: '이미 처리된 가입 요청입니다. 목록을 새로고침해 주세요.',
        EMPLOYEE_ALREADY_LINKED: '해당 직원은 이미 다른 앱 계정과 연결돼 있습니다.',
        PROFILE_ALREADY_LINKED: '가입 계정이 이미 다른 직원에게 연결돼 있습니다.',
        EMPLOYEE_NOT_AVAILABLE: '퇴사·보관됐거나 사용할 수 없는 직원입니다.',
        EMPLOYEE_NUMBER_CONFIRMATION_MISMATCH: '기존 직원번호 확인이 맞지 않습니다.',
        SIGNUP_IDENTITY_MISMATCH_REQUIRES_CONFIRMATION: '이름 또는 입사일 차이를 먼저 확인해 주세요.',
        SIGNUP_IDENTITY_MISMATCH_REASON_REQUIRED: '인적사항이 다른 이유를 입력해 주세요.'
      };
      window.alert(reasonByCode[code] || app().friendlyError?.(error) || error.message || '가입 승인을 처리하지 못했습니다.');
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
    const card = el('article', null, 'dashboard-card phase-c-signup-approval-card app-compact-container');
    card.dataset.signupApprovalCard = profile.id;
    card.append(el('span', '앱 가입 요청', 'status-label'));
    card.append(el('h3', profile.display_name || '이름 없음'));

    const applicant = el('dl', null, 'phase-c-signup-applicant app-summary-list');
    [
      ['이메일', profile.work_email || '-'],
      ['전화번호', profile.phone || '-'],
      ['입사일(신청)', profile.hired_on || '-']
    ].forEach(([label, value]) => {
      const item = el('div', null, 'phase-c-signup-applicant-item');
      item.append(el('dt', label), el('dd', value));
      applicant.append(item);
    });

    const canCreateNew = route() === 'operations_manager';
    const employees = Array.isArray(options?.existing_employees) ? options.existing_employees : [];
    const mode = canCreateNew
      ? selectControl([
        { id: 'existing', name: '기존 직원 연결 (권장)' },
        { id: 'new', name: '신규 직원 생성 (신규 채용만)' }
      ], '승인 방식 선택')
      : selectControl([{ id: 'existing', name: '기존 직원 연결' }], '승인 방식 선택');
    mode.value = 'existing';

    const form = el('div', null, 'phase-c-signup-approval-form');
    const employeeOptions = employees.map(item => ({
      id: item.employee_uuid,
      name: `${item.employee_id} · ${item.full_name} (${item.department_name || '-'}, 입사 ${item.hired_on || '-'})`
    }));
    const employee = selectControl(employeeOptions, '연결할 기존 직원번호 선택');
    const employeeInfo = el('p', '자동 연결은 하지 않습니다. 직원번호를 선택한 뒤 신청자와 대조해 주세요.', 'help');
    const confirmEmployeeId = document.createElement('input');
    confirmEmployeeId.type = 'text';
    confirmEmployeeId.maxLength = 30;
    confirmEmployeeId.placeholder = '선택한 기존 직원번호 직접 입력 (예: TJ-000001)';
    const identityConfirmed = document.createElement('input');
    identityConfirmed.type = 'checkbox';
    const identityField = el('label', null, 'phase-c-signup-check');
    identityField.append(identityConfirmed, el('span', '기존 직원번호와 가입 신청자의 신원을 직접 확인했습니다.'));

    const mismatchConfirmed = document.createElement('input');
    mismatchConfirmed.type = 'checkbox';
    const mismatchField = el('label', null, 'phase-c-signup-check');
    mismatchField.append(mismatchConfirmed, el('span', '이름 또는 입사일 불일치를 직원에게 별도로 확인했습니다.'));
    mismatchField.hidden = true;

    const existingFields = el('div', null, 'phase-c-signup-approval-form');
    existingFields.append(
      field('기존 직원 선택', employee),
      employeeInfo,
      field('기존 직원번호 재확인', confirmEmployeeId),
      identityField,
      mismatchField
    );

    const department = selectControl(options?.departments, '부서 선택');
    const position = selectControl(options?.positions, '직책 선택');
    const attendance = document.createElement('input');
    attendance.type = 'checkbox';
    attendance.checked = true;
    const attendanceField = el('label', null, 'phase-c-signup-check');
    attendanceField.append(attendance, el('span', '근태 기록 대상'));
    const newFields = el('div', null, 'app-compact-fields');
    newFields.append(field('부서', department), field('직책', position), attendanceField);
    newFields.hidden = true;

    const role = selectControl(options?.roles, '업무 권한 선택', 'code');

    const reason = document.createElement('input');
    reason.type = 'text';
    reason.maxLength = 300;
    reason.value = '기존 직원번호 확인 후 앱 계정 연결';

    const rejectReason = document.createElement('input');
    rejectReason.type = 'text';
    rejectReason.maxLength = 300;
    rejectReason.placeholder = '예: 가입 취소, 신청 정보 오류';

    const decisionReasons = el('div', null, 'phase-c-signup-reasons');
    decisionReasons.append(
      field('승인 처리 사유', reason),
      field('거절 사유', rejectReason)
    );
    form.append(field('승인 방식', mode), existingFields, newFields, field('앱 업무 권한', role), decisionReasons);

    const help = el('p', '기존 직원 연결은 직원번호·입사일·근태·급여 기록을 그대로 유지합니다. 신규 직원 생성은 운영총괄만 별도로 선택할 수 있습니다.', 'help');

    const actions = el('div', null, 'quick-links');
    const controls = { mode, employee, employees, employeeInfo, confirmEmployeeId, identityConfirmed,
      mismatchConfirmed, department, position, role, attendance, reason };
    const approveButton = button('기존 직원 연결 후 가입 승인', () => approve(profile, controls, card));
    approveButton.dataset.approveSignup = '1';
    approveButton.dataset.approveExistingSignup = '1';
    const rejectButton = button('가입 거절', () => reject(profile, rejectReason, card));
    rejectButton.className = 'button button-danger';
    rejectButton.dataset.rejectSignup = '1';
    actions.append(approveButton, rejectButton);

    function updateEmployeeInfo() {
      const match = employees.find(item => item.employee_uuid === employee.value);
      identityConfirmed.checked = false;
      mismatchConfirmed.checked = false;
      confirmEmployeeId.value = '';
      if (!match) {
        employeeInfo.textContent = '자동 연결은 하지 않습니다. 기존 직원번호와 가입 신청자의 인적사항을 대조해 주세요.';
        mismatchField.hidden = true;
        return;
      }
      const normalized = value => String(value || '').replace(/\s+/g, '').toLocaleLowerCase('ko-KR');
      const nameMatched = normalized(profile.display_name) === normalized(match.full_name);
      const hiredMatched = String(profile.hired_on || '').slice(0, 10) === String(match.hired_on || '').slice(0, 10);
      employeeInfo.textContent = `기존 직원 ${match.employee_id} · ${match.full_name} · ${match.department_name || '-'} / 입사 ${match.hired_on || '-'}`
        + (nameMatched && hiredMatched
          ? ' · 신청 정보와 일치합니다. 직원번호를 다시 확인해 주세요.'
          : ' · 신청 이름 또는 입사일이 다릅니다! 직원에게 직접 확인한 뒤 승인해 주세요.');
      mismatchField.hidden = nameMatched && hiredMatched;
    }

    function updateMode() {
      const isExisting = mode.value !== 'new';
      existingFields.hidden = !isExisting;
      newFields.hidden = isExisting;
      approveButton.textContent = isExisting ? '기존 직원 연결 후 가입 승인' : '신규 직원 생성 후 가입 승인';
      approveButton.dataset.approveExistingSignup = isExisting ? '1' : '0';
      reason.value = isExisting
        ? '기존 직원번호 확인 후 앱 계정 연결'
        : '신규 채용 확인 후 직원 생성 및 계정 승인';
    }

    employee.addEventListener('change', updateEmployeeInfo);
    mode.addEventListener('change', updateMode);
    updateMode();
    card.append(applicant, form, help, actions);
    return card;
  }

  function injectStyles() {
    if (document.querySelector('style[data-phase-c-account-approval]')) return;
    const style = document.createElement('style');
    style.dataset.phaseCAccountApproval = '1';
    style.textContent = [
      '.phase-c-signup-approval-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;max-width:1100px;}',
      '.phase-c-signup-approval-card{min-width:0;min-height:0;gap:8px;padding:18px;}',
      '.phase-c-signup-approval-card [hidden]{display:none!important;}',
      '.phase-c-signup-approval-card h3{margin:0;}',
      '.phase-c-signup-applicant{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:4px 0;padding:12px;border-radius:12px;background:#f7f8f4;}',
      '.phase-c-signup-applicant-item{display:grid;gap:3px;min-width:0;}',
      '.phase-c-signup-applicant dt{font-size:.82rem;font-weight:900;color:#52665b}.phase-c-signup-applicant dd{margin:0;font-weight:700;overflow-wrap:anywhere;}',
      '.phase-c-signup-approval-form{display:grid;gap:10px;margin-top:4px;}',
      '.phase-c-signup-approval-form label{display:grid;gap:5px;margin:0;min-width:0;font-weight:800;}',
      '.phase-c-signup-approval-form select,.phase-c-signup-approval-form input[type="text"]{width:100%;min-width:0;min-height:44px;padding:9px 10px;border:1px solid var(--app-border);border-radius:9px;background:#fff;font:inherit;}',
      '.phase-c-signup-reasons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}',
      '.phase-c-signup-check{display:flex!important;grid-template-columns:none!important;flex-direction:row;align-items:center;gap:9px!important;min-height:44px;}',
      '.phase-c-signup-check input{width:22px;min-height:22px;height:22px;margin:0;padding:0;}',
      '.phase-c-signup-approval-card .help{margin:2px 0;line-height:1.5;font-size:.85rem;}',
      '.phase-c-signup-approval-card .quick-links{gap:8px;}',
      '@container(max-width:640px){.phase-c-signup-applicant{grid-template-columns:repeat(2,minmax(0,1fr));}.phase-c-signup-reasons{grid-template-columns:minmax(0,1fr);}}',
      '@container(max-width:420px){.phase-c-signup-applicant{grid-template-columns:minmax(0,1fr);}}'
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
      const [requests, options, existingEmployees] = await Promise.all([
        app().rpc('list_employee_signup_requests'),
        app().rpc('get_employee_signup_approval_options'),
        app().rpc('list_existing_employee_signup_candidates')
      ]);

      const intro = el('header', null, 'dashboard-intro');
      intro.append(
        el('p', '직원앱 계정 연결', 'eyebrow'),
        el('h2', '직원앱 가입 승인'),
        el('p', '기존 직원은 직원번호를 확인해 계정만 연결합니다. 기존 직원번호와 근태·급여 기록은 변경하지 않습니다. 신규 직원 생성은 운영총괄만 별도로 선택합니다.')
      );

      const grid = el('section', null, 'phase-c-signup-approval-grid');
      const rows = Array.isArray(requests) ? requests : [];
      if (!rows.length) grid.append(el('p', '현재 승인할 신입 가입 요청이 없습니다.', 'empty'));
      rows.forEach(profile => grid.append(requestCard(profile, { ...(options || {}), existing_employees: existingEmployees || [] })));
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
      card.append(el('p', '기존 직원번호와 신청 정보를 대조하고, 직원 기록 중복 없이 앱 계정을 연결합니다.'));
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