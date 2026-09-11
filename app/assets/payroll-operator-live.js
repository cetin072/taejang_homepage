(() => {
  'use strict';

  const SESSION_KEY = 'taejang-staff-session-v1';
  const DEFAULT_MONTH = '2026-08';
  const state = {
    config: null,
    session: null,
    context: null,
    loading: false,
  };

  const element = id => document.getElementById(id);

  function money(value) {
    if (value === null || value === undefined || value === '') return '—';
    const number = Number(value);
    return Number.isFinite(number) ? `${Math.round(number).toLocaleString('ko-KR')}원` : '—';
  }

  function hours(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `${Number.isInteger(number) ? number : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}시간`;
  }

  function monthLabel(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})/);
    return match ? `${match[1]}년 ${Number(match[2])}월` : '급여월';
  }

  function statusLabel(value) {
    const labels = {
      not_started: '아직 시작 전',
      imported: '근태 입력됨',
      exceptions: '확인 필요',
      provisional: '가안 계산 완료',
      ready: '확정 준비',
      locked: '확정 완료',
    };
    return labels[String(value || '')] || String(value || '확인 필요');
  }

  function rateStatusLabel(value) {
    if (value === 'single_rate') return '정상';
    if (value === 'multiple_rates_review_required') return '복수 시급 확인';
    if (value === 'missing_rate_review_required') return '시급 확인';
    return '확인';
  }

  async function loadConfig() {
    const response = await fetch('/.netlify/functions/staff-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('CONFIG_UNAVAILABLE');
    const config = await response.json();
    if (!config.url || !config.publishableKey) throw new Error('CONFIG_INCOMPLETE');
    return config;
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.access_token ? parsed : null;
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    state.session = session;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    state.session = null;
    sessionStorage.removeItem(SESSION_KEY);
  }

  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${state.config.url}${path}`, {
      method,
      headers: {
        apikey: state.config.publishableKey,
        Authorization: `Bearer ${state.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
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
        headers: {
          apikey: state.config.publishableKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: state.session.refresh_token }),
      });
      if (!response.ok) throw new Error('REFRESH_FAILED');
      saveSession(await response.json());
      return true;
    } catch {
      clearSession();
      return false;
    }
  }

  async function rpc(name, body = {}) {
    try {
      return await request(`/rest/v1/rpc/${name}`, { method: 'POST', body });
    } catch (error) {
      if (error.status === 401 && await refreshSession()) {
        return request(`/rest/v1/rpc/${name}`, { method: 'POST', body });
      }
      throw error;
    }
  }

  function selectedMonth() {
    const input = element('payroll-live-month');
    return input?.value || DEFAULT_MONTH;
  }

  function setMessage(message, { error = false } = {}) {
    const node = element('payroll-live-message');
    if (!node) return;
    node.hidden = !message;
    node.textContent = message || '';
    node.dataset.state = error ? 'error' : 'normal';
  }

  function setText(id, value) {
    const node = element(id);
    if (node) node.textContent = value;
  }

  function renderEnvironment() {
    const badge = element('payroll-live-environment');
    const text = String(state.config?.environmentLabel || '').trim();
    badge.textContent = text ? `${text} · READ ONLY` : 'READ ONLY';
  }

  function renderEmpty(context, month) {
    setText('payroll-live-title', monthLabel(month));
    setText('payroll-live-status', statusLabel(context?.month_status));
    setText('payroll-live-employees', '0명');
    setText('payroll-live-gross', '계산 전');
    setText('payroll-live-exceptions', '0건');
    setText('payroll-live-cutoff', '—');
    element('payroll-live-table-body').replaceChildren();
    element('payroll-live-empty').hidden = false;
    element('payroll-live-table-wrap').hidden = true;
  }

  function appendCell(row, value, className = '') {
    const cell = document.createElement('td');
    cell.textContent = value;
    if (className) cell.className = className;
    row.append(cell);
  }

  function renderEmployees(employees) {
    const body = element('payroll-live-table-body');
    body.replaceChildren();
    employees.forEach(employee => {
      const row = document.createElement('tr');
      appendCell(row, employee.employee_id || '—', 'payroll-id-cell');
      appendCell(row, employee.display_name || '—', 'payroll-name-cell');
      appendCell(row, hours(employee.actual_work_hours));
      appendCell(row, hours(employee.paid_holiday_hours));
      appendCell(
        row,
        hours(Number(employee.weekly_holiday_actual_hours || 0) + Number(employee.weekly_holiday_expected_hours || 0))
      );
      appendCell(row, hours(employee.payable_hours_preview));
      appendCell(row, money(employee.gross_pay_preview), 'payroll-money-cell');
      appendCell(
        row,
        Number(employee.unresolved_count || 0) > 0
          ? `확인 ${Number(employee.unresolved_count)}건`
          : rateStatusLabel(employee.rate_status),
        Number(employee.unresolved_count || 0) > 0 || employee.rate_status !== 'single_rate'
          ? 'payroll-review-cell'
          : 'payroll-ok-cell'
      );
      body.append(row);
    });
  }

  function render(context, month) {
    state.context = context;
    const run = context?.latest_run;
    const monthState = context?.month;
    const employees = Array.isArray(context?.employees) ? context.employees : [];

    if (!run) {
      renderEmpty(context, month);
      return;
    }

    setText('payroll-live-title', monthLabel(month));
    setText('payroll-live-status', statusLabel(context.month_status));
    setText('payroll-live-employees', `${employees.length}명`);
    setText(
      'payroll-live-gross',
      run.gross_pay_preview_status === 'complete' ? money(run.gross_pay_preview) : '검토 필요'
    );
    setText(
      'payroll-live-exceptions',
      `${Number(run.unresolved_item_count || 0) + Number(run.rate_review_count || 0)}건`
    );
    setText('payroll-live-cutoff', run.cutoff_date || monthState?.cutoff_date || '—');
    setText('payroll-live-run', run.id || '—');
    setText('payroll-live-version', run.calculation_version || '—');

    element('payroll-live-empty').hidden = true;
    element('payroll-live-table-wrap').hidden = false;
    renderEmployees(employees);
  }

  function friendlyError(error) {
    if (error?.status === 401) return '로그인 시간이 끝났습니다. 업무플랫폼에서 다시 로그인해 주세요.';
    if (error?.status === 403 || /PAYROLL_ACCESS_FORBIDDEN|FORBIDDEN/.test(error?.message || '')) {
      return '급여관리 권한이 없습니다. 운영총괄 계정으로 로그인해 주세요.';
    }
    return '급여 데이터를 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.';
  }

  async function loadMonth() {
    if (state.loading) return;
    state.loading = true;
    const button = element('payroll-live-refresh');
    button.disabled = true;
    setMessage('Staging 급여 데이터를 불러오고 있습니다.');

    try {
      const month = selectedMonth();
      const context = await rpc('get_payroll_operator_month_context', {
        p_payroll_month: `${month}-01`,
      });
      render(context, month);
      setMessage('Staging Shadow Payroll 데이터를 읽기 전용으로 표시하고 있습니다.');
    } catch (error) {
      setMessage(friendlyError(error), { error: true });
    } finally {
      state.loading = false;
      button.disabled = false;
    }
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const month = /^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month') : DEFAULT_MONTH;
    element('payroll-live-month').value = month;

    state.session = loadSession();
    if (!state.session) {
      setMessage('업무플랫폼 로그인이 필요합니다. 로그인 후 이 화면을 다시 열어 주세요.', { error: true });
      element('payroll-live-refresh').disabled = true;
      element('payroll-live-login').hidden = false;
      return;
    }

    try {
      state.config = await loadConfig();
      renderEnvironment();
      await loadMonth();
    } catch (error) {
      setMessage(friendlyError(error), { error: true });
    }
  }

  element('payroll-live-refresh')?.addEventListener('click', loadMonth);
  element('payroll-live-month')?.addEventListener('change', () => {
    const month = selectedMonth();
    const url = new URL(window.location.href);
    url.searchParams.set('month', month);
    window.history.replaceState(null, '', url);
    loadMonth();
  });

  init();
})();
