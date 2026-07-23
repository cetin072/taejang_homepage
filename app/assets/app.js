(() => {
  'use strict';
  const SESSION_KEY = 'taejang-staff-session-v1';
  const state = { config: null, session: null };
  const element = id => document.getElementById(id);

  async function loadConfig() {
    const response = await fetch('/.netlify/functions/staff-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('CONFIG_UNAVAILABLE');
    const config = await response.json();
    if (!config.url || !config.publishableKey) throw new Error('CONFIG_INCOMPLETE');
    return config;
  }

  function clearSession() { state.session = null; sessionStorage.removeItem(SESSION_KEY); }
  function sendToStaff(reason, { clear = true } = {}) {
    if (clear) clearSession();
    const query = reason ? `?notice=${encodeURIComponent(reason)}` : '';
    window.location.replace(`../staff/${query}`);
  }

  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${state.config.url}${path}`, {
      method,
      headers: { apikey: state.config.publishableKey, Authorization: `Bearer ${state.session.access_token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) { const error = new Error(payload?.msg || payload?.message || `REQUEST_${response.status}`); error.status = response.status; throw error; }
    return payload;
  }

  async function refreshSession() {
    if (!state.session?.refresh_token) return false;
    try {
      const response = await fetch(`${state.config.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST', headers: { apikey: state.config.publishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: state.session.refresh_token })
      });
      if (!response.ok) throw new Error('REFRESH_FAILED');
      state.session = await response.json(); sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.session)); return true;
    } catch { clearSession(); return false; }
  }

  async function context() {
    try { return await request('/rest/v1/rpc/get_my_access_context', { method: 'POST', body: {} }); }
    catch (error) {
      if (error.status === 401 && await refreshSession()) return request('/rest/v1/rpc/get_my_access_context', { method: 'POST', body: {} });
      throw error;
    }
  }

  function render(context, route) {
    element('loading-panel').hidden = true; element('app-panel').hidden = false;
    element('home-title').textContent = `${route.label} 화면`;
    element('profile-name').textContent = context.display_name || '확인됨';
    element('profile-department').textContent = context.department?.name || '미배정';
    element('profile-position').textContent = context.position?.name || '미배정';
    element('profile-roles').textContent = (context.roles || []).map(role => role.name).join(', ') || '미배정';
    element('general-worker-slots').hidden = route.code !== 'general_worker';
    element('super-admin-slot').hidden = route.code !== 'super_admin';
    window.history.replaceState(null, '', `?home=${encodeURIComponent(route.home)}`);
  }

  async function verify() {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) return sendToStaff('login');
    try { state.session = JSON.parse(stored); } catch { return sendToStaff('login'); }
    try {
      const current = await context();
      const destination = window.TaejangAuthRouting.accessDestination(current);
      if (destination.kind !== 'app') return sendToStaff(destination.kind, { clear: destination.kind === 'signin' });
      render(current, destination.route);
    } catch { sendToStaff('login'); }
  }

  element('logout-button').addEventListener('click', async () => {
    try { if (state.session) await request('/auth/v1/logout?scope=local', { method: 'POST' }); } catch { /* local session is cleared regardless */ }
    sendToStaff('logout', { clear: true });
  });
  window.addEventListener('pageshow', verify);
  window.addEventListener('popstate', verify);
  (async () => { try { state.config = await loadConfig(); await verify(); } catch { sendToStaff('setup'); } })();
})();
