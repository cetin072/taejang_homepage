(() => {
  'use strict';

  const SESSION_KEY = 'taejang-staff-session-v1';
  const panels = ['setup-panel', 'auth-panel', 'pending-panel', 'blocked-panel', 'app-panel', 'admin-panel'];
  const state = { config: null, session: null, context: null, options: null };

  const element = id => document.getElementById(id);
  const show = (...ids) => panels.forEach(id => { element(id).hidden = !ids.includes(id); });

  function message(text, isError = false) {
    const target = element('message');
    target.textContent = text;
    target.classList.toggle('error', isError);
    target.hidden = !text;
  }

  function busy(form, value) {
    form.querySelectorAll('button').forEach(button => { button.disabled = value; });
  }

  async function loadConfig() {
    if (window.TAEJANG_STAFF_CONFIG?.url && window.TAEJANG_STAFF_CONFIG?.publishableKey) {
      return window.TAEJANG_STAFF_CONFIG;
    }
    const response = await fetch('/.netlify/functions/staff-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('CONFIG_UNAVAILABLE');
    const config = await response.json();
    if (!config.url || !config.publishableKey) throw new Error('CONFIG_INCOMPLETE');
    return config;
  }

  async function request(path, { method = 'GET', body, authenticated = false } = {}) {
    const headers = {
      apikey: state.config.publishableKey,
      'Content-Type': 'application/json'
    };
    if (authenticated && state.session?.access_token) {
      headers.Authorization = `Bearer ${state.session.access_token}`;
    }
    const response = await fetch(`${state.config.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.msg || payload?.message || payload?.error_description || `요청 실패 (${response.status})`);
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
      const session = await request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: { refresh_token: state.session.refresh_token }
      });
      storeSession(session);
      return true;
    } catch {
      storeSession(null);
      return false;
    }
  }

  async function rpc(name, body = {}) {
    try {
      return await request(`/rest/v1/rpc/${name}`, { method: 'POST', body, authenticated: true });
    } catch (error) {
      if (error.status === 401 && await refreshSession()) {
        return request(`/rest/v1/rpc/${name}`, { method: 'POST', body, authenticated: true });
      }
      throw error;
    }
  }

  async function table(path) {
    return request(`/rest/v1/${path}`, { authenticated: true });
  }

  function statusCopy(status) {
    return {
      suspended: '계정이 일시 정지되었습니다. 시스템 최고관리자에게 문의하세요.',
      departed: '퇴사 또는 업무 종료 처리된 계정입니다.',
      deleted: '삭제 처리된 계정입니다.'
    }[status] || '계정 상태를 담당자에게 확인하세요.';
  }

  function renderContext(context) {
    state.context = context;
    if (!context) {
      storeSession(null);
      show('auth-panel');
      return;
    }
    if (context.account_status === 'pending') {
      show('pending-panel');
      return;
    }
    if (context.account_status !== 'active') {
      element('blocked-copy').textContent = statusCopy(context.account_status);
      show('blocked-panel');
      return;
    }

    const roleCodes = (context.roles || []).map(role => role.code);
    element('profile-name').textContent = context.display_name;
    element('profile-status').textContent = '사용 중';
    element('profile-department').textContent = context.department?.name || '미배정';
    element('profile-position').textContent = context.position?.name || '미배정';
    element('profile-roles').textContent = (context.roles || []).map(role => role.name).join(', ') || '미배정';
    show('app-panel', ...(roleCodes.includes('super_admin') ? ['admin-panel'] : []));
    if (roleCodes.includes('super_admin')) loadPendingAccounts();
  }

  async function restore() {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) return show('auth-panel');
    try { state.session = JSON.parse(stored); } catch { return show('auth-panel'); }
    element('logout-button').hidden = false;
    try {
      renderContext(await rpc('get_my_access_context'));
    } catch {
      if (await refreshSession()) {
        try { return renderContext(await rpc('get_my_access_context')); } catch { /* fall through */ }
      }
      storeSession(null);
      show('auth-panel');
      message('로그인 시간이 끝났습니다. 다시 로그인하세요.', true);
    }
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

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  function accountCard(profile, options) {
    const departmentOptions = options.departments.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    const positionOptions = options.positions.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    const roleOptions = options.roles.map(item => `
      <label class="role-option"><input type="checkbox" name="roles" value="${escapeHtml(item.code)}"> ${escapeHtml(item.name)}</label>
    `).join('');
    return `
      <form class="account-card" data-profile-id="${profile.id}">
        <h3>${escapeHtml(profile.display_name)}</h3>
        <p class="account-meta">${escapeHtml(profile.work_email || '이메일 없음')} · ${new Date(profile.created_at).toLocaleString('ko-KR')}</p>
        <label>부서<select name="department" required><option value="">선택</option>${departmentOptions}</select></label>
        <label>직책<select name="position" required><option value="">선택</option>${positionOptions}</select></label>
        <fieldset><legend>역할</legend><div class="role-grid">${roleOptions}</div></fieldset>
        <label>처리 사유<input name="reason" maxlength="300" value="신원과 소속 확인 후 가입 승인" required></label>
        <div class="account-actions">
          <button class="button" type="submit">승인하기</button>
          <button class="button button-quiet" type="button" data-decision="deferred">승인 보류 기록</button>
          <button class="button button-danger" type="button" data-decision="rejected">거절 기록</button>
        </div>
      </form>`;
  }

  async function loadPendingAccounts() {
    const list = element('pending-list');
    list.innerHTML = '<p class="empty">불러오는 중입니다.</p>';
    try {
      const [profiles, options] = await Promise.all([rpc('list_pending_profiles'), loadOptions()]);
      list.innerHTML = profiles.length
        ? profiles.map(profile => accountCard(profile, options)).join('')
        : '<p class="empty">현재 승인 대기 계정이 없습니다.</p>';
    } catch (error) {
      list.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
    }
  }

  element('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    busy(form, true); message('');
    try {
      const session = await request('/auth/v1/token?grant_type=password', {
        method: 'POST', body: { email: data.get('email'), password: data.get('password') }
      });
      storeSession(session);
      renderContext(await rpc('get_my_access_context'));
    } catch (error) {
      message(error.message === 'Invalid login credentials' ? '이메일 또는 비밀번호를 확인하세요.' : error.message, true);
    } finally { busy(form, false); }
  });

  element('signup-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    busy(form, true); message('');
    try {
      const result = await request('/auth/v1/signup', {
        method: 'POST',
        body: {
          email: data.get('email'),
          password: data.get('password'),
          data: { display_name: String(data.get('display_name')).trim() }
        }
      });
      form.reset();
      if (result?.access_token) {
        storeSession(result);
        renderContext(await rpc('get_my_access_context'));
      } else {
        show('pending-panel');
        message('회원가입 신청이 완료됐습니다. 이메일 확인이 켜져 있다면 메일을 확인한 뒤 로그인하세요.');
      }
    } catch (error) { message(error.message, true); }
    finally { busy(form, false); }
  });

  element('logout-button').addEventListener('click', async () => {
    try {
      if (state.session) await request('/auth/v1/logout?scope=local', { method: 'POST', authenticated: true });
    } catch { /* local session is cleared even when the network request fails */ }
    storeSession(null); state.context = null; state.options = null;
    show('auth-panel'); message('로그아웃했습니다.');
  });

  element('refresh-pending').addEventListener('click', loadPendingAccounts);

  element('pending-list').addEventListener('submit', async event => {
    if (!event.target.matches('.account-card')) return;
    event.preventDefault();
    const form = event.target;
    const roleCodes = [...form.querySelectorAll('input[name="roles"]:checked')].map(input => input.value);
    if (!roleCodes.length) return message('역할을 하나 이상 선택하세요.', true);
    busy(form, true); message('');
    try {
      const result = await rpc('approve_pending_user', {
        p_target_profile_id: form.dataset.profileId,
        p_department_id: form.elements.department.value,
        p_position_id: form.elements.position.value,
        p_role_codes: roleCodes,
        p_reason_summary: form.elements.reason.value
      });
      if (!result.ok) throw new Error(result.code);
      message('가입을 승인했습니다.');
      await loadPendingAccounts();
    } catch (error) { message(`승인하지 못했습니다: ${error.message}`, true); }
    finally { busy(form, false); }
  });

  element('pending-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-decision]');
    if (!button) return;
    const form = button.closest('.account-card');
    const reason = form.elements.reason.value.trim();
    if (!reason) return message('처리 사유를 입력하세요.', true);
    busy(form, true); message('');
    try {
      const result = await rpc('record_pending_decision', {
        p_target_profile_id: form.dataset.profileId,
        p_decision: button.dataset.decision,
        p_reason_summary: reason
      });
      if (!result.ok) throw new Error(result.code);
      message(button.dataset.decision === 'deferred' ? '승인 보류를 기록했습니다.' : '승인 거절을 기록했습니다. 계정은 내부자료에 접근할 수 없습니다.');
    } catch (error) { message(`기록하지 못했습니다: ${error.message}`, true); }
    finally { busy(form, false); }
  });

  (async () => {
    try {
      state.config = await loadConfig();
      await restore();
    } catch {
      show('setup-panel');
    }
  })();
})();
