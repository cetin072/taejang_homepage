(() => {
  'use strict';

  const SESSION_KEY = 'taejang-staff-session-v1';
  const ALLOWED_ROUTES = new Set(['operations_manager', 'promotion_lead', 'department_lead']);
  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');
  const arr = value => Array.isArray(value) ? value : [];
  let cachedConfig = null;
  let currentContext = null;
  let activeEmployeeView = 'existing';

  const el = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value !== undefined && value !== null) node.textContent = value;
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

  function field(label, control, help) {
    const wrap = document.createElement('label');
    wrap.append(el('span', label));
    if (help) wrap.append(el('small', help, 'field-help'));
    wrap.append(control);
    return wrap;
  }

  function input(type = 'text', value = '') {
    const node = document.createElement('input');
    node.type = type;
    node.value = value ?? '';
    return node;
  }

  function select(items, value = '') {
    const node = document.createElement('select');
    arr(items).forEach(item => {
      const option = document.createElement('option');
      option.value = item.id ?? item.value;
      option.textContent = item.name ?? item.label;
      node.append(option);
    });
    if (value) node.value = value;
    return node;
  }

  function injectStyles() {
    if (document.querySelector('style[data-employee-management]')) return;
    const style = document.createElement('style');
    style.dataset.employeeManagement = '1';
    style.textContent = `
      .employee-management { display:grid; gap:20px; }
      .employee-view-tabs { display:flex; flex-wrap:wrap; gap:8px; padding:6px; border:1px solid var(--app-border); border-radius:12px; background:#f7f9f7; width:fit-content; max-width:100%; }
      .employee-view-tabs .button { min-height:42px; }
      .employee-view-tabs .button[aria-current="page"] { background:var(--app-accent); color:#fff; border-color:var(--app-accent); }
      .employee-toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between; }
      .employee-toolbar input[type="search"] { min-width:260px; min-height:44px; padding:9px 11px; border:1px solid var(--app-border); border-radius:9px; font:inherit; }
      .employee-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
      .employee-card { display:grid; gap:10px; }
      .employee-card-head { display:flex; gap:12px; align-items:center; }
      .employee-avatar { width:64px; height:64px; border-radius:14px; object-fit:cover; background:#edf2ee; border:1px solid var(--app-border); }
      .employee-avatar-placeholder { display:grid; place-items:center; font-weight:900; color:var(--app-muted); }
      .employee-meta { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px 12px; margin:0; }
      .employee-meta div { display:grid; gap:2px; }
      .employee-meta dt { color:var(--app-muted); font-size:.82rem; }
      .employee-meta dd { margin:0; font-weight:750; }
      .employee-form { display:grid; gap:12px; max-width:900px; padding:18px; border:1px solid var(--app-border); border-radius:14px; background:#fff; }
      .employee-sensitive-bulk { display:grid; gap:12px; padding:16px; border:1px solid var(--app-border); border-radius:14px; background:#fbfcfb; }
      .employee-sensitive-bulk textarea { width:100%; min-height:150px; resize:vertical; padding:11px 12px; border:1px solid var(--app-border); border-radius:9px; font:inherit; line-height:1.5; }
      .employee-sensitive-bulk .message { margin:0; white-space:pre-line; }
      .employee-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
      .employee-form label { display:grid; gap:6px; font-weight:800; }
      .employee-form input,.employee-form select { width:100%; min-height:44px; padding:9px 10px; border:1px solid var(--app-border); border-radius:9px; background:#fff; font:inherit; }
      .employee-request-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
      .employee-photo-actions { display:flex; flex-wrap:wrap; gap:8px; }
      .employee-photo-actions input[type="file"] { position:absolute; width:1px; height:1px; opacity:0; pointer-events:none; }
      .employee-protected-note { padding:9px 10px; border-radius:9px; background:#fff4df; color:#6a4d13; font-weight:700; }
      @media(max-width:760px){.employee-grid,.employee-request-grid,.employee-form-grid{grid-template-columns:1fr}.employee-toolbar{align-items:stretch}.employee-toolbar input[type="search"]{min-width:0;width:100%}.employee-view-tabs{display:grid;width:100%;grid-template-columns:1fr}.employee-view-tabs .button{width:100%}}
    `;
    document.head.append(style);
  }

  function session() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}'); }
    catch { return {}; }
  }

  async function config() {
    if (cachedConfig) return cachedConfig;
    const response = await fetch('/.netlify/functions/staff-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('사진 저장 설정을 불러오지 못했습니다.');
    cachedConfig = await response.json();
    return cachedConfig;
  }

  async function uploadEmployeePhoto(employee, photoType, file) {
    if (!file) return null;
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(file.type)) throw new Error('JPG, PNG, WEBP 사진만 올릴 수 있습니다.');
    if (file.size > 8 * 1024 * 1024) throw new Error('사진은 8MB 이하로 올려주세요.');
    const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[file.type];
    const path = `${employee.id}/${photoType}/${crypto.randomUUID()}.${ext}`;
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const cfg = await config();
    const auth = session();
    const response = await fetch(`${cfg.url}/storage/v1/object/employee-private-media/${encoded}`, {
      method: 'POST',
      headers: {
        apikey: cfg.publishableKey,
        Authorization: `Bearer ${auth.access_token}`,
        'Content-Type': file.type,
        'x-upsert': 'false'
      },
      body: file
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || '사진을 저장하지 못했습니다.');
    }
    return path;
  }

  async function signedPhotoUrl(path) {
    if (!path) return null;
    const cfg = await config();
    const auth = session();
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${cfg.url}/storage/v1/object/sign/employee-private-media/${encoded}`, {
      method: 'POST',
      headers: { apikey: cfg.publishableKey, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 600 })
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    const raw = payload?.signedURL || payload?.signedUrl;
    if (!raw) return null;
    return /^https?:\/\//.test(raw) ? raw : `${cfg.url}${raw}`;
  }

  async function setAvatar(image, path) {
    const url = await signedPhotoUrl(path).catch(() => null);
    if (!url || !image.isConnected) return;
    image.src = url;
  }

  function statusLabel(status) {
    return ({ active: '재직', leave: '휴직', departed: '퇴사' })[status] || status;
  }

  function requestLabel(type) {
    return ({ new_employee: '신규 직원 등록', employee_update: '직원정보 수정', id_photo_update: '증명사진 변경' })[type] || type;
  }

  function optionName(items, id) {
    return arr(items).find(item => item.id === id)?.name || '';
  }

  function makeEmployeeForm(context, employee = null, teamRequest = false) {
    const form = el('form', null, 'employee-form');
    const name = input('text', employee?.full_name || ''); name.required = true; name.maxLength = 80;
    const hired = input('date', employee?.hired_on || ''); hired.required = true;
    const department = select(context.departments, employee?.department_id || context.department_id || context.departments?.[0]?.id || '');
    const positionItems = !employee && teamRequest ? arr(context.new_employee_positions) : arr(context.positions);
    const position = select(positionItems, employee?.position_id || positionItems?.[0]?.id || '');
    const status = select([
      { id: 'active', name: '재직' }, { id: 'leave', name: '휴직' }, { id: 'departed', name: '퇴사' }
    ], employee?.employment_status || 'active');
    const departed = input('date', employee?.departed_on || '');
    const attendance = input('checkbox'); attendance.checked = employee ? !!employee.attendance_required : true;
    if (teamRequest) department.disabled = true;
    if (!employee) { status.value = 'active'; status.disabled = true; departed.disabled = true; }
    if (!positionItems.length) position.disabled = true;

    const grid = el('div', null, 'employee-form-grid');
    grid.append(
      field('이름', name),
      field('입사일', hired),
      field('부서', department),
      field('직책', position, !employee && teamRequest ? '본인 직책보다 낮은 직책만 요청할 수 있습니다.' : null),
      field('재직상태', status),
      field('퇴사일', departed),
      field('근태 대상', attendance, '체크하면 출퇴근 관리 대상입니다.')
    );
    const actions = el('div', null, 'quick-links');
    const submit = button(employee ? (teamRequest ? '수정 요청 보내기' : '직원정보 저장') : (teamRequest ? '등록 요청 보내기' : '직원 등록'), () => {});
    submit.type = 'submit';
    if (!positionItems.length) submit.disabled = true;
    actions.append(submit); form.append(grid, actions);
    if (!employee && teamRequest && !positionItems.length) {
      form.prepend(el('p', '현재 권한으로 등록 요청할 수 있는 하위 직책이 없습니다.', 'message'));
    }

    form.addEventListener('submit', async event => {
      event.preventDefault(); submit.disabled = true;
      try {
        if (!employee && !teamRequest) {
          await app().rpc('create_employee', {
            p_full_name: name.value.trim(), p_hired_on: hired.value, p_department_id: department.value,
            p_position_id: position.value, p_attendance_required: attendance.checked
          });
        } else if (!employee && teamRequest) {
          await app().rpc('submit_employee_change_request', {
            p_request_type: 'new_employee', p_employee_uuid: null,
            p_requested_changes: { full_name: name.value.trim(), hired_on: hired.value, position_id: position.value, attendance_required: attendance.checked }
          });
        } else if (employee && !teamRequest) {
          await app().rpc('update_employee_core', {
            p_employee_uuid: employee.id, p_full_name: name.value.trim(), p_hired_on: hired.value,
            p_department_id: department.value, p_position_id: position.value, p_employment_status: status.value,
            p_departed_on: status.value === 'departed' ? departed.value || null : null,
            p_attendance_required: attendance.checked, p_reason: '직원 관리 화면에서 수정'
          });
        } else {
          await app().rpc('submit_employee_change_request', {
            p_request_type: 'employee_update', p_employee_uuid: employee.id,
            p_requested_changes: {
              full_name: name.value.trim(), hired_on: hired.value, department_id: department.value,
              position_id: position.value, employment_status: status.value,
              departed_on: status.value === 'departed' ? departed.value || null : null,
              attendance_required: attendance.checked
            }
          });
        }
        if (!employee) activeEmployeeView = 'existing';
        await openEmployeeManagement(activeEmployeeView);
      } catch (error) {
        window.alert(app().friendlyError?.(error) || error.message || '직원정보를 저장하지 못했습니다.');
        submit.disabled = false;
      }
    });
    return form;
  }

  function normalizeResidentNumber(value) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  function residentNumberChecksumValid(value) {
    const digits = normalizeResidentNumber(value);
    if (!/^\d{13}$/.test(digits) || !/[1-4]/.test(digits[6])) return false;
    const century = ['1','2'].includes(digits[6]) ? 1900 : 2000;
    const year = century + Number(digits.slice(0,2));
    const month = Number(digits.slice(2,4));
    const day = Number(digits.slice(4,6));
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return false;
    const weights = [2,3,4,5,6,7,8,9,2,3,4,5];
    const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
    return ((11 - (sum % 11)) % 10) === Number(digits[12]);
  }

  function parseResidentBulkPaste(text, employees) {
    const employeeMap = new Map();
    arr(employees).forEach(employee => {
      const name = String(employee.full_name || '').trim();
      if (!employeeMap.has(name)) employeeMap.set(name, []);
      employeeMap.get(name).push(employee);
    });

    const rows = [];
    const errors = [];
    const skipped = [];
    const seen = new Map();

    String(text || '').split(/\r?\n/).forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (!line) return;
      const cells = rawLine.split('\t');
      const name = String(cells[0] || '').trim();
      const rawResident = String(cells[1] || '').trim();
      if (!name || /성명/.test(name) && /주민등록번호/.test(rawResident)) return;
      if (cells.length < 2 || !rawResident) {
        errors.push(`${index + 1}행: 이름과 주민등록번호 2개 열이 필요합니다.`);
        return;
      }

      const resident = normalizeResidentNumber(rawResident);
      if (!residentNumberChecksumValid(resident)) {
        errors.push(`${name}: 주민등록번호 형식 또는 체크섬을 확인해 주세요.`);
        return;
      }

      if (seen.has(name)) {
        if (seen.get(name) === resident) return;
        errors.push(`${name}: 붙여넣기 안에 서로 다른 주민번호가 중복되어 있습니다.`);
        return;
      }
      seen.set(name, resident);

      const matches = employeeMap.get(name) || [];
      if (!matches.length) {
        errors.push(`${name}: 현재 직원 DB에서 찾지 못했습니다.`);
        return;
      }
      if (matches.length > 1) {
        errors.push(`${name}: 동명이인이 있어 개별 등록이 필요합니다.`);
        return;
      }
      if (matches[0].resident_number_registered) {
        skipped.push(`${name}: 이미 암호화 등록됨`);
        return;
      }

      rows.push({ employee_uuid: matches[0].id, resident_number: resident });
    });

    return { rows, errors, skipped };
  }

  function bulkResidentImportPanel(context) {
    if (!context.can_manage_sensitive_identity) return null;
    const section = el('section', null, 'dashboard-section');
    const box = el('div', null, 'employee-sensitive-bulk');
    const textarea = document.createElement('textarea');
    textarea.autocomplete = 'off';
    textarea.spellcheck = false;
    textarea.placeholder = '엑셀에서 성명 + 주민등록번호 두 열을 복사해 그대로 붙여넣으세요.\n예: 홍길동<TAB>000000-0000000';
    textarea.setAttribute('aria-label', '주민등록번호 일괄등록 붙여넣기');
    const message = el('p', '', 'message');
    const submit = button('검증 후 일괄 암호화 저장', async () => {
      message.textContent = '';
      const parsed = parseResidentBulkPaste(textarea.value, context.employees);
      if (parsed.errors.length) {
        message.classList.add('error');
        message.textContent = `저장하지 않았습니다.\n${parsed.errors.join('\n')}`;
        parsed.rows.length = 0;
        return;
      }
      if (!parsed.rows.length) {
        message.classList.remove('error');
        message.textContent = parsed.skipped.length ? parsed.skipped.join('\n') : '등록할 새 직원이 없습니다.';
        return;
      }
      if (!window.confirm(`${parsed.rows.length}명의 주민등록번호를 Vault에 암호화 저장합니다. 계속할까요?`)) {
        parsed.rows.length = 0;
        return;
      }

      submit.disabled = true;
      try {
        const result = await app().rpc('bulk_set_employee_resident_registration_numbers', { p_rows: parsed.rows });
        textarea.value = '';
        parsed.rows.length = 0;
        message.classList.remove('error');
        message.textContent = `${Number(result.saved_count || 0)}명 암호화 등록이 완료됐습니다.`;
        await openEmployeeManagement('existing');
      } catch (error) {
        textarea.value = '';
        parsed.rows.length = 0;
        message.classList.add('error');
        message.textContent = app().friendlyError?.(error) || error.message || '일괄 등록에 실패했습니다. 전체 저장은 취소됐습니다.';
      } finally {
        submit.disabled = false;
      }
    });
    box.append(
      el('h2', '주민등록번호 일괄 암호화 등록'),
      el('p', '엑셀의 성명·주민등록번호 두 열을 복사해 붙여넣습니다. 원문은 저장 후 화면에 남기지 않으며, 한 행이라도 오류가 있으면 전체 저장을 취소합니다.', 'help'),
      textarea,
      submit,
      message
    );
    section.append(box);
    return section;
  }

  function nationalPensionAgeLabel(status) {
    return ({
      identity_missing: '주민번호 미등록',
      under18_opt_out_confirmed: '18세 미만 · 제외신청 확인',
      under18_opt_out_available: '18세 미만 · 제외신청 가능',
      compulsory_age_range: '의무가입 연령대',
      voluntary_continuation_confirmed: '60세 이상 · 임의계속가입 확인',
      non_compulsory_60_plus: '60세 이상 · 의무가입 비대상'
    })[status] || status || '확인 필요';
  }

  function employmentInsuranceAgeLabel(status) {
    return ({
      identity_missing: '주민번호 미등록',
      standard_age_range: '일반 연령대',
      continuous_before_65_confirmed: '65세 전 피보험 연속 확인',
      employed_after_65_excluded: '65세 이후 신규고용 · 적용 제외 확인',
      continuity_review_required: '65세 이후 · 연속가입 확인 필요'
    })[status] || status || '확인 필요';
  }

  function sensitiveIdentityPanel(context, employee) {
    if (!context.can_manage_sensitive_identity) return null;
    const form = el('form', null, 'employee-form');
    form.dataset.sensitiveIdentityForm = '1';

    const registered = !!employee.resident_number_registered;
    const intro = el('p',
      registered
        ? '주민등록번호는 암호화 보관 중이며 원문은 화면에 다시 표시하지 않습니다.'
        : '주민등록번호 원문은 저장 후 화면에 다시 표시되지 않고 암호화 보관됩니다.',
      'help'
    );

    const rrn = input('password');
    rrn.placeholder = '000000-0000000';
    rrn.inputMode = 'numeric';
    rrn.autocomplete = 'off';
    rrn.maxLength = 14;
    rrn.setAttribute('aria-label', '주민등록번호');

    const saveRrn = button(registered ? '주민번호 변경 저장' : '주민번호 암호화 저장', () => {});
    saveRrn.type = 'submit';

    const under18 = input('checkbox');
    under18.checked = !!employee.national_pension_under18_opt_out_confirmed;
    const npsOver60 = select([
      { id: 'none', name: '별도 예외 없음' },
      { id: 'voluntary_continuation_confirmed', name: '60세 이후 임의계속가입 확인' }
    ], employee.national_pension_over60_exception || 'none');
    const employmentOver65 = select([
      { id: 'unknown', name: '65세 이후 연속가입 여부 미확인' },
      { id: 'continuous_before_65_confirmed', name: '65세 전 피보험자격 연속 확인' },
      { id: 'employed_after_65_excluded', name: '65세 이후 신규고용 · 적용 제외 확인' }
    ], employee.employment_insurance_over65_status || 'unknown');

    const flagSave = button('연령 예외사항 저장', async () => {
      flagSave.disabled = true;
      try {
        await app().rpc('set_employee_age_insurance_flags', {
          p_employee_uuid: employee.id,
          p_national_pension_under18_opt_out_confirmed: under18.checked,
          p_national_pension_over60_exception: npsOver60.value,
          p_employment_insurance_over65_status: employmentOver65.value
        });
        await openEmployeeManagement('existing');
      } catch (error) {
        window.alert(app().friendlyError?.(error) || error.message || '연령 예외사항을 저장하지 못했습니다.');
        flagSave.disabled = false;
      }
    }, true);
    if (!registered) flagSave.disabled = true;

    const grid = el('div', null, 'employee-form-grid');
    grid.append(
      field('주민등록번호', rrn, '공식 4대보험 행정과 연령 판정에만 사용합니다. 원문은 Vault에 암호화됩니다.'),
      field('국민연금 18세 미만', under18, '본인 제외 신청이 확인된 경우에만 체크합니다.'),
      field('국민연금 60세 이후', npsOver60, '임의계속가입이 공식 확인된 경우에만 예외로 등록합니다.'),
      field('고용보험 65세 이후', employmentOver65, '65세 이후 신규고용 여부와 65세 전 피보험 연속 여부를 확인해 등록합니다.')
    );

    const actions = el('div', null, 'quick-links');
    actions.append(saveRrn, flagSave);
    form.append(intro, grid, actions);

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!rrn.value.trim()) {
        window.alert('주민등록번호를 입력해 주세요.');
        return;
      }
      saveRrn.disabled = true;
      try {
        await app().rpc('set_employee_resident_registration_number', {
          p_employee_uuid: employee.id,
          p_resident_number: rrn.value.trim()
        });
        rrn.value = '';
        await openEmployeeManagement('existing');
      } catch (error) {
        rrn.value = '';
        window.alert(app().friendlyError?.(error) || error.message || '주민등록번호를 저장하지 못했습니다.');
        saveRrn.disabled = false;
      }
    });

    return form;
  }

  function photoPicker(employee, photoType, context) {
    const wrap = el('div', null, 'employee-photo-actions');
    const file = input('file'); file.accept = 'image/jpeg,image/png,image/webp';
    const label = photoType === 'profile' ? '업무용 사진 변경' : '증명사진 변경';
    const action = button(label, () => file.click(), true);
    wrap.append(action, file);
    file.addEventListener('change', async () => {
      const selected = file.files?.[0]; if (!selected) return;
      action.disabled = true; action.textContent = '사진 저장 중';
      try {
        const path = await uploadEmployeePhoto(employee, photoType, selected);
        if (photoType === 'profile' || context.access_level === 'operations_manager') {
          await app().rpc('set_employee_photo', { p_employee_uuid: employee.id, p_photo_type: photoType, p_storage_path: path });
        } else {
          await app().rpc('submit_employee_change_request', { p_request_type: 'id_photo_update', p_employee_uuid: employee.id, p_requested_changes: { id_photo_path: path } });
        }
        await openEmployeeManagement('existing');
      } catch (error) {
        window.alert(error.message || '사진을 저장하지 못했습니다.');
        action.disabled = false; action.textContent = label;
      }
    });
    return wrap;
  }

  function employeeCard(context, employee) {
    const card = el('article', null, 'dashboard-card employee-card');
    const head = el('div', null, 'employee-card-head');
    const avatar = el('div', employee.full_name?.slice(0, 1) || '직', 'employee-avatar employee-avatar-placeholder');
    if (employee.profile_photo_path) {
      const image = document.createElement('img'); image.className = 'employee-avatar'; image.alt = `${employee.full_name} 업무용 사진`;
      head.append(image); setAvatar(image, employee.profile_photo_path);
    } else head.append(avatar);
    const title = document.createElement('div'); title.append(el('span', employee.employee_id, 'status-label'), el('h3', employee.full_name)); head.append(title); card.append(head);

    const meta = document.createElement('dl'); meta.className = 'employee-meta';
    const pairs = [
      ['부서', employee.department_name], ['직책', employee.position_name], ['재직상태', statusLabel(employee.employment_status)],
      ['입사일', employee.hired_on], ['근태대상', employee.attendance_required ? '예' : '아니오'],
      ['계정 연결', employee.linked_profile ? `${employee.linked_profile.display_name} · ${employee.linked_profile.account_status}` : '미연결']
    ];
    if (context.can_manage_sensitive_identity) {
      pairs.push(
        ['주민번호', employee.resident_number_registered ? '암호화 등록됨' : '미등록'],
        ['생년월일', employee.birth_date || '-'],
        ['만 나이', Number.isInteger(employee.age_years) ? `${employee.age_years}세` : '-'],
        ['국민연금', nationalPensionAgeLabel(employee.national_pension_age_status)],
        ['고용보험', employmentInsuranceAgeLabel(employee.employment_insurance_age_status)]
      );
    }
    pairs.forEach(([label, value]) => { const row = document.createElement('div'); row.append(el('dt', label), el('dd', value || '-')); meta.append(row); });
    card.append(meta);
    if (employee.protected && context.access_level !== 'operations_manager') card.append(el('p', '보호 계정은 팀장에서 수정 요청할 수 없습니다.', 'employee-protected-note'));

    const actions = el('div', null, 'quick-links');
    actions.append(photoPicker(employee, 'profile', context));
    if (context.access_level === 'operations_manager') actions.append(photoPicker(employee, 'id_photo', context));
    else if (!employee.protected) actions.append(photoPicker(employee, 'id_photo', context));
    if (!employee.protected || context.access_level === 'operations_manager') {
      actions.append(button(context.access_level === 'operations_manager' ? '직원정보 수정' : '정보 수정 요청', () => {
        const existing = card.querySelector('[data-employee-edit-form]');
        if (existing) { existing.remove(); return; }
        const form = makeEmployeeForm(context, employee, context.access_level !== 'operations_manager'); form.dataset.employeeEditForm = '1'; card.append(form);
      }, true));
    }
    if (context.can_manage_sensitive_identity) {
      actions.append(button(employee.resident_number_registered ? '주민번호·보험연령 관리' : '주민번호 등록', () => {
        const existing = card.querySelector('[data-sensitive-identity-form]');
        if (existing) { existing.remove(); return; }
        const form = sensitiveIdentityPanel(context, employee);
        if (form) card.append(form);
      }, true));
    }
    card.append(actions);
    return card;
  }

  function requestSummary(context, request) {
    const changes = request.requested_changes || {};
    const bits = [];
    if (changes.full_name) bits.push(`이름: ${changes.full_name}`);
    if (changes.hired_on) bits.push(`입사일: ${changes.hired_on}`);
    if (changes.department_id) bits.push(`부서: ${optionName(context.departments, changes.department_id) || changes.department_id}`);
    if (changes.position_id) bits.push(`직책: ${optionName(context.positions, changes.position_id) || changes.position_id}`);
    if (changes.employment_status) bits.push(`재직: ${statusLabel(changes.employment_status)}`);
    if (changes.attendance_required !== undefined) bits.push(`근태대상: ${changes.attendance_required ? '예' : '아니오'}`);
    if (changes.id_photo_path) bits.push('증명사진 변경 포함');
    return bits.join(' · ') || '변경내용 확인';
  }

  function reviewRequestCard(context, request) {
    const card = el('article', null, 'dashboard-card');
    card.append(el('span', '승인 대기', 'status-label'), el('h3', requestLabel(request.request_type)), el('p', requestSummary(context, request)));
    const actions = el('div', null, 'quick-links');
    const act = async action => {
      let comment = '';
      if (action !== 'approve') comment = window.prompt(action === 'changes_requested' ? '보완할 내용을 적어주세요.' : '반려 이유를 적어주세요.', '') || '';
      if (action !== 'approve' && !comment.trim()) return;
      try {
        await app().rpc('review_employee_change_request', { p_request_id: request.id, p_action: action, p_comment: comment.trim() || null });
        await openEmployeeManagement('existing');
      } catch (error) { window.alert(app().friendlyError?.(error) || '요청을 처리하지 못했습니다.'); }
    };
    actions.append(button('승인', () => act('approve')), button('보완 요청', () => act('changes_requested'), true), button('반려', () => act('reject'), true));
    card.append(actions); return card;
  }

  function employeeViewTabs(context) {
    const tabs = el('nav', null, 'employee-view-tabs');
    tabs.setAttribute('aria-label', '직원 관리 화면 선택');
    const canRegisterDirectly = ['operations_manager', 'promotion_lead_global'].includes(context.access_level);
    const labels = canRegisterDirectly
      ? [['existing', '기존 직원 관리'], ['new', '신규 직원 등록']]
      : [['existing', '기존 직원 관리'], ['new', '신규 직원 등록 요청']];
    labels.forEach(([view, label]) => {
      const node = button(label, () => openEmployeeManagement(view), true);
      if (activeEmployeeView === view) node.setAttribute('aria-current', 'page');
      tabs.append(node);
    });
    return tabs;
  }

  async function openEmployeeManagement(view = activeEmployeeView) {
    closeSidebar();
    if (!ALLOWED_ROUTES.has(route())) return;
    if (typeof view === 'string' && ['existing', 'new'].includes(view)) activeEmployeeView = view;
    const target = main(); if (!target) return;
    document.getElementById('desktop-page-title').textContent = route() === 'operations_manager' ? '직원 관리' : '팀 직원 관리';
    target.replaceChildren(el('p', '직원 정보를 불러오고 있습니다.', 'message'));
    try {
      const context = await app().rpc('get_employee_management_context'); currentContext = context;
      const shell = el('section', null, 'employee-management');
      const intro = el('header', null, 'dashboard-intro');
      const isOps = context.access_level === 'operations_manager';
      const isGlobalPromotionLead = context.access_level === 'promotion_lead_global';
      intro.append(el('p', isOps ? '운영총괄 직원관리' : isGlobalPromotionLead ? '운영팀장 전사 직원등록' : '내 팀 직원관리', 'eyebrow'), el('h2', isOps || isGlobalPromotionLead ? '직원 관리' : '팀 직원 관리'));
      intro.append(el('p', isOps ? '기존 직원 관리와 신규 직원 등록을 나누어 처리합니다. 직원번호는 생성 후 변경되지 않습니다.' : isGlobalPromotionLead ? '모든 부서·팀 또는 미배정 신규 직원을 직접 등록할 수 있습니다. 직원번호는 서버가 발급하며, 삭제는 운영총괄만 할 수 있습니다.' : '기존 팀 직원 관리와 신규 직원 등록 요청을 나누어 처리합니다. 신규 등록은 본인보다 낮은 직책만 요청할 수 있습니다.'));
      shell.append(intro, employeeViewTabs(context));

      if (activeEmployeeView === 'existing' && context.can_manage_sensitive_identity) {
        const bulkPanel = bulkResidentImportPanel(context);
        if (bulkPanel) shell.append(bulkPanel);
      }

      if (activeEmployeeView === 'new') {
        const createSection = el('section', null, 'dashboard-section');
        createSection.append(el('h2', isOps || isGlobalPromotionLead ? '신규 직원 등록' : '신규 직원 등록 요청'));
        createSection.append(el('p', isOps || isGlobalPromotionLead
          ? '신규 직원을 직원 마스터에 등록합니다.'
          : '운영총괄 승인 후 직원 마스터에 등록됩니다. 본인과 같거나 높은 직책은 선택할 수 없습니다.', 'help'));
        createSection.append(makeEmployeeForm(context, null, !(isOps || isGlobalPromotionLead)));
        shell.append(createSection);
        target.replaceChildren(shell);
        return;
      }

      if (isOps) {
        const requests = arr(context.change_requests);
        const review = el('section', null, 'dashboard-section'); review.append(el('h2', `팀장 요청 ${requests.length ? `· ${requests.length}건` : ''}`));
        const grid = el('div', null, 'employee-request-grid');
        if (!requests.length) grid.append(el('p', '현재 승인 대기 요청이 없습니다.', 'empty'));
        requests.forEach(request => grid.append(reviewRequestCard(context, request))); review.append(grid); shell.append(review);
      } else {
        const requests = arr(context.change_requests);
        if (requests.length) {
          const mine = el('section', null, 'dashboard-section'); mine.append(el('h2', '내 요청 상태'));
          const grid = el('div', null, 'employee-request-grid');
          requests.forEach(request => {
            const card = el('article', null, 'dashboard-card');
            card.append(el('span', request.status === 'pending' ? '처리 대기' : '보완 필요', 'status-label'), el('h3', requestLabel(request.request_type)), el('p', requestSummary(context, request)));
            if (request.decision_comment) card.append(el('p', `운영총괄 의견: ${request.decision_comment}`));
            grid.append(card);
          });
          mine.append(grid); shell.append(mine);
        }
      }

      const listSection = el('section', null, 'dashboard-section');
      const toolbar = el('div', null, 'employee-toolbar'); toolbar.append(el('h2', isOps ? '전체 직원' : (isGlobalPromotionLead ? '조회 가능한 직원' : '내 팀 직원')));
      const search = input('search'); search.placeholder = '직원번호 또는 이름 검색'; toolbar.append(search); listSection.append(toolbar);
      const grid = el('div', null, 'employee-grid');
      const employees = arr(context.employees);
      const render = () => {
        const q = search.value.trim().toLowerCase(); grid.replaceChildren();
        const filtered = employees.filter(item => !q || item.employee_id.toLowerCase().includes(q) || item.full_name.toLowerCase().includes(q));
        if (!filtered.length) grid.append(el('p', q ? '검색 결과가 없습니다.' : '등록된 직원이 없습니다.', 'empty'));
        filtered.forEach(employee => grid.append(employeeCard(context, employee)));
      };
      search.addEventListener('input', render); render(); listSection.append(grid); shell.append(listSection);
      target.replaceChildren(shell);
    } catch (error) {
      target.replaceChildren(el('p', app().friendlyError?.(error) || '직원 정보를 불러오지 못했습니다.', 'message error'));
    }
  }

  function syncNavigation() {
    const nav = document.getElementById('app-nav');
    if (!nav || !ALLOWED_ROUTES.has(route()) || nav.querySelector('[data-employee-management-nav]')) return;
    const node = button(route() === 'operations_manager' ? '직원 관리' : '팀 직원 관리', () => openEmployeeManagement('existing'), true);
    node.dataset.employeeManagementNav = '1';
    const accountApproval = [...nav.children].find(child => child.textContent?.includes('가입 승인'));
    const homepage = [...nav.children].find(child => child.textContent?.trim() === '홈페이지');
    nav.insertBefore(node, accountApproval || homepage || null);
  }

  function sync() { syncNavigation(); }
  injectStyles();
  document.addEventListener('taejang-open-employee-management', () => openEmployeeManagement('existing'));
  document.addEventListener('taejang-app-ready', () => setTimeout(sync, 100));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(sync, 120));
  const start = () => {
    const shell = document.getElementById('desktop-app-shell');
    if (!shell) return;
    new MutationObserver(() => setTimeout(sync, 25)).observe(shell, { childList: true, subtree: true });
    sync();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  window.TaejangEmployeeManagement = { openEmployeeManagement };
})();
