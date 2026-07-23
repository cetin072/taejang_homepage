(() => {
  'use strict';

  const SESSION_KEY = 'taejang-staff-session-v1';
  const MANAGER_ROLES = new Set(['super_admin', 'operations_manager', 'department_lead', 'field_lead']);
  const state = {
    config: null,
    session: null,
    context: null,
    route: null,
    boardDate: null,
    adminOptions: null,
    adminRecords: { tasks: [], information: [] },
    verifying: false
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

  function clearSession() {
    state.session = null;
    sessionStorage.removeItem(SESSION_KEY);
  }

  function sendToStaff(reason, { clear = true } = {}) {
    if (clear) clearSession();
    const query = reason ? `?notice=${encodeURIComponent(reason)}` : '';
    window.location.replace(`../staff/${query}`);
  }

  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${state.config.url}${path}`, {
      method,
      headers: {
        apikey: state.config.publishableKey,
        Authorization: `Bearer ${state.session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.message || payload?.msg || `REQUEST_${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function rpc(name, body = {}) {
    return request(`/rest/v1/rpc/${name}`, { method: 'POST', body });
  }

  async function refreshSession() {
    if (!state.session?.refresh_token) return false;
    try {
      const response = await fetch(`${state.config.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: state.config.publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: state.session.refresh_token })
      });
      if (!response.ok) throw new Error('REFRESH_FAILED');
      state.session = await response.json();
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
      return true;
    } catch {
      clearSession();
      return false;
    }
  }

  async function context() {
    try {
      return await rpc('get_my_access_context');
    } catch (error) {
      if (error.status === 401 && await refreshSession()) return rpc('get_my_access_context');
      throw error;
    }
  }

  function roleCodes() {
    return new Set(boardTools.array(state.context?.roles).map(role => role.code));
  }

  function isTodayManager() {
    return [...roleCodes()].some(code => MANAGER_ROLES.has(code));
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

  function metaRow(label, value) {
    const row = document.createElement('div');
    row.className = 'task-meta-row';
    row.append(text('dt', label), text('dd', value || '등록되지 않음'));
    return row;
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

  function openWorkGuide(guide) {
    const panel = element('work-guide-panel');
    const content = element('work-guide-content');
    content.replaceChildren();
    if (!guide) {
      content.append(emptyCard(boardTools.guideMessage(null)));
    } else {
      content.append(text('h3', guide.title));
      if (guide.summary) content.append(text('p', guide.summary, 'card-body'));
      const details = document.createElement('dl');
      details.className = 'task-meta';
      details.append(
        metaRow('준비물', guide.materials),
        metaRow('주의사항', guide.caution)
      );
      content.append(details, text('p', boardTools.guideMessage(guide), 'help'));
    }
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    element('work-guide-title').focus?.();
  }

  function renderTasks(items) {
    const list = element('task-list');
    list.replaceChildren();
    const tasks = boardTools.sortByTime(items);
    if (!tasks.length) {
      list.append(emptyCard(boardTools.emptyMessage()));
      return;
    }

    tasks.forEach(task => {
      const details = document.createElement('details');
      details.className = `today-card task-card${task.status === 'cancelled' ? ' is-cancelled' : ''}`;
      const summary = document.createElement('summary');
      const heading = document.createElement('span');
      heading.className = 'task-summary-main';
      heading.append(
        text('span', boardTools.timeRange(task.start_time, task.end_time), 'task-time'),
        text('span', task.title, 'task-title')
      );
      summary.append(heading, text('span', task.status === 'cancelled' ? '취소' : '자세히', 'task-toggle'));

      const body = document.createElement('div');
      body.className = 'task-detail';
      const metadata = document.createElement('dl');
      metadata.className = 'task-meta';
      metadata.append(
        metaRow('시간', boardTools.timeRange(task.start_time, task.end_time)),
        metaRow('작업장소', task.location),
        metaRow('담당 반장', task.lead?.name),
        metaRow('준비물', task.preparation),
        metaRow('쉬운 주의사항', task.caution)
      );
      body.append(metadata);
      if (task.status === 'cancelled') {
        body.append(text('p', '이 업무는 취소되었습니다. 담당 반장에게 확인하세요.', 'cancel-note'));
      }
      const guideButton = document.createElement('button');
      guideButton.type = 'button';
      guideButton.className = 'button guide-button';
      guideButton.textContent = '작업방법 보기';
      guideButton.addEventListener('click', () => openWorkGuide(task.work_guide));
      body.append(guideButton);
      details.append(summary, body);
      list.append(details);
    });
  }

  function renderInformation(items) {
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
    renderTasks(board.tasks);
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
      element('task-list').replaceChildren();
      element('information-list').replaceChildren();
    } finally {
      element('refresh-board').disabled = false;
    }
  }

  function addOption(select, value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }

  function fillSelect(select, options, { emptyLabel } = {}) {
    select.replaceChildren();
    if (emptyLabel !== undefined) addOption(select, '', emptyLabel);
    options.forEach(option => addOption(select, option.id, option.name || option.title));
  }

  function scopeOptions() {
    const options = [];
    if (state.adminOptions?.company_allowed) options.push({ id: 'company', name: '전체 직원' });
    if (boardTools.array(state.adminOptions?.departments).length) options.push({ id: 'department', name: '부서' });
    if (boardTools.array(state.adminOptions?.work_groups).length) options.push({ id: 'work_group', name: '작업반' });
    if (boardTools.array(state.adminOptions?.profiles).length) options.push({ id: 'profile', name: '개인' });
    return options;
  }

  function updateTargetSelect(scopeSelectId, targetSelectId, selectedValue = '') {
    const scope = element(scopeSelectId).value;
    const target = element(targetSelectId);
    let options = [];
    if (scope === 'department') options = state.adminOptions.departments;
    if (scope === 'work_group') options = state.adminOptions.work_groups;
    if (scope === 'profile') options = state.adminOptions.profiles;
    fillSelect(target, options, { emptyLabel: scope === 'company' ? '전체 직원' : '대상을 선택하세요' });
    target.disabled = scope === 'company';
    if (selectedValue) target.value = selectedValue;
  }

  function renderAdminOptions() {
    for (const prefix of ['task', 'information']) {
      const scope = element(`${prefix}-scope`);
      fillSelect(scope, scopeOptions());
      updateTargetSelect(`${prefix}-scope`, `${prefix}-target`);
    }
    fillSelect(element('task-lead'), state.adminOptions.profiles, { emptyLabel: '선택하지 않음' });
    fillSelect(element('task-guide'), state.adminOptions.work_guides, { emptyLabel: '연결하지 않음' });
    fillSelect(element('guide-department'), state.adminOptions.departments);
  }

  function recordTargetLabel(record) {
    const scope = record.target_scope;
    if (scope === 'company') return '전체 직원';
    const source = scope === 'department'
      ? state.adminOptions.departments
      : scope === 'work_group'
        ? state.adminOptions.work_groups
        : state.adminOptions.profiles;
    return boardTools.array(source).find(item => item.id === boardTools.targetId(record))?.name || boardTools.SCOPE_LABELS[scope] || '대상';
  }

  function editButton(label, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-quiet';
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  function renderAdminRecords() {
    const list = element('admin-record-list');
    list.replaceChildren();
    const tasks = boardTools.array(state.adminRecords.tasks);
    const information = boardTools.array(state.adminRecords.information);
    if (!tasks.length && !information.length) {
      list.append(emptyCard('선택한 날짜에 등록된 정보가 없습니다.'));
      return;
    }
    tasks.forEach(task => {
      const card = document.createElement('article');
      card.className = 'admin-record-card';
      card.append(
        text('p', `오늘 업무 · ${boardTools.STATUS_LABELS[task.status] || task.status}`, 'card-kicker'),
        text('h4', task.title),
        text('p', `${boardTools.timeRange(task.start_time, task.end_time)} · ${recordTargetLabel(task)}`, 'help'),
        editButton('업무 수정', () => fillTaskForm(task))
      );
      list.append(card);
    });
    information.forEach(item => {
      const card = document.createElement('article');
      card.className = 'admin-record-card';
      card.append(
        text('p', `${boardTools.KIND_LABELS[item.kind] || '안내'} · ${boardTools.STATUS_LABELS[item.status] || item.status}`, 'card-kicker'),
        text('h4', item.title),
        text('p', `${boardTools.timeRange(item.start_time, item.end_time, '시간 없음')} · ${recordTargetLabel(item)}`, 'help'),
        editButton('일정·공지 수정', () => fillInformationForm(item))
      );
      list.append(card);
    });
  }

  function resetTaskForm() {
    element('task-form').reset();
    element('task-id').value = '';
    element('task-date').value = element('admin-board-date').value;
    renderAdminOptions();
  }

  function fillTaskForm(task) {
    element('task-id').value = task.id;
    element('task-date').value = task.work_date;
    element('task-title-input').value = task.title || '';
    element('task-start').value = boardTools.formatTime(task.start_time);
    element('task-end').value = boardTools.formatTime(task.end_time);
    element('task-location').value = task.location || '';
    element('task-lead').value = task.lead_profile_id || '';
    element('task-scope').value = task.target_scope;
    updateTargetSelect('task-scope', 'task-target', boardTools.targetId(task));
    element('task-guide').value = task.work_guide_id || '';
    element('task-status').value = task.status;
    element('task-preparation').value = task.preparation_text || '';
    element('task-caution').value = task.caution_text || '';
    element('task-reason').value = '';
    element('task-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetInformationForm() {
    element('information-form').reset();
    element('information-id').value = '';
    element('information-date').value = element('admin-board-date').value;
    renderAdminOptions();
  }

  function fillInformationForm(item) {
    element('information-id').value = item.id;
    element('information-date').value = item.information_date;
    element('information-kind').value = item.kind;
    element('information-title-input').value = item.title || '';
    element('information-location').value = item.location || '';
    element('information-start').value = boardTools.formatTime(item.start_time);
    element('information-end').value = boardTools.formatTime(item.end_time);
    element('information-scope').value = item.target_scope;
    updateTargetSelect('information-scope', 'information-target', boardTools.targetId(item));
    element('information-status').value = item.status;
    element('information-important').checked = Boolean(item.important);
    element('information-body').value = item.body_easy || '';
    element('information-preparation').value = item.preparation_text || '';
    element('information-reason').value = '';
    element('information-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetGuideForm() {
    element('guide-form').reset();
    element('guide-id').value = '';
    renderAdminOptions();
  }

  async function loadAdminData() {
    hideMessage('admin-message');
    element('refresh-admin').disabled = true;
    try {
      const [options, records] = await Promise.all([
        rpc('get_today_board_admin_options'),
        rpc('list_manageable_today_records', { p_board_date: element('admin-board-date').value })
      ]);
      state.adminOptions = options;
      state.adminRecords = records;
      renderAdminOptions();
      renderAdminRecords();
      if (!element('task-date').value) element('task-date').value = element('admin-board-date').value;
      if (!element('information-date').value) element('information-date').value = element('admin-board-date').value;
    } catch (error) {
      showMessage('admin-message', friendlyError(error), true);
    } finally {
      element('refresh-admin').disabled = false;
    }
  }

  function selectedTarget(prefix) {
    const scope = element(`${prefix}-scope`).value;
    const targetId = scope === 'company' ? '' : element(`${prefix}-target`).value;
    if (scope !== 'company' && !targetId) throw new Error('TARGET_REQUIRED');
    return { p_target_scope: scope, ...boardTools.targetParameters(scope, targetId) };
  }

  async function saveForm(form, rpcName, payload) {
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    hideMessage('admin-message');
    try {
      const result = await rpc(rpcName, payload);
      if (!result?.ok) throw new Error(result?.code || 'SAVE_FAILED');
      showMessage('admin-message', '저장했습니다. 일반 근로자에게 보이는 범위를 다시 확인해주세요.');
      await loadAdminData();
      return true;
    } catch (error) {
      const message = error.message === 'TARGET_REQUIRED'
        ? '대상을 선택해주세요.'
        : error.message === 'FORBIDDEN'
          ? '이 범위의 정보를 수정할 권한이 없습니다.'
          : '저장하지 못했습니다. 필수항목과 시간·대상 범위를 확인해주세요.';
      showMessage('admin-message', message, true);
      return false;
    } finally {
      submit.disabled = false;
    }
  }

  async function submitTask(event) {
    event.preventDefault();
    let target;
    try { target = selectedTarget('task'); } catch (error) {
      showMessage('admin-message', '대상을 선택해주세요.', true);
      return;
    }
    const saved = await saveForm(event.currentTarget, 'save_daily_work_assignment', {
      p_assignment_id: element('task-id').value || null,
      p_work_date: element('task-date').value,
      p_start_time: element('task-start').value || null,
      p_end_time: element('task-end').value || null,
      p_title: element('task-title-input').value,
      p_location: element('task-location').value,
      p_lead_profile_id: element('task-lead').value || null,
      p_preparation_text: element('task-preparation').value,
      p_caution_text: element('task-caution').value,
      p_work_guide_id: element('task-guide').value || null,
      ...target,
      p_status: element('task-status').value,
      p_change_reason: element('task-reason').value
    });
    if (saved) resetTaskForm();
  }

  async function submitInformation(event) {
    event.preventDefault();
    let target;
    try { target = selectedTarget('information'); } catch (error) {
      showMessage('admin-message', '대상을 선택해주세요.', true);
      return;
    }
    const saved = await saveForm(event.currentTarget, 'save_today_information_item', {
      p_information_id: element('information-id').value || null,
      p_information_date: element('information-date').value,
      p_kind: element('information-kind').value,
      p_start_time: element('information-start').value || null,
      p_end_time: element('information-end').value || null,
      p_title: element('information-title-input').value,
      p_body_easy: element('information-body').value,
      p_location: element('information-location').value,
      p_preparation_text: element('information-preparation').value,
      p_important: element('information-important').checked,
      ...target,
      p_status: element('information-status').value,
      p_change_reason: element('information-reason').value
    });
    if (saved) resetInformationForm();
  }

  async function submitGuide(event) {
    event.preventDefault();
    const saved = await saveForm(event.currentTarget, 'save_work_guide_stub', {
      p_work_guide_id: element('guide-id').value || null,
      p_department_id: element('guide-department').value,
      p_title: element('guide-title-input').value,
      p_summary_text: element('guide-summary').value,
      p_materials_text: element('guide-materials').value,
      p_caution_text: element('guide-caution').value,
      p_status: element('guide-status').value,
      p_change_reason: element('guide-reason').value
    });
    if (saved) resetGuideForm();
  }

  function renderEntry(current, route) {
    state.context = current;
    state.route = route;
    state.boardDate = koreanToday();
    element('loading-panel').hidden = true;
    element('app-panel').hidden = route.code === 'general_worker';
    element('general-worker-board').hidden = route.code !== 'general_worker';
    element('today-admin-panel').hidden = !isTodayManager();
    element('home-title').textContent = `${route.label} 화면`;
    element('profile-name').textContent = current.display_name || '확인됨';
    element('profile-department').textContent = current.department?.name || '미배정';
    element('profile-position').textContent = current.position?.name || '미배정';
    element('profile-roles').textContent = boardTools.array(current.roles).map(role => role.name).join(', ') || '미배정';
    element('super-admin-slot').hidden = route.code !== 'super_admin';
    element('admin-board-date').value = state.boardDate;
    element('task-date').value = state.boardDate;
    element('information-date').value = state.boardDate;
    window.history.replaceState(null, '', `?home=${encodeURIComponent(route.home)}`);
  }

  async function verify() {
    if (state.verifying) return;
    state.verifying = true;
    const stored = sessionStorage.getItem(SESSION_KEY);
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
      renderEntry(current, destination.route);
      if (destination.route.code === 'general_worker') await loadTodayBoard();
      if (isTodayManager()) await loadAdminData();
    } catch {
      sendToStaff('login');
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
  element('refresh-admin').addEventListener('click', loadAdminData);
  element('admin-board-date').addEventListener('change', () => {
    element('task-date').value = element('admin-board-date').value;
    element('information-date').value = element('admin-board-date').value;
    loadAdminData();
  });
  element('task-scope').addEventListener('change', () => updateTargetSelect('task-scope', 'task-target'));
  element('information-scope').addEventListener('change', () => updateTargetSelect('information-scope', 'information-target'));
  element('task-form').addEventListener('submit', submitTask);
  element('information-form').addEventListener('submit', submitInformation);
  element('guide-form').addEventListener('submit', submitGuide);
  element('reset-task-form').addEventListener('click', resetTaskForm);
  element('reset-information-form').addEventListener('click', resetInformationForm);
  element('reset-guide-form').addEventListener('click', resetGuideForm);
  window.addEventListener('pageshow', verify);
  window.addEventListener('popstate', verify);

  (async () => {
    try {
      state.config = await loadConfig();
      await verify();
    } catch {
      sendToStaff('setup');
    }
  })();
})();
