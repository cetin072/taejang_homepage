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
    const labels = context.access_level === 'operations_manager'
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
      intro.append(el('p', context.access_level === 'operations_manager' ? '운영총괄 직원관리' : '내 팀 직원관리', 'eyebrow'), el('h2', context.access_level === 'operations_manager' ? '직원 관리' : '팀 직원 관리'));
      intro.append(el('p', context.access_level === 'operations_manager' ? '기존 직원 관리와 신규 직원 등록을 나누어 처리합니다. 직원번호는 생성 후 변경되지 않습니다.' : '기존 팀 직원 관리와 신규 직원 등록 요청을 나누어 처리합니다. 신규 등록은 본인보다 낮은 직책만 요청할 수 있습니다.'));
      shell.append(intro, employeeViewTabs(context));

      if (activeEmployeeView === 'new') {
        const createSection = el('section', null, 'dashboard-section');
        createSection.append(el('h2', context.access_level === 'operations_manager' ? '신규 직원 등록' : '신규 직원 등록 요청'));
        createSection.append(el('p', context.access_level === 'operations_manager'
          ? '신규 직원을 직원 마스터에 등록합니다.'
          : '운영총괄 승인 후 직원 마스터에 등록됩니다. 본인과 같거나 높은 직책은 선택할 수 없습니다.', 'help'));
        createSection.append(makeEmployeeForm(context, null, context.access_level !== 'operations_manager'));
        shell.append(createSection);
        target.replaceChildren(shell);
        return;
      }

      if (context.access_level === 'operations_manager') {
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
      const toolbar = el('div', null, 'employee-toolbar'); toolbar.append(el('h2', context.access_level === 'operations_manager' ? '전체 직원' : '내 팀 직원'));
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