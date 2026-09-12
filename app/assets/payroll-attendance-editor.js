(() => {
  'use strict';

  const SESSION_KEY = 'taejang-staff-session-v1';
  const state = {
    config: null,
    session: null,
    context: null,
    selectedDate: null,
    cells: new Map(),
    dirty: new Set(),
    loading: false,
    excelFile: null,
  };

  const el = id => document.getElementById(id);
  const keyOf = (employeeUuid, workDate) => `${employeeUuid}|${workDate}`;

  function selectedMonth() {
    return el('payroll-live-month')?.value || '2026-08';
  }

  function monthStart() { return `${selectedMonth()}-01`; }

  function monthEnd(month = selectedMonth()) {
    const [year, monthNumber] = month.split('-').map(Number);
    const date = new Date(year, monthNumber, 0, 12, 0, 0);
    return `${year}-${String(monthNumber).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function localToday() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function cutoffForMonth() {
    const month = selectedMonth();
    const today = localToday();
    const todayMonth = today.slice(0, 7);
    if (month < todayMonth) return monthEnd(month);
    if (month === todayMonth) return today;
    return `${month}-01`;
  }

  function safeDateForMonth(value) {
    const month = selectedMonth();
    if (value && value.startsWith(`${month}-`)) return value;
    const today = localToday();
    if (today.startsWith(`${month}-`)) return today;
    return `${month}-01`;
  }

  function loadSession() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      return parsed?.access_token ? parsed : null;
    } catch { return null; }
  }

  async function loadConfig() {
    const response = await fetch('/.netlify/functions/staff-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('CONFIG_UNAVAILABLE');
    const config = await response.json();
    if (!config.url || !config.publishableKey) throw new Error('CONFIG_INCOMPLETE');
    return config;
  }

  async function refreshSession() {
    if (!state.session?.refresh_token) return false;
    const response = await fetch(`${state.config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: state.config.publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: state.session.refresh_token }),
    });
    if (!response.ok) return false;
    state.session = await response.json();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
    return true;
  }

  async function request(path, body, retry = true) {
    const response = await fetch(`${state.config.url}${path}`, {
      method: 'POST',
      headers: {
        apikey: state.config.publishableKey,
        Authorization: `Bearer ${state.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 401 && retry && await refreshSession()) return request(path, body, false);
    if (!response.ok) {
      const error = new Error(payload?.message || payload?.msg || payload?.error_description || `REQUEST_${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function rpc(name, body) {
    return request(`/rest/v1/rpc/${name}`, body);
  }

  function setMessage(text, stateName = 'normal') {
    const node = el('payroll-attendance-editor-message');
    if (!node) return;
    node.hidden = !text;
    node.textContent = text || '';
    node.dataset.state = stateName;
  }

  function statusFromImported(row) {
    const decision = String(row?.auto_decision || '');
    if (decision === 'actual_scheduled') return 'work';
    if (decision === 'paid_leave') return 'paid_leave';
    if (decision === 'unpaid_absence') return 'unpaid_absence';
    if (decision === 'paid_holiday') return 'paid_holiday';
    if (decision === 'termination' || decision === 'out_of_scope') return 'off';
    if (decision === 'confirmed_correction') return 'work';
    return 'review_required';
  }

  function sourceLabel(source) {
    if (source === 'xlsx_prefill') return 'Excel';
    if (source === 'xlsx_post_edit') return '수정';
    if (source === 'manual_ui') return '직접입력';
    if (source === 'existing_import') return '기존원본';
    return '미입력';
  }

  function sourceClass(source) {
    return source ? `source-${String(source).replace(/_/g, '-')}` : 'source-empty';
  }

  function currentTerm(employeeUuid, workDate) {
    return (state.context?.terms || [])
      .filter(term => term.employee_uuid === employeeUuid)
      .filter(term => String(term.effective_from) <= workDate)
      .filter(term => !term.effective_to || String(term.effective_to) >= workDate)
      .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0] || null;
  }

  function baseCell(employee, workDate) {
    return {
      employeeUuid: employee.employee_uuid,
      employeeId: employee.employee_id,
      name: employee.name,
      workDate,
      status: '',
      clockIn: '',
      clockOut: '',
      confirmedHours: '',
      sourceKind: '',
      sourceFileName: '',
      sourceSheet: '',
      sourceRowNumber: null,
      sourceAttendanceRowId: null,
      originalSourceKind: '',
    };
  }

  function rebuildModel() {
    state.cells = new Map();
    state.dirty = new Set();
    const context = state.context || {};
    const employees = Array.isArray(context.employees) ? context.employees : [];

    for (const row of context.imported_rows || []) {
      if (!row.employee_uuid || !row.work_date) continue;
      const employee = employees.find(item => item.employee_uuid === row.employee_uuid);
      if (!employee) continue;
      const cell = baseCell(employee, row.work_date);
      Object.assign(cell, {
        status: statusFromImported(row),
        clockIn: row.clock_in_raw || '',
        clockOut: row.clock_out_raw || '',
        confirmedHours: row.confirmed_hours ?? '',
        sourceKind: 'existing_import',
        originalSourceKind: 'existing_import',
        sourceAttendanceRowId: row.attendance_row_id || null,
      });
      state.cells.set(keyOf(cell.employeeUuid, cell.workDate), cell);
    }

    for (const row of context.manual_entries || []) {
      if (!row.employee_uuid || !row.work_date) continue;
      const employee = employees.find(item => item.employee_uuid === row.employee_uuid);
      if (!employee) continue;
      const cell = baseCell(employee, row.work_date);
      Object.assign(cell, {
        status: row.attendance_status || '',
        clockIn: row.clock_in_raw || '',
        clockOut: row.clock_out_raw || '',
        confirmedHours: row.confirmed_hours ?? '',
        sourceKind: row.source_kind || 'manual_ui',
        originalSourceKind: row.source_kind || 'manual_ui',
        sourceFileName: row.source_file_name || '',
        sourceSheet: row.source_sheet || '',
        sourceRowNumber: row.source_row_number || null,
        sourceAttendanceRowId: row.source_attendance_row_id || null,
      });
      state.cells.set(keyOf(cell.employeeUuid, cell.workDate), cell);
    }
  }

  function employeeActiveOn(employee, workDate) {
    if (employee.hired_on && String(employee.hired_on) > workDate) return false;
    if (employee.departed_on && String(employee.departed_on) < workDate) return false;
    return true;
  }

  function getCell(employee, workDate) {
    const key = keyOf(employee.employee_uuid, workDate);
    if (!state.cells.has(key)) state.cells.set(key, baseCell(employee, workDate));
    return state.cells.get(key);
  }

  function dirtySource(cell) {
    if (cell.originalSourceKind === 'xlsx_prefill' || cell.sourceKind === 'xlsx_prefill') return 'xlsx_post_edit';
    if (cell.originalSourceKind === 'existing_import') return 'manual_ui';
    if (cell.originalSourceKind === 'xlsx_post_edit') return 'xlsx_post_edit';
    return cell.sourceKind || 'manual_ui';
  }

  function markChanged(cell, field, value) {
    cell[field] = value;
    cell.sourceKind = dirtySource(cell);
    state.dirty.add(keyOf(cell.employeeUuid, cell.workDate));
    renderSummary();
  }

  function statusOptions(value) {
    const options = [
      ['', '선택'],
      ['work', '근무'],
      ['paid_leave', '유급휴가'],
      ['unpaid_absence', '결근'],
      ['paid_holiday', '유급공휴일'],
      ['off', '휴무'],
      ['review_required', '확인 필요'],
    ];
    return options.map(([key, label]) => `<option value="${key}"${key === value ? ' selected' : ''}>${label}</option>`).join('');
  }

  function renderTable() {
    const tbody = el('payroll-attendance-editor-body');
    if (!tbody || !state.context) return;
    const workDate = state.selectedDate;
    tbody.innerHTML = '';
    for (const employee of state.context.employees || []) {
      if (!employeeActiveOn(employee, workDate)) continue;
      const cell = getCell(employee, workDate);
      const term = currentTerm(employee.employee_uuid, workDate);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${employee.employee_id || '—'}</td>
        <td class="payroll-attendance-name">${employee.name || '—'}</td>
        <td><select data-field="status">${statusOptions(cell.status)}</select></td>
        <td><input data-field="clockIn" type="time" value="${cell.clockIn || ''}" aria-label="${employee.name} 출근"></td>
        <td><input data-field="clockOut" type="time" value="${cell.clockOut || ''}" aria-label="${employee.name} 퇴근"></td>
        <td><input data-field="confirmedHours" type="number" min="0" max="24" step="0.25" value="${cell.confirmedHours ?? ''}" placeholder="${term?.daily_scheduled_hours ?? ''}" aria-label="${employee.name} 인정시간"></td>
        <td><span class="payroll-source-badge ${sourceClass(cell.sourceKind)}">${sourceLabel(cell.sourceKind)}</span></td>`;
      tr.querySelectorAll('[data-field]').forEach(input => {
        input.addEventListener('change', () => markChanged(cell, input.dataset.field, input.value));
      });
      tbody.appendChild(tr);
    }
    renderSummary();
  }

  function renderSummary(extra = '') {
    const node = el('payroll-attendance-editor-summary');
    if (!node) return;
    const date = state.selectedDate || '—';
    const rows = Array.from(state.cells.values()).filter(cell => cell.workDate === date && cell.status);
    const review = rows.filter(cell => cell.status === 'review_required').length;
    const parts = [`${date}`, `입력 ${rows.length}명`, `변경 ${state.dirty.size}건`];
    if (review) parts.push(`확인 ${review}건`);
    if (extra) parts.push(extra);
    node.textContent = parts.join(' · ');
  }

  function changeDate(days) {
    const date = new Date(`${state.selectedDate}T12:00:00`);
    date.setDate(date.getDate() + days);
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (!next.startsWith(`${selectedMonth()}-`)) return;
    state.selectedDate = next;
    el('payroll-attendance-date').value = next;
    renderTable();
  }

  function allExcelRows(best) {
    const helper = window.TaejangPayrollAttendanceXlsx;
    const matrix = best?.matrix;
    const analysis = best?.analysis;
    if (!helper || !Array.isArray(matrix) || !analysis?.ok) return [];
    const mapping = analysis.mapping || {};
    const result = [];
    for (let index = Number(analysis.headerRow || 1); index < matrix.length; index += 1) {
      const row = Array.isArray(matrix[index]) ? matrix[index] : [];
      if (row.every(value => value == null || String(value).trim() === '')) continue;
      const employeeId = mapping.employeeId == null ? '' : String(row[mapping.employeeId] ?? '').trim();
      const name = mapping.name == null ? '' : String(row[mapping.name] ?? '').trim();
      const date = helper.normalizeDateCell(row[mapping.date]);
      const clockIn = mapping.clockIn == null ? null : helper.normalizeTimeCell(row[mapping.clockIn]);
      const clockOut = mapping.clockOut == null ? null : helper.normalizeTimeCell(row[mapping.clockOut]);
      result.push({ sourceRow: index + 1, employeeId, name, date, clockIn, clockOut });
    }
    return result;
  }

  async function fillFromExcel(file) {
    if (!file || !/\.xlsx$/i.test(file.name || '')) return;
    const helper = window.TaejangPayrollAttendanceXlsx;
    if (!helper?.parseXlsxFile) return;
    setMessage('Excel을 근태표에 채우는 중입니다…');
    try {
      const workbook = await helper.parseXlsxFile(file);
      const best = workbook.best;
      if (!best?.analysis?.ok) throw new Error('근태 헤더를 찾지 못했습니다');
      const employees = state.context?.employees || [];
      const byId = new Map(employees.map(employee => [String(employee.employee_id || '').trim(), employee]));
      const byName = new Map(employees.map(employee => [String(employee.name || '').trim(), employee]));
      let filled = 0;
      let unmatched = 0;
      let outsideMonth = 0;
      const seen = new Set();
      let duplicates = 0;
      for (const row of allExcelRows(best)) {
        if (!row.date || !row.date.startsWith(`${selectedMonth()}-`)) { outsideMonth += 1; continue; }
        const employee = (row.employeeId && byId.get(row.employeeId)) || (row.name && byName.get(row.name));
        if (!employee) { unmatched += 1; continue; }
        const key = keyOf(employee.employee_uuid, row.date);
        if (seen.has(key)) duplicates += 1;
        seen.add(key);
        const cell = getCell(employee, row.date);
        Object.assign(cell, {
          status: row.clockIn || row.clockOut ? 'work' : 'review_required',
          clockIn: row.clockIn || '',
          clockOut: row.clockOut || '',
          confirmedHours: '',
          sourceKind: 'xlsx_prefill',
          originalSourceKind: 'xlsx_prefill',
          sourceFileName: file.name,
          sourceSheet: best.sheetName,
          sourceRowNumber: row.sourceRow,
        });
        state.dirty.add(key);
        filled += 1;
      }
      state.excelFile = file;
      renderTable();
      const notes = [`Excel ${filled}건 채움`];
      if (unmatched) notes.push(`직원 미매칭 ${unmatched}건`);
      if (duplicates) notes.push(`중복일자 ${duplicates}건`);
      if (outsideMonth) notes.push(`다른 월 ${outsideMonth}건 제외`);
      setMessage(`${notes.join(' · ')}. 저장 전 화면에서 수정할 수 있습니다.`, unmatched || duplicates ? 'review' : 'ok');
      renderSummary(notes[0]);
    } catch (error) {
      setMessage(`Excel 자동채움 실패: ${error.message || '파일 확인 필요'}`, 'error');
    }
  }

  function serializeDirty() {
    const entries = [];
    for (const key of state.dirty) {
      const cell = state.cells.get(key);
      if (!cell || !cell.status) continue;
      const value = cell.confirmedHours === '' || cell.confirmedHours == null ? null : Number(cell.confirmedHours);
      entries.push({
        employee_uuid: cell.employeeUuid,
        work_date: cell.workDate,
        attendance_status: cell.status,
        clock_in_raw: cell.clockIn || null,
        clock_out_raw: cell.clockOut || null,
        confirmed_hours: Number.isFinite(value) ? value : null,
        source_kind: cell.sourceKind || 'manual_ui',
        source_file_name: cell.sourceFileName || null,
        source_sheet: cell.sourceSheet || null,
        source_row_number: cell.sourceRowNumber || null,
        source_attendance_row_id: cell.sourceAttendanceRowId || null,
        reason: cell.sourceKind === 'xlsx_post_edit' ? 'Excel 자동채움 후 화면 수정' : null,
      });
    }
    return entries;
  }

  function clearSavedDirty(entries) {
    for (const entry of entries || []) {
      state.dirty.delete(keyOf(entry.employee_uuid, entry.work_date));
    }
    renderSummary();
  }

  function setEditorBusy(busy) {
    for (const control of document.querySelectorAll('#payroll-attendance-editor [data-field], #payroll-attendance-file')) {
      control.disabled = busy;
    }
    for (const id of ['payroll-attendance-save', 'payroll-attendance-recalculate']) {
      const button = el(id);
      if (button) button.disabled = busy;
    }
  }

  async function recalculate(context) {
    const batchId = context?.accepted_batch_id;
    if (!batchId) throw new Error('근태 저장 후 계산 기준을 찾지 못했습니다');
    return request('/functions/v1/payroll-calculate', {
      payroll_month: monthStart(),
      cutoff_date: cutoffForMonth(),
      accepted_import_batch_id: batchId,
      request_id: `attendance-editor-${Date.now()}`,
    });
  }

  async function saveChanges() {
    if (state.loading) return;
    const entries = serializeDirty();
    if (!entries.length) {
      setMessage('저장할 변경사항이 없습니다. 상태를 먼저 선택해 주세요.', 'review');
      return;
    }
    state.loading = true;
    setEditorBusy(true);
    setMessage(`${entries.length}건 저장 중…`);

    let saved;
    try {
      saved = await rpc('save_payroll_attendance_manual_entries', {
        p_payroll_month: monthStart(),
        p_entries: entries,
      });
    } catch (error) {
      setMessage(`근태 저장 실패: ${error.message || '확인 필요'}`, 'error');
      state.loading = false;
      setEditorBusy(false);
      return;
    }

    const savedCount = Number(saved?.saved_count || entries.length);
    // The attendance write has completed. Never leave these same entries dirty
    // merely because the later, independent payroll calculation has a problem.
    clearSavedDirty(entries);
    setMessage(`근태 ${savedCount}건은 저장되었습니다. 급여 가안을 다시 계산하는 중…`, 'ok');

    try {
      await loadContext({ preserveDate: true, quiet: true });
      const calculated = await recalculate(state.context);
      const resultState = calculated?.status === 'review_required' ? 'review' : 'ok';
      setMessage(`${savedCount}건 저장 완료 · 급여 가안 재계산 완료${calculated?.status === 'review_required' ? ' · 확인 필요 항목 있음' : ''}`, resultState);
      document.getElementById('payroll-live-refresh')?.click();
    } catch (error) {
      setMessage(`근태 ${savedCount}건은 저장되었습니다. 급여 가안 재계산에 실패했습니다: ${error.message || '확인 필요'}. 아래 ‘급여 가안 다시 계산’으로 다시 시도할 수 있습니다.`, 'review');
    } finally {
      state.loading = false;
      setEditorBusy(false);
    }
  }

  async function retryCalculation() {
    if (state.loading) return;
    if (state.dirty.size) {
      setMessage(`저장하지 않은 근태 변경 ${state.dirty.size}건이 있습니다. 먼저 저장한 뒤 급여 가안을 계산해 주세요.`, 'review');
      return;
    }
    state.loading = true;
    setEditorBusy(true);
    setMessage('저장된 근태로 급여 가안을 다시 계산하는 중…');
    try {
      await loadContext({ preserveDate: true, quiet: true });
      const calculated = await recalculate(state.context);
      const resultState = calculated?.status === 'review_required' ? 'review' : 'ok';
      setMessage(`급여 가안 재계산 완료${calculated?.status === 'review_required' ? ' · 확인 필요 항목 있음' : ''}`, resultState);
      document.getElementById('payroll-live-refresh')?.click();
    } catch (error) {
      setMessage(`급여 가안 재계산에 실패했습니다: ${error.message || '확인 필요'}. 저장된 근태는 그대로 유지됩니다.`, 'review');
    } finally {
      state.loading = false;
      setEditorBusy(false);
    }
  }

  async function loadContext({ preserveDate = false, quiet = false } = {}) {
    if (!state.session || !state.config) return;
    if (!quiet) setMessage('근태 입력표를 불러오는 중…');
    const context = await rpc('get_payroll_attendance_editor_context', { p_payroll_month: monthStart() });
    state.context = context;
    state.selectedDate = safeDateForMonth(preserveDate ? state.selectedDate : el('payroll-attendance-date')?.value);
    rebuildModel();
    const dateInput = el('payroll-attendance-date');
    if (dateInput) {
      dateInput.min = `${selectedMonth()}-01`;
      dateInput.max = monthEnd();
      dateInput.value = state.selectedDate;
    }
    renderTable();
    if (!quiet) setMessage('직접 입력이 기본입니다. Excel을 선택하면 같은 표에 자동으로 채워지고 다시 수정할 수 있습니다.', 'ok');
  }

  function bindEvents() {
    el('payroll-attendance-date')?.addEventListener('change', event => {
      state.selectedDate = safeDateForMonth(event.target.value);
      renderTable();
    });
    el('payroll-attendance-prev')?.addEventListener('click', () => changeDate(-1));
    el('payroll-attendance-next')?.addEventListener('click', () => changeDate(1));
    el('payroll-attendance-save')?.addEventListener('click', saveChanges);
    el('payroll-attendance-recalculate')?.addEventListener('click', retryCalculation);
    el('payroll-live-month')?.addEventListener('change', () => loadContext().catch(error => setMessage(error.message, 'error')));
    el('payroll-attendance-file')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (file) fillFromExcel(file);
    });
  }

  async function init() {
    const root = el('payroll-attendance-editor');
    if (!root) return;
    try {
      state.config = await loadConfig();
      state.session = loadSession();
      if (!state.session) {
        setMessage('로그인 후 근태를 입력할 수 있습니다.', 'review');
        return;
      }
      bindEvents();
      await loadContext();
    } catch (error) {
      setMessage(`근태 입력표를 열지 못했습니다: ${error.message || '확인 필요'}`, 'error');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
