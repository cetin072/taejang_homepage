(() => {
  'use strict';

  const SESSION_KEY = 'taejang-staff-session-v1';
  const state = { config: null, session: null, loading: false };
  const element = id => document.getElementById(id);

  function loadSession() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      return parsed?.access_token ? parsed : null;
    } catch {
      return null;
    }
  }

  function clearSession() {
    state.session = null;
    sessionStorage.removeItem(SESSION_KEY);
  }

  function setMessage(value, error = false) {
    const node = element('payroll-handoff-message');
    node.hidden = !value;
    node.textContent = value || '';
    node.dataset.state = error ? 'error' : 'normal';
  }

  function monthLabel(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})/);
    return match ? `${match[1]}년 ${Number(match[2])}월` : '급여월';
  }

  function dateTimeLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return '—';
    return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function statusLabel(value) {
    return {
      lead_review: '팀장 검토 중',
      submitted_to_operations: '운영총괄 검토 대기',
      changes_requested: '보완 필요',
      operations_approved: '운영 승인 기록 완료',
      blocked: '계산 확인 필요',
      stale: '기준 변경됨 · 다시 검토 필요'
    }[value] || '확인 필요';
  }

  async function loadConfig() {
    const response = await fetch('/.netlify/functions/staff-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('CONFIG_UNAVAILABLE');
    const config = await response.json();
    if (!config.url || !config.publishableKey) throw new Error('CONFIG_INCOMPLETE');
    return config;
  }

  async function request(path, body) {
    const response = await fetch(`${state.config.url}${path}`, {
      method: 'POST',
      headers: {
        apikey: state.config.publishableKey,
        Authorization: `Bearer ${state.session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body || {})
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.message || payload?.msg || `REQUEST_${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
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

  async function rpc(name, body = {}) {
    try {
      return await request(`/rest/v1/rpc/${name}`, body);
    } catch (error) {
      if (error.status === 401 && await refreshSession()) return request(`/rest/v1/rpc/${name}`, body);
      throw error;
    }
  }

  function appendMeta(container, label, value) {
    const wrapper = document.createElement('div');
    const term = document.createElement('dt');
    const definition = document.createElement('dd');
    term.textContent = label;
    definition.textContent = value;
    wrapper.append(term, definition);
    container.append(wrapper);
  }

  function makeButton(label, action, item, note) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = action === 'approve' ? 'payroll-button' : 'payroll-button secondary';
    button.textContent = label;
    button.addEventListener('click', () => runAction(action, item, note?.value || ''));
    return button;
  }

  function renderItem(item, viewerKind) {
    const card = document.createElement('article');
    card.className = 'payroll-card payroll-handoff-card';
    const header = document.createElement('div');
    header.className = 'payroll-card-header payroll-handoff-card-header';
    const heading = document.createElement('div');
    const eyebrow = document.createElement('p');
    const title = document.createElement('h2');
    eyebrow.className = 'payroll-eyebrow';
    eyebrow.textContent = '급여초안 handoff';
    title.textContent = monthLabel(item.payroll_month);
    heading.append(eyebrow, title);
    const status = document.createElement('span');
    status.className = 'payroll-handoff-status';
    status.dataset.status = item.status || '';
    status.textContent = statusLabel(item.status);
    header.append(heading, status);
    card.append(header);

    const meta = document.createElement('dl');
    meta.className = 'payroll-handoff-meta';
    appendMeta(meta, '계산 run', item.run_id || '—');
    appendMeta(meta, '생성 시각', dateTimeLabel(item.generated_at));
    appendMeta(meta, '확인 필요', `${Number(item.exception_count || 0)}건`);
    card.append(meta);

    if (item.lead_note) {
      const note = document.createElement('p');
      note.className = 'payroll-handoff-note';
      note.textContent = `팀장 검토 메모: ${item.lead_note}`;
      card.append(note);
    }
    if (item.operations_note) {
      const note = document.createElement('p');
      note.className = 'payroll-handoff-note';
      note.textContent = `운영총괄 메모: ${item.operations_note}`;
      card.append(note);
    }

    if (item.can_start_review || item.can_submit || item.can_decide) {
      const actions = document.createElement('div');
      actions.className = 'payroll-handoff-actions';
      if (item.can_start_review) {
        const copy = document.createElement('p');
        copy.className = 'payroll-handoff-note';
        copy.textContent = '최신 계산 run의 예외가 0건인지 확인한 뒤 검토를 시작하세요.';
        actions.append(copy, makeButton('검토 시작', 'start', item));
      }
      if (item.can_submit || item.can_decide) {
        const label = document.createElement('label');
        const note = document.createElement('textarea');
        note.maxLength = 500;
        note.placeholder = item.can_decide ? '보완 요청 또는 승인 메모 (승인 메모는 선택)' : '검토를 마친 근거를 짧게 적어 주세요.';
        label.append(document.createTextNode(item.can_decide ? '운영총괄 메모' : '팀장 검토 메모'), note);
        actions.append(label);
        const row = document.createElement('div');
        row.className = 'payroll-handoff-action-row';
        if (item.can_submit) row.append(makeButton('운영총괄에게 상신', 'submit', item, note));
        if (item.can_decide) {
          row.append(makeButton('보완 요청', 'changes', item, note));
          row.append(makeButton('운영 승인 기록', 'approve', item, note));
        }
        actions.append(row);
      }
      card.append(actions);
    }

    return card;
  }

  function render(workspace) {
    const list = element('payroll-handoff-list');
    const viewerKind = workspace?.viewer_kind || '';
    element('payroll-handoff-eyebrow').textContent = viewerKind === 'operations_manager'
      ? '태장 업무플랫폼 · 운영총괄 검토'
      : '태장 업무플랫폼 · 팀장 상신';
    element('payroll-handoff-title').textContent = viewerKind === 'operations_manager'
      ? '급여초안 운영 검토'
      : '급여초안 상신';
    list.replaceChildren();
    const items = Array.isArray(workspace?.items) ? workspace.items : [];
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'payroll-card payroll-handoff-empty';
      empty.textContent = '표시할 급여초안 계산 run이 없습니다.';
      list.append(empty);
      return;
    }
    items.forEach(item => list.append(renderItem(item, viewerKind)));
  }

  function friendlyError(error) {
    const message = String(error?.message || '');
    if (error?.status === 401) return '로그인 시간이 끝났습니다. 업무플랫폼에서 다시 로그인해 주세요.';
    if (/PAYROLL_HANDOFF_(ACCESS|LEAD|OPERATIONS|REVIEW_OWNED).*FORBIDDEN|PAYROLL_HANDOFF_REVIEW_OWNED/.test(message)) {
      return '이 급여초안 handoff 작업 권한이 없습니다.';
    }
    if (/PAYROLL_HANDOFF_SOURCE_STALE/.test(message)) return '계산 기준이 바뀌었습니다. 최신 run을 다시 검토해 주세요.';
    if (/PAYROLL_HANDOFF_BLOCKED/.test(message)) return '미해결 예외가 있거나 계산이 완료되지 않아 상신할 수 없습니다.';
    if (/INVALID_PAYROLL_HANDOFF/.test(message)) return '메모는 1자 이상 500자 이하로 입력해 주세요.';
    if (/UNSAFE_PAYROLL_HANDOFF/.test(message)) return '메모에는 급여 금액, 공제, 직원 식별정보나 민감정보를 적을 수 없습니다.';
    return '급여초안 handoff를 처리하지 못했습니다. 새로고침 후 다시 확인해 주세요.';
  }

  async function runAction(action, item, note) {
    if (state.loading) return;
    const actionMap = {
      start: ['start_payroll_draft_handoff_review', { p_payroll_month: item.payroll_month }],
      submit: ['submit_payroll_draft_handoff', { p_handoff_id: item.handoff_id, p_lead_note: note }],
      changes: ['request_payroll_draft_handoff_changes', { p_handoff_id: item.handoff_id, p_operations_note: note }],
      approve: ['approve_payroll_draft_handoff', { p_handoff_id: item.handoff_id, p_operations_note: note }]
    };
    const target = actionMap[action];
    if (!target) return;
    state.loading = true;
    setMessage('처리하고 있습니다.');
    try {
      await rpc(target[0], target[1]);
      setMessage('처리했습니다. 최신 상태를 다시 불러옵니다.');
      await loadWorkspace();
    } catch (error) {
      setMessage(friendlyError(error), true);
    } finally {
      state.loading = false;
    }
  }

  async function loadWorkspace() {
    const refresh = element('payroll-handoff-refresh');
    refresh.disabled = true;
    try {
      const workspace = await rpc('get_my_payroll_draft_handoff_workspace');
      render(workspace);
      setMessage('급여초안 handoff 상태를 표시하고 있습니다. 실제 지급이나 월잠금은 실행하지 않습니다.');
    } catch (error) {
      setMessage(friendlyError(error), true);
    } finally {
      refresh.disabled = false;
    }
  }

  async function init() {
    state.session = loadSession();
    if (!state.session) {
      element('payroll-handoff-login').hidden = false;
      setMessage('로그인 후 급여초안 handoff를 확인할 수 있습니다.', true);
      return;
    }
    try {
      state.config = await loadConfig();
      const label = String(state.config.environmentLabel || '').trim();
      element('payroll-handoff-environment').textContent = label || '업무플랫폼';
      await loadWorkspace();
    } catch (error) {
      setMessage(friendlyError(error), true);
    }
  }

  element('payroll-handoff-refresh').addEventListener('click', () => { void loadWorkspace(); });
  void init();
})();
