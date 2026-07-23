(() => {
  'use strict';

  const SESSION_KEY = 'taejang-staff-session-v1';
  const panels = ['setup-panel', 'start-panel', 'login-panel', 'signup-panel', 'pending-panel', 'blocked-panel', 'unassigned-panel', 'admin-panel'];
  const state = { config: null, session: null, context: null, options: null };
  const element = id => document.getElementById(id);
  const show = (...ids) => panels.forEach(id => { element(id).hidden = !ids.includes(id); });

  function message(text, isError = false) {
    const target = element('message');
    target.textContent = text;
    target.classList.toggle('error', isError);
    target.hidden = !text;
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('.field-error').forEach(target => { target.hidden = true; target.textContent = ''; });
    form.querySelectorAll('[aria-invalid="true"]').forEach(input => input.removeAttribute('aria-invalid'));
  }

  function fieldError(form, name, text) {
    const input = form.elements[name];
    const target = element(`${form.id.replace('-form', '')}-${name.replace('_', '-')}-error`);
    if (input) input.setAttribute('aria-invalid', 'true');
    if (target) { target.textContent = text; target.hidden = false; }
    return input;
  }

  function busy(form, value) {
    form.querySelectorAll('button').forEach(button => { button.disabled = value; });
  }

  function friendlyError(error, mode = 'general') {
    const source = String(error?.message || error || '');
    if (/already registered|already been registered|user already exists/i.test(source)) return '이미 가입한 이메일입니다. 로그인하거나 승인 상태를 확인하세요.';
    if (/password.*(least|short|weak|length)|weak password/i.test(source)) return '비밀번호는 안내된 조건에 맞게 다시 입력하세요.';
    if (/invalid login credentials/i.test(source)) return '이메일 또는 비밀번호를 확인하세요.';
    if (/email not confirmed|email.*confirm/i.test(source)) return '이메일 확인이 필요합니다. 받은 메일을 확인한 뒤 다시 로그인하세요.';
    if (/network|failed to fetch|networkerror/i.test(source)) return '인터넷 연결을 확인한 뒤 다시 시도하세요.';
    if (/CONFIG_|fetch.*config/i.test(source)) return '업무앱 연결 준비가 아직 끝나지 않았습니다. 운영 담당자에게 알려주세요.';
    return mode === 'signup' ? '회원가입을 완료하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도하세요.' : '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.';
  }

  async function loadConfig() {
    if (window.TAEJANG_STAFF_CONFIG?.url && window.TAEJANG_STAFF_CONFIG?.publishableKey) return window.TAEJANG_STAFF_CONFIG;
    const response = await fetch('/.netlify/functions/staff-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('CONFIG_UNAVAILABLE');
    const config = await response.json();
    if (!config.url || !config.publishableKey) throw new Error('CONFIG_INCOMPLETE');
    return config;
  }

  async function request(path, { method = 'GET', body, authenticated = false } = {}) {
    const headers = { apikey: state.config.publishableKey, 'Content-Type': 'application/json' };
    if (authenticated && state.session?.access_token) headers.Authorization = `Bearer ${state.session.access_token}`;
    const response = await fetch(`${state.config.url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.msg || payload?.message || payload?.error_description || `REQUEST_${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function storeSession(session) {
    state.session = session;
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
    element('logout-button').hidden = !session;
  }

  async function refreshSession() {
    if (!state.session?.refresh_token) return false;
    try {
      const session = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: state.session.refresh_token } });
      storeSession(session);
      return true;
    } catch { storeSession(null); return false; }
  }

  async function rpc(name, body = {}) {
    try { return await request(`/rest/v1/rpc/${name}`, { method: 'POST', body, authenticated: true }); }
    catch (error) {
      if (error.status === 401 && await refreshSession()) return request(`/rest/v1/rpc/${name}`, { method: 'POST', body, authenticated: true });
      throw error;
    }
  }

  async function table(path) { return request(`/rest/v1/${path}`, { authenticated: true }); }
  function statusCopy(status) {
    return {
      suspended: '계정 사용이 일시 정지되었습니다. 도움이 필요하면 담당자에게 문의하세요.',
      departed: '업무 종료 처리된 계정입니다. 도움이 필요하면 담당자에게 문의하세요.',
      deleted: '사용할 수 없는 계정입니다. 도움이 필요하면 담당자에게 문의하세요.'
    }[status] || '계정 상태를 담당자에게 확인하세요.';
  }

  function routeToApp() { window.location.replace('../app/'); }

  function renderContext(context, { allowAdmin = false } = {}) {
    state.context = context;
    const destination = window.TaejangAuthRouting.accessDestination(context);
    if (destination.kind === 'signin') { storeSession(null); show('start-panel'); return; }
    if (destination.kind === 'pending') { show('pending-panel'); return; }
    if (destination.kind === 'blocked') { element('blocked-copy').textContent = statusCopy(destination.status); show('blocked-panel'); return; }
    if (destination.kind === 'unassigned') { show('unassigned-panel'); return; }
    if (allowAdmin && destination.route.code === 'super_admin') { show('admin-panel'); loadPendingAccounts(); return; }
    routeToApp();
  }

  async function restore() {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) return show('start-panel');
    try { state.session = JSON.parse(stored); } catch { storeSession(null); return show('start-panel'); }
    element('logout-button').hidden = false;
    try { renderContext(await rpc('get_my_access_context'), { allowAdmin: new URLSearchParams(window.location.search).get('admin') === '1' }); }
    catch {
      if (await refreshSession()) {
        try { return renderContext(await rpc('get_my_access_context')); } catch { /* handled below */ }
      }
      storeSession(null); show('start-panel'); message('로그인 시간이 끝났습니다. 다시 로그인하세요.', true);
    }
  }

  function validLogin(form) {
    clearFieldErrors(form);
    const email = String(form.elements.email.value).trim();
    const password = String(form.elements.password.value);
    let first;
    if (!email || !form.elements.email.validity.valid) first = fieldError(form, 'email', '업무용 이메일을 확인하세요.');
    if (!password) first ||= fieldError(form, 'password', '비밀번호를 입력하세요.');
    if (first) { first.focus(); return null; }
    return { email, password };
  }

  function validSignup(form) {
    clearFieldErrors(form);
    const displayName = String(form.elements.display_name.value).trim();
    const email = String(form.elements.email.value).trim();
    const password = String(form.elements.password.value);
    const passwordConfirm = String(form.elements.password_confirm.value);
    let first;
    if (!displayName) first = fieldError(form, 'display_name', '이름을 입력하세요.');
    if (!email || !form.elements.email.validity.valid) first ||= fieldError(form, 'email', '업무용 이메일을 확인하세요.');
    if (password.length < 8) first ||= fieldError(form, 'password', '비밀번호는 8자 이상 입력하세요.');
    if (password !== passwordConfirm) first ||= fieldError(form, 'password_confirm', '비밀번호가 서로 다릅니다.');
    if (!form.elements.privacy_consent.checked) first ||= fieldError(form, 'privacy_consent', '개인정보 수집·이용 동의가 필요합니다.');
    if (first) { first.focus(); return null; }
    return { displayName, email, password };
  }

  async function loadOptions() {
    if (state.options) return state.options;
    const [departments, positions, roles] = await Promise.all([
      table('departments?select=id,code,name&active=eq.true&order=sort_order'),
      table('positions?select=id,code,name&active=eq.true&order=sort_order'),
      table('roles?select=id,code,name&active=eq.true&order=code')
    ]);
    state.options = { departments, positions, roles };
    return state.options;
  }

  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }
  function accountCard(profile, options) {
    const departmentOptions = options.departments.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    const positionOptions = options.positions.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    const roleOptions = options.roles.map(item => `<label class="role-option"><input type="checkbox" name="roles" value="${escapeHtml(item.code)}"> ${escapeHtml(item.name)}</label>`).join('');
    return `<form class="account-card" data-profile-id="${profile.id}"><h3>${escapeHtml(profile.display_name)}</h3><p class="account-meta">${escapeHtml(profile.work_email || '이메일 없음')} · ${new Date(profile.created_at).toLocaleString('ko-KR')}</p><label>부서<select name="department" required><option value="">선택</option>${departmentOptions}</select></label><label>직책<select name="position" required><option value="">선택</option>${positionOptions}</select></label><fieldset><legend>역할</legend><div class="role-grid">${roleOptions}</div></fieldset><label>처리 사유<input name="reason" maxlength="300" value="신원과 소속 확인 후 가입 승인" required></label><div class="account-actions"><button class="button" type="submit">승인하기</button><button class="button button-quiet" type="button" data-decision="deferred">승인 보류 기록</button><button class="button button-danger" type="button" data-decision="rejected">거절 기록</button></div></form>`;
  }

  async function loadPendingAccounts() {
    const list = element('pending-list'); list.innerHTML = '<p class="empty">불러오는 중입니다.</p>';
    try {
      const [profiles, options] = await Promise.all([rpc('list_pending_profiles'), loadOptions()]);
      list.innerHTML = profiles.length ? profiles.map(profile => accountCard(profile, options)).join('') : '<p class="empty">현재 승인 대기 계정이 없습니다.</p>';
    } catch { list.innerHTML = '<p class="empty">가입 승인 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.</p>'; }
  }

  element('show-login').addEventListener('click', () => { message(''); show('login-panel'); element('login-form').elements.email.focus(); });
  element('show-signup').addEventListener('click', () => { message(''); show('signup-panel'); element('signup-form').elements.display_name.focus(); });
  document.querySelectorAll('[data-back-to-start]').forEach(button => button.addEventListener('click', () => { message(''); show('start-panel'); }));

  element('login-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const values = validLogin(form); if (!values) return;
    busy(form, true); message('');
    try {
      const session = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: values });
      storeSession(session); renderContext(await rpc('get_my_access_context'));
    } catch (error) { message(friendlyError(error), true); } finally { busy(form, false); }
  });

  element('signup-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const values = validSignup(form); if (!values) return;
    busy(form, true); message('');
    try {
      const result = await request('/auth/v1/signup', { method: 'POST', body: { email: values.email, password: values.password, data: { display_name: values.displayName } } });
      if (Array.isArray(result?.user?.identities) && result.user.identities.length === 0) {
        message('이미 가입한 이메일입니다. 로그인하거나 승인 상태를 확인하세요.', true);
        return;
      }
      form.reset();
      if (result?.access_token) { storeSession(result); renderContext(await rpc('get_my_access_context')); }
      else { show('pending-panel'); message('회원가입 신청이 완료됐습니다. 이메일 확인 안내를 받았다면 메일을 확인한 뒤 로그인하세요.'); }
    } catch (error) { message(friendlyError(error, 'signup'), true); } finally { busy(form, false); }
  });

  element('refresh-status').addEventListener('click', async () => {
    message('');
    if (!state.session) { show('login-panel'); message('승인 상태를 확인하려면 로그인하세요.'); return; }
    try { renderContext(await rpc('get_my_access_context')); }
    catch { storeSession(null); show('login-panel'); message('다시 로그인한 뒤 승인 상태를 확인하세요.', true); }
  });

  element('logout-button').addEventListener('click', async () => {
    try { if (state.session) await request('/auth/v1/logout?scope=local', { method: 'POST', authenticated: true }); } catch { /* Local state must still be removed. */ }
    storeSession(null); state.context = null; state.options = null; show('start-panel'); message('로그아웃했습니다.');
  });
  element('refresh-pending').addEventListener('click', loadPendingAccounts);
  element('pending-list').addEventListener('submit', async event => {
    if (!event.target.matches('.account-card')) return;
    event.preventDefault(); const form = event.target; const roleCodes = [...form.querySelectorAll('input[name="roles"]:checked')].map(input => input.value);
    if (!roleCodes.length) return message('역할을 하나 이상 선택하세요.', true);
    busy(form, true); message('');
    try {
      const result = await rpc('approve_pending_user', { p_target_profile_id: form.dataset.profileId, p_department_id: form.elements.department.value, p_position_id: form.elements.position.value, p_role_codes: roleCodes, p_reason_summary: form.elements.reason.value });
      if (!result.ok) throw new Error(result.code); message('가입을 승인했습니다.'); await loadPendingAccounts();
    } catch { message('가입을 승인하지 못했습니다. 입력 정보를 확인한 뒤 다시 시도하세요.', true); } finally { busy(form, false); }
  });
  element('pending-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-decision]'); if (!button) return;
    const form = button.closest('.account-card'); const reason = form.elements.reason.value.trim();
    if (!reason) return message('처리 사유를 입력하세요.', true);
    busy(form, true); message('');
    try {
      const result = await rpc('record_pending_decision', { p_target_profile_id: form.dataset.profileId, p_decision: button.dataset.decision, p_reason_summary: reason });
      if (!result.ok) throw new Error(result.code); message(button.dataset.decision === 'deferred' ? '승인 보류를 기록했습니다.' : '승인 거절을 기록했습니다. 계정은 내부자료에 접근할 수 없습니다.');
    } catch { message('처리 내용을 기록하지 못했습니다. 잠시 후 다시 시도하세요.', true); } finally { busy(form, false); }
  });

  window.addEventListener('pageshow', event => { if (event.persisted && state.config) restore(); });
  (async () => { try { state.config = await loadConfig(); await restore(); } catch { show('setup-panel'); } })();
})();
