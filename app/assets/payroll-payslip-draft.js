(() => {
  'use strict';

  const SESSION_KEY = 'taejang-staff-session-v1';
  const state = { config: null, session: null, loading: false };
  const el = id => document.getElementById(id);
  const query = new URLSearchParams(window.location.search);
  const month = String(query.get('month') || '');
  const employeeUuid = String(query.get('employee') || '');

  function money(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${Math.round(number).toLocaleString('ko-KR')}원` : '검토 필요';
  }

  function hours(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}시간` : '—';
  }

  function dateLabel(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}.${match[2]}.${match[3]}` : '—';
  }

  function dateTimeLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function setMessage(message, error = false) {
    const node = el('payslip-message');
    node.hidden = !message;
    node.textContent = message || '';
    node.dataset.state = error ? 'error' : 'normal';
  }

  function loadSession() {
    try {
      const persistent = localStorage.getItem(SESSION_KEY);
      if (persistent) {
        const parsed = JSON.parse(persistent);
        return parsed?.access_token ? parsed : null;
      }
      const legacy = sessionStorage.getItem(SESSION_KEY);
      if (!legacy) return null;
      const parsed = JSON.parse(legacy);
      if (!parsed?.access_token) return null;
      localStorage.setItem(SESSION_KEY, legacy);
      sessionStorage.removeItem(SESSION_KEY);
      return parsed;
    } catch { return null; }
  }

  function saveSession(session) {
    state.session = session;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    sessionStorage.removeItem(SESSION_KEY);
  }

  function clearSession() {
    state.session = null;
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  }

  async function loadConfig() {
    const response = await fetch('/.netlify/functions/staff-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('CONFIG_UNAVAILABLE');
    const config = await response.json();
    if (!config.url || !config.publishableKey) throw new Error('CONFIG_INCOMPLETE');
    return config;
  }

  async function request(name, body) {
    const response = await fetch(`${state.config.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: state.config.publishableKey,
        Authorization: `Bearer ${state.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.message || `REQUEST_${response.status}`);
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

  async function rpc(name, body) {
    try {
      return await request(name, body);
    } catch (error) {
      if (error.status === 401 && await refreshSession()) return request(name, body);
      throw error;
    }
  }

  function appendItem(list, label, value) {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const definition = document.createElement('dd');
    term.textContent = label;
    definition.textContent = value;
    row.append(term, definition);
    list.append(row);
  }

  function reviewLabel(reason) {
    return {
      unresolved_attendance: '미해결 근태 항목이 있어 금액을 확정할 수 없습니다.',
      weekly_holiday_pending: '주휴 계산에 필요한 근태 확인이 남아 있습니다.',
      rate_review_required: '적용 시급 또는 급여조건 확인이 필요합니다.',
      gross_pay_review_required: '총지급 가안을 표시할 수 없습니다.',
      statutory_deduction_review_required: '법정공제 기준 확인이 필요합니다.',
    }[reason] || '계산 결과를 추가로 확인해 주세요.';
  }

  function render(data) {
    const employee = data.employee || {};
    const totals = data.totals || {};
    const work = data.work_summary || {};
    el('payslip-title').textContent = `${String(data.payroll_month || '').slice(0, 7).replace('-', '년 ')}월 급여명세서 초안`;
    el('payslip-employee').textContent = `${employee.display_name || '직원'} · ${employee.employee_id || '사번 확인'}`;
    el('payslip-status').textContent = data.status === 'draft_ready' ? '초안 확인 가능' : '검토 필요';
    el('payslip-gross').textContent = money(totals.gross_pay_preview);
    el('payslip-deductions-total').textContent = money(totals.statutory_deduction_preview);
    el('payslip-net').textContent = money(totals.net_pay_preview);

    const meta = el('payslip-meta');
    meta.replaceChildren();
    appendItem(meta, '급여월', dateLabel(data.payroll_month));
    appendItem(meta, '계산 기준일', dateLabel(data.run?.cutoff_date));
    appendItem(meta, '계산 시각', dateTimeLabel(data.run?.generated_at));
    appendItem(meta, '계산 run', data.run?.id || '—');

    const workList = el('payslip-work');
    workList.replaceChildren();
    appendItem(workList, '실근로', hours(work.actual_work_hours));
    appendItem(workList, '예정근로', hours(work.expected_work_hours));
    appendItem(workList, '유급휴일', hours(work.paid_holiday_hours));
    appendItem(workList, '주휴 실제시간', hours(work.weekly_holiday_actual_hours));
    appendItem(workList, '주휴 예정시간', hours(work.weekly_holiday_expected_hours));
    appendItem(workList, '주휴 검토 주수', work.weekly_holiday_pending_weeks ?? '—');
    appendItem(workList, '지급대상 시간', hours(work.payable_hours_preview));

    const earnings = el('payslip-earnings');
    earnings.replaceChildren();
    (Array.isArray(data.earnings) ? data.earnings : []).forEach(item => appendItem(earnings, item.label || '지급 가안', money(item.amount)));
    const deductions = el('payslip-deductions');
    deductions.replaceChildren();
    (Array.isArray(data.deductions) ? data.deductions : []).forEach(item => appendItem(deductions, item.label || '공제 가안', money(item.amount)));

    el('payslip-notice').textContent = data.notice || '급여명세서 초안입니다.';
    const reasons = el('payslip-review-reasons');
    reasons.replaceChildren();
    (Array.isArray(data.review_reasons) ? data.review_reasons : []).forEach(reason => {
      const item = document.createElement('li');
      item.textContent = reviewLabel(reason);
      reasons.append(item);
    });
    el('payslip-content').hidden = false;
  }

  function friendlyError(error) {
    if (error?.status === 401) return '로그인 시간이 끝났습니다. 업무플랫폼에서 다시 로그인해 주세요.';
    if (error?.status === 403 || /PAYROLL_ACCESS_FORBIDDEN/.test(error?.message || '')) return '개인 급여명세서 초안 열람 권한이 없습니다. 운영총괄 계정으로 로그인해 주세요.';
    if (/PAYROLL_DRAFT_RUN_REQUIRED|PAYROLL_EMPLOYEE_RESULT_NOT_FOUND/.test(error?.message || '')) return '이 직원의 저장된 급여 가안이 없습니다.';
    return '급여명세서 초안을 불러오지 못했습니다. 급여대장에서 다시 선택해 주세요.';
  }

  async function load() {
    if (state.loading) return;
    if (!/^\d{4}-\d{2}$/.test(month) || !/^[0-9a-f-]{36}$/i.test(employeeUuid)) {
      setMessage('급여대장에서 직원의 명세서 초안 버튼을 다시 선택해 주세요.', true);
      return;
    }
    state.loading = true;
    el('payslip-refresh').disabled = true;
    setMessage('저장된 급여 계산 결과를 불러오는 중입니다.');
    try {
      render(await rpc('get_payroll_employee_payslip_draft', {
        p_payroll_month: `${month}-01`, p_employee_uuid: employeeUuid,
      }));
      setMessage('개인 급여명세서 초안입니다. 이 화면에서는 재계산·발송·지급을 실행하지 않습니다.');
    } catch (error) {
      setMessage(friendlyError(error), true);
    } finally {
      state.loading = false;
      el('payslip-refresh').disabled = false;
    }
  }

  async function init() {
    el('payslip-back').href = `./live.html?month=${encodeURIComponent(month)}`;
    state.session = loadSession();
    if (!state.session) {
      el('payslip-login').hidden = false;
      setMessage('로그인 후 개인 급여명세서 초안을 열 수 있습니다.', true);
      return;
    }
    try {
      state.config = await loadConfig();
      el('payslip-environment').textContent = state.config.environmentLabel || '업무플랫폼';
      await load();
    } catch (error) { setMessage(friendlyError(error), true); }
  }

  el('payslip-refresh').addEventListener('click', () => { void load(); });
  void init();
})();
