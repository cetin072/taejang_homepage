(() => {
  'use strict';

  const SESSION_KEY = 'taejang-staff-session-v1';
  const QA_PREVIEW_MARKER_KEY = 'taejang-qa-account-preview-v1';
  const MANAGER_ROLES = new Set(['super_admin', 'operations_manager', 'department_lead', 'field_lead']);
  const PANEL_CAPABILITIES = Object.freeze({
    'schedule-admin-panel': 'schedule.manage',
    'notice-admin-panel': 'notice.manage',
    'guidance-admin-panel': 'guidance.manage'
  });
  const state = {
    config: null,
    session: null,
    context: null,
    route: null,
    boardDate: null,
    verifying: false,
    managerModulesLoaded: false,
    managerModuleFailures: []
  };
  const boardTools = window.TaejangTodayBoard;
  const element = id => document.getElementById(id);

  function koreanToday() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  async function loadConfig() {
    const response = await fetch('/.netlify/functions/staff-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('CONFIG_UNAVAILABLE');
    const config = await response.json();
    if (!config.url || !config.publishableKey) throw new Error('CONFIG_INCOMPLETE');
    return config;
  }

  function showEnvironmentLabel(config) {
    const label = element('nonproduction-label');
    const text = typeof config.environmentLabel === 'string' ? config.environmentLabel.trim() : '';
    label.hidden = !text;
    label.textContent = text;
  }

  function usesIsolatedPreviewSession() {
    try {
      const host = window.location.hostname;
      const localHost = host === 'localhost' || host === '127.0.0.1';
      const deployPreviewHost = host.startsWith('deploy-preview-') && host.endsWith('--taejang-homepage.netlify.app');
      return (localHost || deployPreviewHost)
        && window.parent !== window
        && Boolean(sessionStorage.getItem(QA_PREVIEW_MARKER_KEY));
    } catch {
      return false;
    }
  }

  function readStoredSession() {
    if (usesIsolatedPreviewSession()) {
      return sessionStorage.getItem(SESSION_KEY);
    }

    const persistent = localStorage.getItem(SESSION_KEY);
    if (persistent) return persistent;

    const legacy = sessionStorage.getItem(SESSION_KEY);
    if (legacy) {
      localStorage.setItem(SESSION_KEY, legacy);
      sessionStorage.removeItem(SESSION_KEY);
    }
    return legacy;
  }

  function storeSession(session) {
    state.session = session;

    if (usesIsolatedPreviewSession()) {
      if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else sessionStorage.removeItem(SESSION_KEY);
      return;
    }

    if (session) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      sessionStorage.removeItem(SESSION_KEY);
    } else {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    }
  }

  function clearSession() {
    storeSession(null);
  }

  function sendToStaff(reason, { clear = false } = {}) {
    if (clear) clearSession();
    const pendingView = new URLSearchParams(window.location.search).get('view');
    if (pendingView && /^[a-z][a-z0-9_.-]{0,99}$/.test(pendingView)) sessionStorage.setItem('taejang.pending-menu-view', pendingView);
    const query = reason ? `?notice=${encodeURIComponent(reason)}` : '';
    window.location.replace(`../staff/${query}`);
  }

  let sessionRefresh = null;
  async function request(path, { method = 'GET', body } = {}, retryAuthentication = true) {
    const requestToken = state.session?.access_token;
    const requestUser = state.session?.user?.id;
    const response = await fetch(`${state.config.url}${path}`, {
      method,
      headers: {
        apikey: state.config.publishableKey,
        Authorization: `Bearer ${requestToken}`,
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      // JWT claims are rejected before RPC execution. Refresh and retry once;
      // network/5xx/permission failures must never replay a business write.
      if (retryAuthentication && path.startsWith('/rest/v1/rpc/') && response.status === 401 && payload?.code === 'PGRST303') {
        const alreadyRefreshed = state.session?.access_token && state.session.access_token !== requestToken;
        if ((alreadyRefreshed || await refreshSession()) && (!requestUser || state.session?.user?.id === requestUser)) {
          return request(path, { method, body }, false);
        }
      }
      const error = new Error(payload?.message || payload?.msg || `REQUEST_${response.status}`);
      error.status = response.status;
      error.code = typeof payload?.code === 'string' ? payload.code : null;
      throw error;
    }
    return payload;
  }

  async function rpc(name, body = {}) {
    return request(`/rest/v1/rpc/${name}`, { method: 'POST', body });
  }

  async function refreshSession() {
    if (sessionRefresh) return sessionRefresh;
    if (!state.session?.refresh_token) return false;
    const refreshingSession = state.session;
    sessionRefresh = (async () => {
      try {
        const response = await fetch(`${state.config.url}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { apikey: state.config.publishableKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshingSession.refresh_token })
        });
        if (!response.ok) throw new Error('REFRESH_FAILED');
        const refreshed = await response.json();
        // A late refresh must not resurrect a logged-out/replaced account.
        if (state.session !== refreshingSession) return false;
        storeSession(refreshed);
        return true;
      } catch {
        if (state.session === refreshingSession) clearSession();
        return false;
      } finally {
        sessionRefresh = null;
      }
    })();
    return sessionRefresh;
  }

  async function reauthenticate(password) {
    const previous = state.session;
    const identity = previous?.user;
    if (!identity?.id || !identity.email) throw new Error('현재 계정을 확인할 수 없습니다. 로그인 상태를 확인해주세요.');
    let response;
    try {
      response = await fetch(`${state.config.url}/auth/v1/token?grant_type=password`, {
        method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
        headers: { apikey: state.config.publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: identity.email, password })
      });
    } finally { password = ''; }
    if (!response.ok) throw new Error('본인 확인에 실패했습니다. 현재 로그인 계정의 비밀번호를 확인해주세요.');
    const fresh = await response.json();
    if (state.session !== previous || fresh.user?.id !== identity.id || !fresh.access_token) {
      throw new Error('계정 상태가 변경됐습니다. 직원 화면을 다시 열어주세요.');
    }
    storeSession(fresh);
    return true;
  }

  async function context() {
    return rpc('get_my_access_context');
  }

  function roleCodes() {
    return new Set(boardTools.array(state.context?.roles).map(role => role.code));
  }

  function isTodayManager() {
    return [...roleCodes()].some(code => MANAGER_ROLES.has(code));
  }

  // The capability bridge resolves get_my_access_context_v2 before the optional
  // manager scripts are selected. Keep the legacy role guard only as a fail-closed
  // compatibility path when that v2 endpoint is genuinely unavailable.
  function canManage(capability) {
    const app = window.TaejangApp;
    if (app?.hasCapabilityContract?.()) return Boolean(app.can?.(capability));
    return isTodayManager();
  }

  function canOpenPanel(id) {
    const capability = PANEL_CAPABILITIES[id];
    return Boolean(capability && canManage(capability));
  }

  async function resolveCapabilityContext() {
    if (!window.TaejangCapabilityAccess?.refresh) {
      await new Promise(resolve => {
        const timeout = window.setTimeout(resolve, 3000);
        document.addEventListener('taejang-capability-access-ready', () => {
          window.clearTimeout(timeout);
          resolve();
        }, { once: true });
      });
    }
    if (!window.TaejangCapabilityAccess?.refresh) return false;
    await window.TaejangCapabilityAccess.refresh();
    return Boolean(window.TaejangApp?.hasCapabilityContract?.());
  }

  function loadScript(source) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = source;
      script.defer = true;
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', reject, { once: true });
      document.body.append(script);
    });
  }

  async function loadManagerModules() {
    if (state.managerModulesLoaded) return;
    const modules = [
      { source: 'assets/schedule-admin.js', capability: 'schedule.manage' },
      { source: 'assets/notice-admin.js', capability: 'notice.manage' },
      { source: 'assets/guidance-admin.js', capability: 'guidance.manage' }
    ].filter(module => canManage(module.capability));
    if (!modules.length) return;
    const results = await Promise.allSettled(modules.map(module => loadScript(module.source)));
    state.managerModuleFailures = results
      .map((result, index) => result.status === 'rejected' ? modules[index].source : null)
      .filter(Boolean);
    state.managerModulesLoaded = true;
  }

  function showManagerModuleStatus() {
    if (!state.managerModuleFailures.length) return hideMessage('app-status-message');
    showMessage('app-status-message', '일부 관리 도구를 불러오지 못했습니다. 핵심 대시보드와 로그인 상태는 계속 사용할 수 있습니다. 잠시 후 새로고침해주세요.', true);
  }

  function friendlyError(error) {
    if (error?.status === 401) return '로그인 시간이 끝났습니다. 다시 로그인해주세요.';
    if (error?.status === 403 || /FORBIDDEN/.test(error?.message || '')) return '이 정보를 볼 수 있는 권한이 없습니다.';
    return '정보를 불러오지 못했습니다. 잠시 후 새로고침해주세요.';
  }

  function showMessage(id, message, error = false) {
    const target = element(id);
    target.textContent = message;
    target.classList.toggle('error', error);
    target.hidden = false;
  }

  function hideMessage(id) {
    const target = element(id);
    target.hidden = true;
    target.classList.remove('error');
    target.textContent = '';
  }

  function text(tag, value, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value || '';
    return node;
  }

  function emptyCard(message) {
    return text('p', message, 'empty');
  }

  function renderWorkHours(items) {
    const list = element('work-hours-list');
    list.replaceChildren();
    const workHours = boardTools.sortByTime(items);
    if (!workHours.length) {
      list.append(emptyCard('오늘 근무시간이 등록되지 않았습니다. 담당 반장에게 확인하세요.'));
      return;
    }
    workHours.forEach(item => {
      const card = document.createElement('article');
      card.className = `today-card${item.status === 'cancelled' ? ' is-cancelled' : ''}`;
      card.append(
        text('p', boardTools.timeRange(item.start_time, item.end_time), 'card-primary'),
        text('h3', item.title),
        text('p', item.location || '', 'card-location')
      );
      if (item.body) card.append(text('p', item.body, 'card-body'));
      if (item.status === 'cancelled') card.append(text('p', '이 일정은 취소되었습니다. 담당 반장에게 확인하세요.', 'cancel-note'));
      list.append(card);
    });
  }

  function renderInformation(items) {
    if (window.TaejangStaffTodayInformation) {
      window.TaejangStaffTodayInformation.render(items);
      return;
    }
    const list = element('information-list');
    list.replaceChildren();
    const information = boardTools.sortByTime(items).sort((left, right) => Number(right.important) - Number(left.important));
    if (!information.length) {
      list.append(emptyCard('오늘 등록된 중요한 일정이나 공지가 없습니다.'));
      return;
    }
    information.forEach(item => {
      const card = document.createElement('article');
      card.className = `today-card information-card${item.important ? ' is-important' : ''}${item.status === 'cancelled' ? ' is-cancelled' : ''}`;
      card.append(
        text('p', boardTools.KIND_LABELS[item.kind] || '안내', 'card-kicker'),
        text('h3', item.title)
      );
      if (item.start_time || item.end_time) card.append(text('p', boardTools.timeRange(item.start_time, item.end_time), 'card-primary'));
      if (item.location) card.append(text('p', `장소: ${item.location}`, 'card-location'));
      if (item.body) card.append(text('p', item.body, 'card-body'));
      if (item.preparation) card.append(text('p', `준비물: ${item.preparation}`, 'card-body'));
      if (item.status === 'cancelled') card.append(text('p', '이 일정 또는 공지는 취소되었습니다. 담당 반장에게 확인하세요.', 'cancel-note'));
      list.append(card);
    });
  }

  function renderBoard(board) {
    element('today-date').textContent = boardTools.formatDate(board.date);
    element('today-worker-name').textContent = `${board.display_name || '근로자'}님`;
    renderWorkHours(board.work_hours);
    renderInformation(board.information);
    if (boardTools.boardState(board) === 'empty') {
      showMessage('board-message', boardTools.emptyMessage());
    } else {
      hideMessage('board-message');
    }
  }

  async function loadTodayBoard() {
    hideMessage('board-message');
    showMessage('board-message', '오늘 정보를 불러오고 있습니다.');
    element('refresh-board').disabled = true;
    try {
      const board = await rpc('get_my_today_board', { p_board_date: state.boardDate });
      renderBoard(board);
    } catch (error) {
      showMessage('board-message', friendlyError(error), true);
      element('work-hours-list').replaceChildren();
      element('information-list').replaceChildren();
    } finally {
      element('refresh-board').disabled = false;
    }
  }

  async function renderEntry(current, route) {
    state.context = current;
    state.route = route;
    state.boardDate = koreanToday();
    element('loading-panel').hidden = true;
    document.body.classList.toggle('general-worker-mode', route.code === 'general_worker');
    document.body.classList.toggle('desktop-app-mode', route.code !== 'general_worker');
    element('desktop-app-shell').hidden = route.code === 'general_worker';
    element('app-panel').hidden = true;
    element('general-worker-board').hidden = route.code !== 'general_worker';
    element('schedule-admin-panel').hidden = true;
    element('notice-admin-panel').hidden = true;
    element('guidance-admin-panel').hidden = true;
    element('home-title').textContent = `${route.label} 화면`;
    element('profile-name').textContent = current.display_name || '확인됨';
    element('profile-department').textContent = current.department?.name || '미배정';
    element('profile-position').textContent = current.position?.name || '미배정';
    element('profile-roles').textContent = boardTools.array(current.roles).map(role => role.name).join(', ') || '미배정';
    element('super-admin-slot').hidden = route.code !== 'super_admin';
    const requestedView = new URLSearchParams(window.location.search).get('view') || sessionStorage.getItem('taejang.pending-menu-view');
    sessionStorage.removeItem('taejang.pending-menu-view');
    window.history.replaceState({taejangMenuView:true}, '', window.location.pathname + (requestedView ? '?view=' + encodeURIComponent(requestedView) : ''));
    window.TaejangApp = {
      rpc,
      isTodayManager,
      roleCodes,
      getRoute: () => state.route?.code,
      getContext: () => state.context,
      getSession: () => state.session,
      refreshSession,
      reauthenticate,
      getConfig: () => state.config,
      getBoardDate: () => state.boardDate,
      refreshToday: loadTodayBoard,
      friendlyError
    };
    await resolveCapabilityContext();
    await loadManagerModules();
    showManagerModuleStatus();
    document.dispatchEvent(new CustomEvent('taejang-app-ready', { detail: { route: route.code, label: route.label } }));
    // #501 is released separately. Show this only after its route is available.
    fetch('/staff/change-password.html', { cache: 'no-store', credentials: 'omit', redirect: 'error' })
      .then(response => response.ok ? response.text() : '')
      .then(html => {
        if (!html.includes('id="change-password-form"')) return;
        ['app-panel', 'general-worker-board'].forEach(id => {
          const parent = element(id);
          if (!parent || parent.querySelector('[data-self-change-reminder]')) return;
          const reminder = document.createElement('p'); reminder.className = 'message';
          reminder.dataset.selfChangeReminder = '1';
          const link = document.createElement('a'); link.href = '/staff/change-password.html';
          link.textContent = '임시 비밀번호를 받았다면 여기를 눌러 내 비밀번호로 변경하세요.';
          reminder.append(link); parent.prepend(reminder);
        });
      }).catch(() => {});
  }

  function clearHandoffFromUrl() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('handoff')) return;
    url.searchParams.delete('handoff');
    const query = url.searchParams.toString();
    window.history.replaceState(null, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`);
  }

  async function exchangeNativeHandoff() {
    const code = new URLSearchParams(window.location.search).get('handoff');
    if (!code) return false;
    if (!/^[0-9a-f]{64}$/i.test(code)) throw new Error('INVALID_HANDOFF_CODE');

    const exchange = await fetch(`${state.config.url}/functions/v1/web-auth-handoff`, {
      method: 'POST',
      headers: {
        apikey: state.config.publishableKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ code })
    });
    const exchangePayload = await exchange.json().catch(() => null);
    if (!exchange.ok || !exchangePayload?.token_hash) {
      throw new Error(exchangePayload?.code || 'HANDOFF_EXCHANGE_FAILED');
    }

    const verified = await fetch(`${state.config.url}/auth/v1/verify`, {
      method: 'POST',
      headers: {
        apikey: state.config.publishableKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token_hash: exchangePayload.token_hash,
        type: exchangePayload.type || 'email'
      })
    });
    const session = await verified.json().catch(() => null);
    if (!verified.ok || !session?.access_token || !session?.refresh_token) {
      throw new Error(session?.message || 'HANDOFF_VERIFY_FAILED');
    }

    storeSession(session);
    clearHandoffFromUrl();
    return true;
  }

  async function verify() {
    if (state.verifying) return;
    state.verifying = true;

    if (new URLSearchParams(window.location.search).has('handoff')) {
      try {
        await exchangeNativeHandoff();
      } catch {
        clearHandoffFromUrl();
      }
    }

    const stored = readStoredSession();
    if (!stored) return sendToStaff('login');
    try {
      state.session = JSON.parse(stored);
    } catch {
      state.verifying = false;
      return sendToStaff('login');
    }
    try {
      const current = await context();
      const destination = window.TaejangAuthRouting.accessDestination(current);
      if (destination.kind !== 'app') {
        state.verifying = false;
        return sendToStaff(destination.kind, { clear: destination.kind === 'signin' });
      }
      await renderEntry(current, destination.route);
      if (destination.route.code === 'general_worker') await loadTodayBoard();
    } catch (error) {
      if (error.status === 401) return sendToStaff('session-expired', { clear: true });
      sendToStaff('app-error', { clear: false });
    } finally {
      state.verifying = false;
    }
  }

  element('logout-button').addEventListener('click', async () => {
    try {
      if (state.session) await request('/auth/v1/logout?scope=local', { method: 'POST' });
    } catch {
      // Local session is cleared regardless.
    }
    sendToStaff('logout', { clear: true });
  });
  element('refresh-board').addEventListener('click', loadTodayBoard);
  element('close-work-guide').addEventListener('click', () => { element('work-guide-panel').hidden = true; });

  document.addEventListener('taejang-open-app-panel', event => {
    const id = event.detail?.id;
    const allowed = new Set(Object.keys(PANEL_CAPABILITIES));
    if (!allowed.has(id) || !canOpenPanel(id)) return;
    element('dashboard-main').hidden = true;
    for (const panelId of allowed) element(panelId).hidden = panelId !== id;
    element(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
    element(id).querySelector('h2')?.focus?.();
  });
  document.addEventListener('taejang-dashboard-refresh', () => {
    element('dashboard-main').hidden = false;
    for (const panelId of ['schedule-admin-panel', 'notice-admin-panel', 'guidance-admin-panel']) element(panelId).hidden = true;
  });
  window.addEventListener('pageshow', verify);
  window.addEventListener('popstate', event => {
    // Menu history reuses the authenticated context; every business RPC retains its server guard.
    if (state.route && event.state?.taejangMenuView) return;
    verify();
  });

  (async () => {
    try {
      state.config = await loadConfig();
      showEnvironmentLabel(state.config);
      await verify();
    } catch {
      sendToStaff('setup', { clear: false });
    }
  })();
})();
