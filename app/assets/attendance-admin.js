(() => {
  'use strict';

  const legacyAllowed = new Set(['promotion_lead', 'operations_manager']);
  const EVIDENCE_SOURCE = 'fingerprint_excel';
  const ALIGNMENT_TOLERANCE_MINUTES = 5;
  let currentWorkDate = null;
  let requestVersion = 0;
  let activeTab = 'daily';
  const filters = { search: '', reviewOnly: false, accounts: 'normal', department: '', job: '', group: '', leader: '', employment: '', attendance: '' };

  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const can = capability => app()?.hasCapabilityContract?.()
    ? Boolean(app()?.can?.(capability))
    : legacyAllowed.has(route());
  const main = () => document.getElementById('dashboard-main');
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };
  const time = value => value ? new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul'
  }).format(new Date(value)) : '-';
  const good = record => Boolean(record?.event_at)
    && !['exception_pending', 'exception_rejected', 'correction_invalidated'].includes(record?.status);
  const statusText = record => {
    if (!record) return '미처리';
    if (record.status === 'recorded') return 'GPS 확인';
    if (record.status === 'exception_approved') return '관리자 승인';
    if (record.status === 'exception_pending') return '확인 필요';
    if (record.status === 'exception_rejected') return '반려';
    if (record.status === 'corrected') return '관리자 보정';
    if (record.status === 'correction_invalidated') return '무효 처리';
    return record.status;
  };

  const DAY_STATUS_LABELS = Object.freeze({
    work: '정상 근무',
    paid_leave: '유급휴가·월차',
    unpaid_absence: '무급 결근',
    paid_holiday: '유급공휴일',
    off: '근무대상 아님',
    review_required: '상태 확인 필요',
  });
  const dayStatusCode = row => row?.attendance_status?.status || 'work';
  const dayStatusLabel = value => DAY_STATUS_LABELS[value] || '상태 확인 필요';

  function injectStyles() {
    if (document.querySelector('style[data-attendance-admin]')) return;
    const style = document.createElement('style');
    style.dataset.attendanceAdmin = '1';
    style.textContent = `
      .attendance-tabs{display:flex;gap:8px;margin:12px 0;flex-wrap:wrap}
      .attendance-tabs [aria-pressed="true"]{background:#2f6b57;color:white}
      .attendance-compact{border-bottom:1px solid #d9e1dd;padding:8px 12px;background:white}
      .attendance-compact summary{cursor:pointer;display:flex;gap:12px;align-items:center;flex-wrap:wrap;min-height:40px}
      .attendance-compact summary strong{min-width:130px}
      .attendance-compact[data-review="true"]{border-left:4px solid #a56400}
      .attendance-table-wrap{overflow:auto;max-height:65vh;border:1px solid #c8d5cd;position:relative}
      .attendance-matrix{border-collapse:separate;border-spacing:0;font-size:13px;background:white}
      .attendance-matrix th,.attendance-matrix td{border-bottom:1px solid #ddd;border-right:1px solid #ddd;padding:8px;min-width:110px;vertical-align:top}
      .attendance-matrix thead th{position:sticky;top:0;z-index:2;background:#edf5ef}
      .attendance-matrix th:first-child{position:sticky;left:0;z-index:1;background:#edf5ef;min-width:140px}
      .attendance-matrix thead th:first-child{z-index:3}
      .attendance-matrix td[data-review="true"]{background:#fff4dc}
      .attendance-matrix td span{display:block;white-space:nowrap}
      .attendance-detail-tools{margin:12px 0;border:1px solid #c8d5cd;border-radius:10px;padding:10px}
      .attendance-detail-tools>summary{cursor:pointer;font-weight:800;min-height:32px}
      .attendance-toolbar input:not([type=checkbox]),.attendance-toolbar select{min-height:40px;max-width:100%;font:inherit;padding:6px}
      .attendance-toolbar input[type=checkbox]{width:18px;min-height:18px;height:18px}
      .attendance-summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:18px 0; }
      .attendance-summary article { padding:16px; border:1px solid var(--app-border); border-radius:14px; background:#fff; }
      .attendance-summary strong { display:block; margin-top:6px; font-size:28px; }
      .attendance-toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:end; margin:16px 0; padding:14px; border:1px solid var(--app-border); border-radius:14px; background:#fff; }
      .attendance-toolbar label { display:grid; gap:6px; font-weight:800; }
      .attendance-toolbar input[type="date"] { min-height:42px; padding:7px 10px; border:1px solid #ccc; border-radius:10px; font:inherit; }
      .attendance-evidence-help { flex:1 1 260px; margin:0; color:#60746a; font-size:13px; line-height:1.5; }
      .attendance-list { display:grid; gap:10px; }
      .attendance-row { display:grid; grid-template-columns:minmax(120px,1.15fr) 1fr 1fr minmax(150px,.9fr); gap:12px; align-items:center; padding:14px; border:1px solid var(--app-border); border-radius:14px; background:#fff; }
      .attendance-person { font-size:18px; font-weight:900; }
      .attendance-day-status { display:grid; gap:6px; margin-top:9px; font-size:13px; font-weight:700; }
      .attendance-day-status select { width:100%; min-height:38px; padding:6px 8px; border:1px solid #c8d5cd; border-radius:8px; background:#fff; font:inherit; }
      .attendance-day-status .button { width:100%; min-height:36px; padding:6px 9px; }
      .attendance-day-status-note { color:#60746a; font-size:12px; line-height:1.4; font-weight:600; }
      .attendance-cell { font-size:15px; line-height:1.45; }
      .attendance-cell strong { display:block; font-size:17px; }
      .attendance-evidence-line { display:block; margin-top:4px; color:#60746a; font-size:13px; }
      .attendance-compare { font-size:14px; font-weight:800; line-height:1.45; }
      .attendance-compare[data-review="true"] { color:#9a5c09; }
      .attendance-review-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
      .attendance-unmatched { margin:14px 0; padding:14px; border:1px solid #e2c68d; border-radius:14px; background:#fff8e9; }
      .attendance-unmatched-list { display:grid; gap:10px; margin-top:10px; }
      .attendance-unmatched-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
      .attendance-unmatched-row select { min-height:38px; padding:6px 8px; }
      .attendance-confirmation { margin:14px 0; padding:16px; border:1px solid #aac7b4; border-radius:14px; background:#f5fbf6; }
      .attendance-confirmation[data-confirmed="true"] { border-color:#7da88c; background:#edf8ef; }
      .attendance-confirmation[data-blocked="true"] { border-color:#e2c68d; background:#fff8e9; }
      .attendance-confirmation h3 { margin:0; }
      .attendance-confirmation p { margin:8px 0; line-height:1.5; }
      .attendance-confirmation-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
      .attendance-confirmation-blockers { display:grid; gap:8px; margin:12px 0 0; padding:0; list-style:none; }
      .attendance-confirmation-blockers li { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:9px 10px; border-radius:10px; background:#fff; }
      .attendance-confirmation-blockers [data-resolved="true"] { opacity:.72; }
      .attendance-ledger { margin:14px 0; padding:16px; border:1px solid #c8d5cd; border-radius:14px; background:#fff; }
      .attendance-ledger h3 { margin:0; }
      .attendance-ledger-controls { display:flex; flex-wrap:wrap; gap:10px; align-items:end; margin:12px 0; }
      .attendance-ledger-controls label { display:grid; gap:6px; font-weight:800; }
      .attendance-ledger-controls input[type="date"] { min-height:40px; padding:7px 10px; border:1px solid #ccc; border-radius:10px; font:inherit; }
      .attendance-ledger-controls label:last-of-type { display:flex; align-items:center; gap:7px; min-height:40px; font-weight:700; }
      .attendance-ledger-results { display:grid; gap:8px; margin-top:12px; }
      .attendance-ledger-row { padding:10px; border:1px solid var(--app-border); border-radius:10px; background:#fbfdfb; line-height:1.45; }
      .attendance-ledger-row[data-reopened="true"] { background:#fff8e9; border-color:#e2c68d; }
      .attendance-ledger-row strong { display:block; }
      .attendance-holiday-work { margin:14px 0; padding:16px; border:1px solid #e2c68d; border-radius:14px; background:#fff8e9; }
      .attendance-holiday-work h3 { margin:0; }
      .attendance-holiday-work p { margin:8px 0 12px; line-height:1.5; }
      .attendance-holiday-work-list { display:grid; gap:8px; }
      .attendance-holiday-work-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 12px; border-radius:10px; background:#fff; }
      .attendance-holiday-work-row strong { display:block; }
      .attendance-holiday-work-row span { color:#60746a; font-size:13px; }
      .attendance-sync-required { margin:14px 0; padding:14px; border:1px solid #e2c68d; border-radius:14px; background:#fff8e9; line-height:1.5; }
      .attendance-sync-required h3,.attendance-sync-required p { margin:0; }
      .attendance-sync-required p { margin-top:7px; }
      @media(max-width:900px){.attendance-row{grid-template-columns:1fr 1fr}.attendance-person{grid-column:1/-1}}
      @media(max-width:720px){.attendance-summary{grid-template-columns:repeat(2,1fr)}.attendance-row{grid-template-columns:1fr}.attendance-cell,.attendance-compare{padding-top:8px;border-top:1px solid #eee}.attendance-toolbar{display:grid;grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function closeSidebar() {
    document.getElementById('desktop-app-shell')?.classList.remove('sidebar-open');
    document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  }

  async function review(eventId, approve, button) {
    if (!can('attendance.exception_review')) return;
    button.disabled = true;
    try {
      const result = await app().rpc('review_attendance_exception', { p_event_id: eventId, p_approve: approve });
      if (!result?.ok) throw new Error(result?.code || 'REVIEW_FAILED');
      await openAttendance(currentWorkDate);
    } catch {
      button.disabled = false;
      window.alert('출근부 확인을 처리하지 못했습니다.');
    }
  }

  function reviewButtons(record) {
    if (!can('attendance.exception_review') || !record || record.status !== 'exception_pending') return null;
    const wrap = el('div', null, 'attendance-review-actions');
    const approve = el('button', '승인', 'button'); approve.type = 'button';
    const reject = el('button', '반려', 'button button-quiet'); reject.type = 'button';
    approve.addEventListener('click', () => review(record.id, true, approve));
    reject.addEventListener('click', () => review(record.id, false, reject));
    wrap.append(approve, reject);
    return wrap;
  }

  function cell(label, record, fingerprintValue) {
    const box = el('div', null, 'attendance-cell');
    box.append(
      el('span', label, 'eyebrow'),
      el('strong', `${time(record?.event_at || record?.requested_at)} · ${statusText(record)}`)
    );
    box.append(el('span', `지문 ${time(fingerprintValue)}`, 'attendance-evidence-line'));
    const actions = reviewButtons(record);
    if (actions) box.append(actions);
    return box;
  }

  async function saveDayStatus(row, workDate, select, button, confirmed) {
    if (!can('attendance.correct')) return;
    if (confirmed) {
      window.alert('확정된 날짜는 먼저 “확정 재개방”을 한 뒤 근태 상태를 바꿀 수 있습니다.');
      return;
    }
    const nextStatus = select.value;
    const currentStatus = dayStatusCode(row);
    if (nextStatus === currentStatus) {
      window.alert('현재와 같은 근태 상태입니다.');
      return;
    }
    const reason = window.prompt(
      `${row.display_name || '직원'} · ${dayStatusLabel(currentStatus)} → ${dayStatusLabel(nextStatus)}\n변경 사유를 5자 이상 입력하세요.`
    );
    if (!reason || reason.trim().length < 5) {
      window.alert('근태 상태 변경 사유를 5자 이상 입력해야 합니다.');
      select.value = currentStatus;
      return;
    }
    button.disabled = true;
    select.disabled = true;
    try {
      const result = await app().rpc('set_attendance_day_status', {
        p_employee_uuid: row.employee_uuid,
        p_work_date: workDate,
        p_attendance_status: nextStatus,
        p_reason: reason.trim(),
        p_note: null,
      });
      if (!result?.ok) {
        if (result?.code === 'DAY_CONFIRMED_REOPEN_REQUIRED') {
          window.alert('확정된 날짜입니다. 먼저 “확정 재개방”을 한 뒤 다시 변경하세요.');
        } else {
          window.alert(`근태 상태를 저장하지 못했습니다. ${result?.code || ''}`);
        }
        select.value = currentStatus;
        return;
      }
      await openAttendance(workDate);
    } catch {
      window.alert('근태 상태를 저장하지 못했습니다.');
      select.value = currentStatus;
    } finally {
      button.disabled = false;
      select.disabled = false;
    }
  }

  function dayStatusControl(row, workDate, confirmed) {
    const wrap = el('div', null, 'attendance-day-status');
    const current = dayStatusCode(row);
    const select = document.createElement('select');
    select.setAttribute('aria-label', `${row.display_name || '직원'} 근태 상태`);
    [
      ['work', '정상 근무'],
      ['paid_leave', '유급휴가·월차'],
      ['unpaid_absence', '무급 결근'],
      ['paid_holiday', '유급공휴일'],
    ].forEach(([value, label]) => select.append(new Option(label, value, false, value === current)));

    if (!['work', 'paid_leave', 'unpaid_absence', 'paid_holiday'].includes(current)) {
      select.append(new Option(dayStatusLabel(current), current, true, true));
    }

    const button = el('button', '상태 저장', 'button button-quiet');
    button.type = 'button';
    const editable = can('attendance.correct') && !confirmed;
    select.disabled = !editable;
    button.disabled = !editable;
    button.addEventListener('click', () => {
      saveDayStatus(row, workDate, select, button, confirmed);
    });
    wrap.append(select);
    if (can('attendance.correct')) wrap.append(button);

    const sourceNote = row?.attendance_status?.note;
    wrap.append(el(
      'span',
      confirmed
        ? `${dayStatusLabel(current)} · 확정 재개방 후 변경 가능`
        : sourceNote
          ? `${dayStatusLabel(current)} · ${sourceNote}`
          : dayStatusLabel(current),
      'attendance-day-status-note'
    ));
    return wrap;
  }

  function summaryCard(label, value) {
    const card = el('article');
    card.append(el('span', label), el('strong', String(value)));
    return card;
  }

  function minuteDelta(left, right) {
    if (!left || !right) return null;
    const a = new Date(left).getTime();
    const b = new Date(right).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.round(Math.abs(a - b) / 60000);
  }

  function compareEvidence(row, evidenceRows, fingerprintImported) {
    const status = dayStatusCode(row);
    if (status !== 'work') return { label: dayStatusLabel(status), needsReview: status === 'review_required' };
    const evidence = Array.isArray(evidenceRows) ? evidenceRows : [];
    if (!fingerprintImported) return { label: '지문자료 미가져옴', needsReview: false };
    if (evidence.length > 1) return { label: `지문 중복 ${evidence.length}건 · 확인`, needsReview: true };
    const fingerprint = evidence[0] || null;
    const appIn = row.clock_in?.event_at || null;
    const appOut = row.clock_out?.event_at || null;
    const fpIn = fingerprint?.clock_in_at || null;
    const fpOut = fingerprint?.clock_out_at || null;
    const appAny = Boolean(appIn || appOut);
    const fpAny = Boolean(fpIn || fpOut);

    if (!appAny && !fpAny) return { label: '양쪽 기록 없음 · 확인', needsReview: true };
    if (!appAny && fpAny) return { label: '지문만 있음 · 확인', needsReview: true };
    if (appAny && !fpAny) return { label: '앱만 있음 · 확인', needsReview: true };

    const deltas = [minuteDelta(appIn, fpIn), minuteDelta(appOut, fpOut)]
      .filter(value => value !== null);
    const missingPair = Boolean(appIn) !== Boolean(fpIn) || Boolean(appOut) !== Boolean(fpOut);
    if (!deltas.length || missingPair) return { label: '출퇴근 일부가 다름 · 확인', needsReview: true };

    const maxDelta = Math.max(...deltas);
    if (maxDelta <= ALIGNMENT_TOLERANCE_MINUTES) {
      return { label: `GPS·지문 대체로 일치 (최대 ${maxDelta}분)`, needsReview: false };
    }
    return { label: `GPS·지문 시간차 ${maxDelta}분 · 확인`, needsReview: true };
  }

  function allExcelRows(best) {
    const helper = window.TaejangPayrollAttendanceXlsx;
    const matrix = best?.matrix;
    const analysis = best?.analysis;
    if (!helper || !Array.isArray(matrix) || !analysis?.ok) return [];
    const mapping = analysis.mapping || {};
    const rows = [];
    for (let index = Number(analysis.headerRow || 1); index < matrix.length; index += 1) {
      const source = Array.isArray(matrix[index]) ? matrix[index] : [];
      if (source.every(value => value == null || String(value).trim() === '')) continue;
      rows.push({
        sourceRow: index + 1,
        employeeId: mapping.employeeId == null ? '' : String(source[mapping.employeeId] ?? '').trim(),
        name: mapping.name == null ? '' : String(source[mapping.name] ?? '').trim(),
        date: helper.normalizeDateCell(source[mapping.date]),
        clockIn: mapping.clockIn == null ? null : helper.normalizeTimeCell(source[mapping.clockIn]),
        clockOut: mapping.clockOut == null ? null : helper.normalizeTimeCell(source[mapping.clockOut]),
      });
    }
    return rows;
  }

  async function sha256File(file) {
    if (!window.crypto?.subtle) throw new Error('FILE_HASH_UNAVAILABLE');
    const digest = await window.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  async function importFingerprintFile(file, workDate) {
    if (!can('attendance.evidence_import')) return;
    const helper = window.TaejangPayrollAttendanceXlsx;
    if (!helper?.parseXlsxFile) {
      window.alert('Excel 가져오기 도구를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.');
      return;
    }
    try {
      const workbook = await helper.parseXlsxFile(file);
      const best = workbook.best;
      if (!best?.analysis?.ok) throw new Error('지문 출근부의 헤더를 찾지 못했습니다.');
      const parsed = allExcelRows(best);
      const invalid = parsed.filter(row => (
        (!row.employeeId && !row.name)
        || !row.date
        || (!row.clockIn && !row.clockOut)
      ));
      const dayKeys = new Set();
      let duplicateDay = false;
      for (const row of parsed) {
        if (!row.date || (!row.employeeId && !row.name)) continue;
        const key = `${row.employeeId || row.name}|${row.date}`;
        if (dayKeys.has(key)) duplicateDay = true;
        dayKeys.add(key);
      }
      if (invalid.length) throw new Error(`확인이 필요한 Excel 행이 ${invalid.length}건 있습니다. 원본 파일을 확인해주세요.`);
      if (duplicateDay) throw new Error('같은 직원·날짜가 두 줄 이상 있습니다. 원본 파일을 확인해주세요.');
      if (!parsed.length) throw new Error('가져올 지문 출퇴근 기록이 없습니다.');

      const fingerprint = await sha256File(file);
      const result = await app().rpc('import_attendance_external_evidence', {
        p_source_system: EVIDENCE_SOURCE,
        p_source_file_name: file.name,
        p_source_fingerprint: fingerprint,
        p_source_sheet: best.sheetName || null,
        p_rows: parsed.map(row => ({
          source_employee_key: row.employeeId || null,
          source_display_name: row.name || null,
          work_date: row.date,
          clock_in: row.clockIn || null,
          clock_out: row.clockOut || null,
          source_row_number: row.sourceRow,
        })),
      });
      if (!result?.ok) throw new Error(result?.code || 'IMPORT_FAILED');

      const duplicate = result.code === 'DUPLICATE_IMPORT';
      const message = duplicate
        ? '이미 가져온 동일한 지문 출근부입니다. 중복 저장하지 않았습니다.'
        : `지문 출근부 ${result.row_count}건을 저장했습니다. 직원 미매칭 ${result.unmatched_count || 0}건입니다.`;
      window.alert(message);
      await openAttendance(workDate);
    } catch (error) {
      window.alert(`지문 출근부를 가져오지 못했습니다. ${error?.message || '파일을 확인해주세요.'}`);
    }
  }

  function makeToolbar(workDate) {
    const toolbar = el('section', null, 'attendance-toolbar');
    const dateLabel = el('label', '확인 날짜');
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = workDate;
    dateInput.addEventListener('change', () => {
      if (dateInput.value) void openAttendance(dateInput.value);
    });
    dateLabel.append(dateInput);
    toolbar.append(dateLabel);

    if (can('attendance.evidence_import')) {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.xlsx';
      fileInput.hidden = true;
      const importButton = el('button', '지문 Excel 가져오기', 'button button-quiet');
      importButton.type = 'button';
      importButton.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) void importFingerprintFile(file, workDate);
        fileInput.value = '';
      });
      toolbar.append(importButton, fileInput);
    }

    toolbar.append(folded('GPS·지문 비교 안내', el(
      'p',
      'GPS와 지문 Excel은 원본 근거로 따로 보존합니다. 5분 이내 차이는 정상 후보로 표시하고, 누락·큰 차이·미매칭만 우선 확인합니다.',
      'attendance-evidence-help'
    )));
    return toolbar;
  }

  async function mapUnmatchedEvidence(evidence, employeeUuid, workDate) {
    if (!can('attendance.evidence_import') || !evidence?.source_employee_key || !employeeUuid) return;
    const result = await app().rpc('save_attendance_source_identity_mapping', {
      p_source_system: evidence.source_system || EVIDENCE_SOURCE,
      p_source_employee_key: evidence.source_employee_key,
      p_employee_uuid: employeeUuid,
      p_reason: '운영팀장 지문 출근부 직원 연결',
    });
    if (!result?.ok) {
      window.alert('직원 연결을 저장하지 못했습니다.');
      return;
    }
    await openAttendance(workDate);
  }

  function unmatchedPanel(unmatched, rows, workDate) {
    if (!unmatched.length) return null;
    const panel = el('section', null, 'attendance-unmatched');
    panel.append(
      el('strong', `직원 미매칭 지문자료 ${unmatched.length}건`),
      el('p', '사번/사용자번호를 태장 직원과 한 번 연결하면 다음 파일부터 같은 직원으로 인식합니다.')
    );
    const list = el('div', null, 'attendance-unmatched-list');
    unmatched.forEach(item => {
      const line = el('div', null, 'attendance-unmatched-row');
      line.append(el('span', `${item.source_display_name || '이름 없음'} · ${item.source_employee_key || '외부번호 없음'} · 출근 ${time(item.clock_in_at)} / 퇴근 ${time(item.clock_out_at)}`));
      if (can('attendance.evidence_import') && item.source_employee_key) {
        const select = document.createElement('select');
        select.append(new Option('연결할 직원 선택', ''));
        rows.forEach(row => select.append(new Option(
          `${row.display_name || '직원'} · ${row.employee_id || ''}`,
          row.employee_uuid
        )));
        const button = el('button', '직원 연결', 'button button-quiet');
        button.type = 'button';
        button.addEventListener('click', () => {
          if (!select.value) return;
          void mapUnmatchedEvidence(item, select.value, workDate);
        });
        line.append(select, button);
      }
      list.append(line);
    });
    panel.append(list);
    return panel;
  }

  function confirmationBlockerLabel(blocker) {
    const labels = {
      missing_clock_in: '출근 시간이 없습니다',
      missing_clock_out: '퇴근 시간이 없습니다',
      pending_gps_exception: 'GPS 예외가 아직 처리되지 않았습니다',
      fingerprint_import_missing: '이 날짜의 지문 Excel 자료를 아직 가져오지 않았습니다',
      fingerprint_missing: '지문 근거가 없습니다',
      fingerprint_ambiguous: '같은 직원의 지문 근거가 여러 건입니다',
      fingerprint_clock_in_missing: '지문 출근 시간이 없습니다',
      fingerprint_clock_out_missing: '지문 퇴근 시간이 없습니다',
      clock_in_mismatch: 'GPS와 지문 출근 시간 차이가 5분을 넘습니다',
      clock_out_mismatch: 'GPS와 지문 퇴근 시간 차이가 5분을 넘습니다',
      external_identity_unmatched: '직원 미매칭 지문자료가 있습니다',
      attendance_status_review_required: '근태 상태를 확인해야 합니다',
    };
    const owner = blocker?.display_name ? `${blocker.display_name} · ` : '';
    return `${owner}${labels[blocker?.type] || '확정 전 확인이 필요한 근태 예외'}`;
  }

  function isMissingTimeBlocker(blocker) {
    return blocker?.type === 'missing_clock_in' || blocker?.type === 'missing_clock_out';
  }

  async function fillMissingTimeBlocker(workDate, blocker) {
    if (!can('attendance.correct') || !blocker?.employee_uuid || !isMissingTimeBlocker(blocker)) return;
    const api = window.TaejangAttendanceIntegrity?.addMissingTime;
    if (typeof api !== 'function') {
      window.alert('누락 시간 입력 화면을 준비하지 못했습니다. 근태 보정 메뉴에서 입력해주세요.');
      return;
    }
    const saved = await api({
      employeeUuid: blocker.employee_uuid,
      workDate,
      eventType: blocker.type === 'missing_clock_in' ? 'clock_in' : 'clock_out'
    });
    if (saved) await openAttendance(workDate);
  }

  async function resolveConfirmationBlocker(workDate, blocker) {
    if (!can('attendance.confirm')) return;
    if (isMissingTimeBlocker(blocker)) {
      window.alert('출근·퇴근 누락은 확인 사유만으로 해소할 수 없습니다. 실제 시간을 입력해주세요.');
      return;
    }
    const reason = window.prompt(`${confirmationBlockerLabel(blocker)}\n확정 전 해소 또는 확인 사유를 5자 이상 입력하세요.`);
    if (!reason || reason.trim().length < 5) {
      window.alert('확정 전 예외를 해소할 때는 사유를 5자 이상 입력해야 합니다.');
      return;
    }
    const result = await app().rpc('resolve_attendance_confirmation_exception', {
      p_work_date: workDate,
      p_exception_key: blocker.key,
      p_reason: reason.trim(),
    });
    if (!result?.ok) throw new Error(result?.code || 'EXCEPTION_RESOLVE_FAILED');
    await openAttendance(workDate);
  }

  async function confirmAttendanceDay(workDate) {
    if (!can('attendance.confirm')) return;
    if (!window.confirm('이 날짜의 전체 출근부를 확정합니다. 확정된 v1은 변경되지 않으며, 이후 수정하려면 재개방 사유를 남겨야 합니다. 진행할까요?')) return;
    const result = await app().rpc('confirm_attendance_day', { p_work_date: workDate });
    if (!result?.ok) {
      if (result?.code === 'CONFIRMATION_BLOCKED') {
        window.alert(`확정 전에 해결할 항목이 ${result.unresolved_count || 0}건 있습니다.`);
        await openAttendance(workDate);
        return;
      }
      throw new Error(result?.code || 'CONFIRMATION_FAILED');
    }
    window.alert(`일일 출근부를 v${result.revision_no}로 확정했습니다.`);
    await openAttendance(workDate);
  }

  async function reopenAttendanceDay(workDate) {
    if (!can('attendance.confirm')) return;
    const reason = window.prompt('재개방 사유를 5자 이상 입력하세요. 이후 수정 후 새 revision으로 다시 확정해야 합니다.');
    if (!reason || reason.trim().length < 5) {
      window.alert('재개방 사유를 5자 이상 입력해야 합니다.');
      return;
    }
    const result = await app().rpc('reopen_attendance_confirmation', {
      p_work_date: workDate,
      p_reason: reason.trim(),
    });
    if (!result?.ok) throw new Error(result?.code || 'REOPEN_FAILED');
    window.alert(`v${result.revision_no} 확정을 재개방했습니다. 수정 후 새 revision으로 다시 확정하세요.`);
    await openAttendance(workDate);
  }

  function confirmationPanel(status, workDate) {
    const panel = el('section', null, 'attendance-confirmation');
    const confirmed = Boolean(status?.is_confirmed);
    const blockers = Array.isArray(status?.blockers) ? status.blockers : [];
    const pending = blockers.filter(item => !item?.resolved);
    panel.dataset.confirmed = String(confirmed);
    panel.dataset.blocked = String(!confirmed && pending.length > 0);
    const revision = status?.latest_revision;
    panel.append(
      el('h3', confirmed ? `일일 근태 확정 v${revision?.revision_no || ''}` : '일일 근태 확정'),
      el('p', confirmed
        ? `확정 시각: ${revision?.confirmed_at ? new Date(revision.confirmed_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}`
        : pending.length
          ? `확정 전 해결할 항목이 ${pending.length}건 있습니다. 출근·퇴근 누락은 실제 시간을 입력하고, 판단이 필요한 예외만 확인 사유를 남긴 뒤 하루 전체를 확정합니다.`
          : '모든 필수 확인 항목이 해소되었습니다. 이 날짜의 전체 출근부를 한 번에 확정할 수 있습니다.'),
    );
    if (confirmed) panel.append(folded('확정 원장 근거', el('p', 'snapshot ' + (revision?.snapshot_fingerprint || '-'))));
    if (blockers.length) {
      const list = el('ul', null, 'attendance-confirmation-blockers');
      blockers.forEach(blocker => {
        const item = el('li');
        item.dataset.resolved = String(Boolean(blocker?.resolved));
        item.append(el('span', blocker.resolved ? `해소됨 · ${confirmationBlockerLabel(blocker)}` : confirmationBlockerLabel(blocker)));
        if (!confirmed && !blocker.resolved && can('attendance.confirm')) {
          const missingTime = isMissingTimeBlocker(blocker);
          const button = el('button', missingTime ? '누락 시간 입력' : '확인 사유 기록', 'button button-quiet');
          button.type = 'button';
          button.addEventListener('click', () => {
            const action = missingTime
              ? fillMissingTimeBlocker(workDate, blocker)
              : resolveConfirmationBlocker(workDate, blocker);
            action.catch(() => window.alert(missingTime ? '누락 시간을 입력하지 못했습니다.' : '확정 예외를 기록하지 못했습니다.'));
          });
          item.append(button);
        }
        list.append(item);
      });
      panel.append(folded('확정 전 확인 항목 ' + pending.length + '건', list));
    }
    if (can('attendance.confirm')) {
      const actions = el('div', null, 'attendance-confirmation-actions');
      if (confirmed) {
        const reopen = el('button', '확정 재개방', 'button button-quiet');
        reopen.type = 'button';
        reopen.addEventListener('click', () => reopenAttendanceDay(workDate).catch(() => window.alert('확정을 재개방하지 못했습니다.')));
        actions.append(reopen);
      } else {
        const confirm = el('button', '하루 전체 확정', 'button');
        confirm.type = 'button';
        confirm.disabled = pending.length > 0;
        confirm.addEventListener('click', () => confirmAttendanceDay(workDate).catch(() => window.alert('일일 출근부를 확정하지 못했습니다.')));
        actions.append(confirm);
      }
      panel.append(actions);
    }
    return panel;
  }

  function monthStart(workDate) {
    return /^\d{4}-\d{2}-\d{2}$/.test(workDate || '') ? `${workDate.slice(0, 7)}-01` : '';
  }

  function confirmedLedgerPanel(workDate) {
    const panel = el('section', null, 'attendance-ledger');
    const startLabel = el('label', '시작일');
    const start = document.createElement('input');
    start.type = 'date'; start.value = monthStart(workDate);
    startLabel.append(start);
    const endLabel = el('label', '종료일');
    const end = document.createElement('input');
    end.type = 'date'; end.value = workDate || '';
    endLabel.append(end);
    const historyLabel = el('label');
    const history = document.createElement('input');
    history.type = 'checkbox';
    historyLabel.append(history, document.createTextNode('재개방된 이전 revision도 포함'));
    const results = el('div', '조회 전입니다. 현재 대장은 재개방되지 않은 일일 확정본만 사용합니다.', 'attendance-ledger-results');
    const query = el('button', '확정 근태 대장 조회', 'button button-quiet');
    query.type = 'button';
    query.addEventListener('click', async () => {
      if (!start.value || !end.value || start.value > end.value) {
        window.alert('시작일과 종료일을 올바르게 입력하세요.');
        return;
      }
      query.disabled = true;
      results.replaceChildren(el('p', 'immutable 근태 대장을 불러오고 있습니다.', 'message'));
      try {
        const result = await app().rpc('get_confirmed_attendance_period', {
          p_period_start: start.value,
          p_period_end: end.value,
          p_employee_uuid: null,
          p_include_reopened: history.checked,
        });
        const rows = Array.isArray(result?.rows) ? result.rows : [];
        const summary = el('p', `${result?.active_confirmed_day_count || 0}일 · ${result?.employee_count || 0}명 · ${result?.revision_count || 0} revision · fingerprint ${result?.period_fingerprint || '-'}`);
        const list = el('div', null, 'attendance-ledger-results');
        if (!rows.length) list.append(el('p', '선택한 기간에는 확정된 근태가 없습니다.', 'empty'));
        rows.forEach(row => {
          const line = el('article', null, 'attendance-ledger-row');
          line.dataset.reopened = String(Boolean(row?.is_reopened));
          const ledgerStatus = row?.record_snapshot?.attendance_status || 'work';
          line.append(
            el('strong', `${row?.work_date || '-'} · ${row?.display_name_at_confirmation || '직원'} · v${row?.revision_no || '-'}`),
            el('span', `${dayStatusLabel(ledgerStatus)} · 출근 ${time(row?.clock_in_at)} / 퇴근 ${time(row?.clock_out_at)} · record ${row?.record_fingerprint || '-'}`),
            el('span', row?.is_reopened ? `재개방됨 · ${row?.reopen_reason || '사유 기록됨'}` : `현재 확정본 · snapshot ${row?.revision_snapshot_fingerprint || '-'}`, 'attendance-evidence-line')
          );
          list.append(line);
        });
        results.replaceChildren(summary, list);
      } catch {
        results.replaceChildren(el('p', '확정 근태 대장을 불러오지 못했습니다.', 'message error'));
      } finally {
        query.disabled = false;
      }
    });
    const controls = el('div', null, 'attendance-ledger-controls');
    controls.append(startLabel, endLabel, historyLabel, query);
    panel.append(
      el('h3', '확정 근태 대장'),
      el('p', '주·월·연 데이터를 별도로 복제하지 않습니다. 일일 확정 revision과 GPS·지문·수기 보정 provenance를 기간별로 다시 읽습니다.'),
      controls,
      results
    );
    return panel;
  }

  async function toggleHolidayWork(row, workDate, enabled) {
    if (!can('attendance.correct')) return;
    const action = enabled ? '휴일근무 지정' : '휴일근무 지정 해제';
    const reason = window.prompt(action + ' 사유를 입력하세요.');
    if (!reason || reason.trim().length < 2) {
      window.alert('사유를 2자 이상 입력해주세요.');
      return;
    }
    const result = await app().rpc('set_attendance_holiday_work_assignment', {
      p_employee_uuid: row.employee_uuid,
      p_work_date: workDate,
      p_enabled: enabled,
      p_reason: reason.trim()
    });
    if (!result?.ok) {
      window.alert('휴일근무 지정을 처리하지 못했습니다. ' + (result?.code || ''));
      return;
    }
    await openAttendance(workDate);
  }

  function holidayWorkPanel(dayStatus, assignmentData, rows, workDate) {
    if (dayStatus?.is_workday !== false) return null;
    const panel = el('section', null, 'attendance-holiday-work');
    panel.append(
      el('h3', '휴일근무 지정'),
      el('p', (dayStatus?.reason || '휴일') + '입니다. 기본적으로 출근은 막혀 있으며, 여기에서 지정한 직원만 앱에서 출퇴근할 수 있습니다.')
    );

    const assigned = new Set(
      (Array.isArray(assignmentData?.rows) ? assignmentData.rows : [])
        .map(item => String(item.employee_uuid || ''))
        .filter(Boolean)
    );
    const list = el('div', null, 'attendance-holiday-work-list');

    rows.forEach(row => {
      const isAssigned = assigned.has(String(row.employee_uuid));
      const line = el('div', null, 'attendance-holiday-work-row');
      const copy = el('div');
      copy.append(
        el('strong', row.display_name || '직원'),
        el('span', (row.employee_id || '') + (isAssigned ? ' · 휴일근무 지정됨' : ' · 기본 휴일'))
      );
      line.append(copy);
      if (can('attendance.correct')) {
        const action = el('button', isAssigned ? '지정 해제' : '휴일근무 지정', 'button button-quiet');
        action.type = 'button';
        action.addEventListener('click', () => {
          toggleHolidayWork(row, workDate, !isAssigned).catch(() => window.alert('휴일근무 지정을 처리하지 못했습니다.'));
        });
        line.append(action);
      }
      list.append(line);
    });

    if (!rows.length) list.append(el('p', '휴일근무를 지정할 근태 대상 직원이 없습니다.', 'empty'));
    panel.append(list);
    return panel;
  }

  function syncRequiredPanel(feature) {
    const panel = el('section', null, 'attendance-sync-required');
    panel.dataset.serverSyncRequired = '1';
    panel.append(
      el('h3', `${feature} 서버 동기화 필요`),
      el('p', '직원 출근부는 계속 표시합니다. 이 보조 기능에 필요한 서버 RPC가 아직 배포되지 않았거나 일시적으로 응답하지 않았습니다. 서버 동기화 후 다시 시도해주세요.')
    );
    return panel;
  }


  function folded(title, node, open = false) {
    const detail = el('details', null, 'attendance-detail-tools');
    detail.open = open;
    detail.append(el('summary', title), node);
    return detail;
  }

  function tabBar(panels) {
    const bar = el('nav', null, 'attendance-tabs');
    bar.setAttribute('aria-label', '출근부 보기');
    const buttons = [];
    [['daily', '일별'], ['monthly', '월별'], ['detail', '상세·보정 이력']].forEach(([key, label]) => {
      const button = el('button', label, 'button button-quiet'); button.type = 'button';
      button.addEventListener('click', () => { activeTab = key; update(); if (key === 'monthly') panels.monthly.load(); });
      buttons.push([key, button]); bar.append(button);
    });
    function update() {
      buttons.forEach(([key, button]) => { button.setAttribute('aria-pressed', String(activeTab === key)); panels[key].hidden = activeTab !== key; if(activeTab===key)panels[key].querySelectorAll('.attendance-toolbar').forEach(bar=>bar.refresh?.()); });
    }
    update();
    if (activeTab === 'monthly') queueMicrotask(() => panels.monthly.load());
    return bar;
  }

  function searchToolbar(render, getRows = () => []) {
    const bar = el('section', null, 'attendance-toolbar');
    const label = el('label', '이름·사번 검색'), search = document.createElement('input');
    search.type = 'search'; search.value = filters.search;
    search.addEventListener('input', () => { filters.search = search.value; render(); });
    label.append(search);
    const checkLabel = el('label'), check = document.createElement('input');
    check.type = 'checkbox'; check.checked = filters.reviewOnly;
    check.addEventListener('change', () => { filters.reviewOnly = check.checked; render(); });
    checkLabel.append(check, document.createTextNode('확인 필요만'));

    bar.append(label, checkLabel);
    const controls = [];
    [['department','부서'],['group','팀·작업반'],['leader','담당 팀장(배정 관계)'],['job','직무·직책(장애 여부 아님)'],['attendance','근태 대상'],['employment','재직상태'],['accounts','계정 표시']].forEach(([key,title])=>{
      const field=el('label',title), select=document.createElement('select'); select.dataset.filterKey=key;
      select.addEventListener('change',()=>{filters[key]=select.value;render();});field.append(select);bar.append(field);controls.push([key,select]);
    });
    bar.append(el('p','장애 여부: 보호 인사자료·별도 승인 필요. 테스트 여부는 명시적 표식만 사용하며 미확인 계정을 이름으로 추정하지 않습니다.','attendance-evidence-help'));
    bar.refresh = () => {
      search.value=filters.search;check.checked=filters.reviewOnly;
      controls.forEach(([key,select])=>{
        const rows=getRows();
        const values= key==='accounts' ? [['normal','정상 명단(비활성·확인된 테스트 숨김)'],['all','전체 이력 포함']] : [['','전체'],...([...new Set(rows.flatMap(r=>key==='group' ? (r.groups?.length?r.groups:[r.groupState]) : key==='leader' ? (r.leaders?.length?r.leaders:[r.leaderState]) : [r[key]]).filter(Boolean))].sort().map(v=>[v,v]))];
        select.replaceChildren(...values.map(([value,text])=>new Option(text,value,false,value===filters[key])));
        if(filters[key] && !values.some(([value])=>value===filters[key]))select.append(new Option(filters[key],filters[key],true,true));
      });
    };
    bar.refresh();return bar;
  }
  const matchesSearch = row => window.TaejangAttendanceMonthly.matches(row, filters);


  async function classificationMetadata(onDate) {
    const metadata = new Map();
    if (can('employee.view_all') || can('employee.view_scoped')) {
      try {
        const context=await app().rpc('get_employee_management_context');
        for(const employee of context?.employees || []) {
          // Select ordinary organization fields; never retain protected HR values.
          const {id,department_name,position_name,employment_status,attendance_required,hired_on,departed_on}=employee;
          metadata.set(String(id),{id,department_name,position_name,employment_status,attendance_required,hired_on,departed_on,linked_profile:employee.linked_profile?{account_status:employee.linked_profile.account_status}:null});
        }
      } catch { /* Unavailable scoped metadata stays explicitly unconfirmed. */ }
    }
    if ((can('field.membership.manage') || can('field.assignment.manage')) && can('task.manage')) {
      try {
        const options=await app().rpc('get_today_board_admin_options');
        const groups=options?.work_groups || [];
        let allGroupsReadable=true;
        for(const group of groups) {
          try {
            const members=await app().rpc('list_field_work_group_members',{p_work_group_id:group.id,p_on_date:onDate});
            if(!Array.isArray(members)){allGroupsReadable=false;continue;}
            const leaders=members.filter(m=>m.member_type==='lead').map(m=>m.name);
            for(const member of members){
              const id=String(member.employee_uuid),meta=metadata.get(id) || {id};
              meta.groups=[...new Set([...(meta.groups || []),group.name])];meta.leaders=[...new Set([...(meta.leaders || []),...leaders])];meta.groupsKnown=true;
              metadata.set(id,meta);
            }
          } catch { allGroupsReadable=false; /* One forbidden group does not expand scope or block attendance. */ }
        }
        if(allGroupsReadable && can('employee.view_all'))for(const meta of metadata.values())meta.groupsKnown=true;
      } catch { /* Keep group/leader classification as unconfirmed. */ }
    }
    return metadata;
  }

  function monthlyPanel(workDate) {
    const panel = el('section'); panel.dataset.attendanceMonthly = '1';
    const toolbar = el('div', null, 'attendance-toolbar'), label = el('label', '확인 월');
    const month = document.createElement('input'); month.type = 'month'; month.value = workDate.slice(0, 7); label.append(month);
    const query = el('button', '월간 조회', 'button'); query.type = 'button';
    const excel = el('button', '월간 출근부 Excel', 'button button-quiet'); excel.type = 'button'; excel.disabled = true;
    const results = el('div'), detail = el('div'); detail.setAttribute('aria-live', 'polite');
    let model = null, loading = false, loaded = false;
    function visibleRows() { return (model?.rows || []).filter(r => matchesSearch(r) && (!filters.reviewOnly || r.reviewDays > 0)); }
    function exportRows(rows, scope) {
      try { window.TaejangAttendanceMonthly.download(model, rows, window.TaejangPayrollLedgerXlsx, scope); }
      catch { window.alert('Excel을 만들지 못했습니다. 조회한 내용은 유지됩니다. 다시 시도하세요.'); }
    }
    excel.addEventListener('click', () => exportRows(visibleRows(), filters.search || filters.reviewOnly ? '현재 검색·필터' : '전체'));
    function render() {
      if (!model) return;
      filterBar.refresh();
      const rows = visibleRows(), table = el('table', null, 'attendance-matrix');
      table.append(el('caption', model.month + ' 직원별 월간 근태'));
      const head = el('thead'), tr = el('tr'); tr.append(el('th', '직원'));
      model.dates.forEach(date => { const th = el('th', date.slice(8)); th.scope = 'col'; tr.append(th); }); head.append(tr);
      const body = el('tbody');
      rows.forEach(row => {
        const line = el('tr'), person = el('th'); person.scope = 'row';
        const button = el('button', row.display_name || '미등록', 'button button-quiet'); button.type = 'button';
        button.addEventListener('click', () => {
          const list = el('div');
          const personal = el('button', '개인 월간 Excel', 'button'); personal.type = 'button'; personal.addEventListener('click', () => exportRows([row], '선택 직원'));
          list.append(el('h3', row.display_name || '직원'), personal);
          row.cells.forEach((cell, index) => {
            const day = el('div', null, 'attendance-ledger-row');
            const open = el('button', model.dates[index] + ' 일별 근거·보정', 'button button-quiet'); open.type = 'button';
            open.addEventListener('click', () => { activeTab = 'daily'; void openAttendance(model.dates[index]); });
            day.append(el('strong', cell.label + ' ' + (cell.clockIn || '-') + '~' + (cell.clockOut || '-')), open);
            if (cell.record) day.append(el('p', '확정 v' + cell.record.revision_no + ' · 원장 ' + cell.record.record_fingerprint));
            list.append(day);
          });
          detail.replaceChildren(list); detail.scrollIntoView({block:'nearest'});
        });
        person.append(button, el('span', row.employee_id || '사번 미등록'));
        person.append(el('span', row.department + ' · ' + row.account)); line.append(person);
        row.cells.forEach(cell => { const td = el('td'); td.dataset.review = String(cell.review); td.append(el('span', cell.label), el('span', (cell.clockIn || '-') + '~' + (cell.clockOut || '-'))); line.append(td); });
        body.append(line);
      });
      table.append(head, body);
      const wrap = el('div', null, 'attendance-table-wrap'); wrap.tabIndex = 0; wrap.setAttribute('aria-label', '월간 근태표 가로 스크롤'); wrap.append(table);
      results.replaceChildren(el('p', rows.length + '명 · 출근 / 누락 / 결근 / 유급휴가 / 유급휴일 / 비대상 / 재직기간 밖 · 미확정은 급여 계산 전 확인 필요'), wrap);
      if (!rows.length) results.append(el('p', '선택한 월·조건에 직원 기록이 없습니다.'));
      if (model.failedDays.length) results.prepend(el('p', '조회 실패: ' + model.failedDays.join(', ') + ' · 다시 조회하세요.', 'message error'));
    }
    async function load(force = false) {
      if (loading || (loaded && !force)) return;
      loading = true; query.disabled = true; excel.disabled = true;
      const selectedMonth = month.value;
      try {
        const helper = window.TaejangAttendanceMonthly;
        const dates = helper.monthDates(selectedMonth);
        const ledger = await app().rpc('get_confirmed_attendance_period', {p_period_start:dates[0],p_period_end:dates.at(-1),p_employee_uuid:null,p_include_reopened:false});
        if (!Array.isArray(ledger?.rows)) throw new Error('LEDGER_UNAVAILABLE');
        const daily = {};
        // Bounded parallel reads; each missing day remains explicitly unavailable.
        for (let offset = 0; offset < dates.length; offset += 4) {
          await Promise.all(dates.slice(offset, offset + 4).map(async date => {
            try {
              const [data,workday]=await Promise.all([app().rpc('get_attendance_admin_today',{p_work_date:date}),app().rpc('get_attendance_workday_status',{p_work_date:date})]);
              if(Array.isArray(data?.rows)&&typeof workday?.is_workday==='boolean') {
                let assignments=[];
                if(!workday.is_workday){const result=await app().rpc('get_attendance_holiday_work_assignments',{p_work_date:date});assignments=result?.rows || [];}
                daily[date]={...data,workday,assignments};
              }
            } catch { /* explicit failed day in model */ }
          }));
        }
        if (!panel.isConnected) return;
        const metadata=await classificationMetadata(dates.at(-1));
        model = helper.buildMonth({month:selectedMonth,ledger,daily,employees:[...metadata.values()]});
        model.rows=model.rows.map(row=>helper.classify(row,metadata.get(String(row.employee_uuid))));loaded = true;
        render(); excel.disabled = model.failedDays.length > 0;
      } catch {
        results.prepend(el('p', '월간 출근부를 불러오지 못했습니다. 선택 월과 이전 조회 내용은 유지됩니다.', 'message error'));
      } finally { loading = false; query.disabled = false; }
    }
    query.addEventListener('click', () => load(true));
    month.addEventListener('change', () => { loaded = false; excel.disabled = true; });
    toolbar.append(label, query, excel);
    const filterBar=searchToolbar(render,()=>model?.rows || []);
    panel.append(toolbar, filterBar, results, detail);
    panel.load = load;
    return panel;
  }

  async function openAttendance(workDate = null) {
    if (!can('attendance.admin_view')) return;
    closeSidebar();
    const target = main();
    document.getElementById('desktop-page-title').textContent = '출근부';
    target.hidden = false;
    const version = ++requestVersion;
    // Keep the last screen and any selected inputs until the read succeeds.
    try {
      const requestedWorkDate = workDate || new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date());
      const [rosterResult, evidenceResult, confirmationResult, dayStatusResult, holidayAssignmentsResult] = await Promise.allSettled([
        app().rpc('get_attendance_admin_today', { p_work_date: requestedWorkDate }),
        app().rpc('get_attendance_external_evidence', { p_work_date: requestedWorkDate }),
        app().rpc('get_attendance_confirmation_status', { p_work_date: requestedWorkDate }),
        app().rpc('get_attendance_workday_status', { p_work_date: requestedWorkDate }),
        app().rpc('get_attendance_holiday_work_assignments', { p_work_date: requestedWorkDate }),
      ]);
      if (rosterResult.status !== 'fulfilled') throw rosterResult.reason || new Error('ATTENDANCE_ROSTER_UNAVAILABLE');
      if (version !== requestVersion) return;
      const data = rosterResult.value;
      if (!Array.isArray(data?.rows)) throw new Error('ROSTER_UNAVAILABLE');
      const evidenceAvailable = evidenceResult.status === 'fulfilled';
      const confirmationAvailable = confirmationResult.status === 'fulfilled';
      const workdayAvailable = dayStatusResult.status === 'fulfilled';
      const holidayAssignmentsAvailable = holidayAssignmentsResult.status === 'fulfilled';
      const evidenceData = evidenceAvailable ? evidenceResult.value : null;
      const confirmation = confirmationAvailable ? confirmationResult.value : null;
      const dayStatus = workdayAvailable ? dayStatusResult.value : null;
      const holidayAssignments = holidayAssignmentsAvailable ? holidayAssignmentsResult.value : null;
      currentWorkDate = data?.work_date || requestedWorkDate;
      const metadata=await classificationMetadata(currentWorkDate);
      if(version!==requestVersion)return;
      const rows=data.rows.map(row=>window.TaejangAttendanceMonthly.classify(row,metadata.get(String(row.employee_uuid))));
      const evidenceRows = Array.isArray(evidenceData?.rows) ? evidenceData.rows : [];
      const fingerprintImported = evidenceRows.some(item => item.source_system === EVIDENCE_SOURCE);
      const byEmployee = new Map();
      evidenceRows.filter(item => item.employee_uuid).forEach(item => {
        const key = String(item.employee_uuid);
        const group = byEmployee.get(key) || [];
        group.push(item);
        byEmployee.set(key, group);
      });
      const unmatched = evidenceRows.filter(item => !item.employee_uuid);

      const comparisons = evidenceAvailable
        ? rows.map(row => {
          const comparison = compareEvidence(row, byEmployee.get(String(row.employee_uuid)) || [], fingerprintImported);
          const assigned=(holidayAssignments?.rows || []).some(r=>String(r.employee_uuid)===String(row.employee_uuid));
          if(dayStatus?.is_workday===false && !assigned && !row.clock_in?.event_at && !row.clock_out?.event_at && dayStatusCode(row)==='work')return {label:'휴일',needsReview:false};
          const missing = dayStatusCode(row) === 'work' && (!good(row.clock_in) || !good(row.clock_out));
          return missing ? { label: '출퇴근 누락 · 확인', needsReview: true } : comparison;
        })
        : rows.map(() => ({ label: '지문 근거자료 서버 동기화 필요', needsReview: true }));
      const reviewCount = rows.filter((row,index)=>comparisons[index].needsReview || row.clock_in?.status==='exception_pending' || row.clock_out?.status==='exception_pending').length;

      const intro = el('header', null, 'dashboard-intro');
      const back = el('button', '대시보드로', 'button button-quiet'); back.type = 'button';
      back.addEventListener('click', () => document.dispatchEvent(new CustomEvent('taejang-dashboard-refresh')));
      intro.append(
        el('p', '근태 관리', 'eyebrow'),
        el('h2', `${currentWorkDate || '오늘'} 출근부`),
        el('p', '앱 GPS와 보안업체 지문 Excel을 근거자료로 비교하고, 차이·누락만 우선 확인합니다. 원본 근거는 서로 덮어쓰지 않습니다.'),
        back
      );

      const summary = el('section', null, 'attendance-summary');
      summary.append(
        summaryCard('대상 직원', rows.length),
        summaryCard('정상', rows.filter((row, i) => !comparisons[i].needsReview).length),
        summaryCard('확인 필요', reviewCount),
        summaryCard('미확정', confirmation?.is_confirmed ? 0 : rows.length)
      );

      const list = el('section', null, 'attendance-list');
      const dayConfirmed = Boolean(confirmation?.is_confirmed);
      if (!rows.length) list.append(el('p', '현재 출퇴근 대상 직원 계정이 없습니다.', 'empty'));

      const dailyEntries = [];
      rows.forEach((row,index)=>{
        const evidence=byEmployee.get(String(row.employee_uuid)) || [];
        const fingerprint=evidence.length===1?evidence[0]:null;
        const comparison=comparisons[index];
        const line=el('article',null,'attendance-row');
        const person=el('div',null,'attendance-person');
        person.append(document.createTextNode(row.display_name || '직원'),el('span',row.employee_id || '', 'attendance-evidence-line'),dayStatusControl(row,currentWorkDate,dayConfirmed));
        const compare=el('div',comparison.label,'attendance-compare');compare.dataset.review=String(comparison.needsReview);
        line.append(person,cell('출근',row.clock_in,fingerprint?.clock_in_at),cell('퇴근',row.clock_out,fingerprint?.clock_out_at),compare);
        const compact=el('details',null,'attendance-compact');compact.dataset.review=String(comparison.needsReview);
        const heading=el('summary');heading.append(el('strong',row.display_name || '직원'),el('span',row.employee_id || '사번 미등록'),el('span',time(row.clock_in?.event_at)+'~'+time(row.clock_out?.event_at)),el('span',comparison.label));
        compact.append(heading,line);dailyEntries.push({row,comparison,compact});
      });
      function renderDaily(){
        const entries=dailyEntries.filter(({row,comparison})=>matchesSearch(row)&&(!filters.reviewOnly||comparison.needsReview));
        entries.sort((a,b)=>Number(b.comparison.needsReview)-Number(a.comparison.needsReview));
        list.replaceChildren(...entries.map(item=>item.compact));
        if(!entries.length)list.append(el('p','조건에 맞는 직원이 없습니다.','empty'));
      }
      renderDaily();
      const dailyPanel=el('section'),detailPanel=el('section'),monthly=monthlyPanel(currentWorkDate);
      const tabs=tabBar({daily:dailyPanel,monthly,detail:detailPanel});
      const pieces=[intro,tabs];
      dailyPanel.append(makeToolbar(currentWorkDate),summary,searchToolbar(renderDaily,()=>rows));
      if(!evidenceAvailable)dailyPanel.append(syncRequiredPanel('지문 근거자료'));
      if(!workdayAvailable||!holidayAssignmentsAvailable)detailPanel.append(syncRequiredPanel('휴일근무 지정'));
      else { const holidayPanel=holidayWorkPanel(dayStatus,holidayAssignments,rows,currentWorkDate);if(holidayPanel)detailPanel.append(folded('휴일근무 지정',holidayPanel)); }
      dailyPanel.append(confirmationAvailable?confirmationPanel(confirmation,currentWorkDate):syncRequiredPanel('일일 근태 확정'));
      detailPanel.append(folded('확정 원장·이전 revision 조회',confirmedLedgerPanel(currentWorkDate)));
      const correction=el('button','근태 시간 보정·보정 이력','button');correction.type='button';
      correction.addEventListener('click',()=>window.TaejangAttendanceIntegrity?.openCorrectionScreen());
      if(can('attendance.correct'))detailPanel.append(correction);
      const unmatchedNode=unmatchedPanel(unmatched,rows,currentWorkDate);
      if(unmatchedNode)dailyPanel.append(folded('미매칭 지문자료 '+unmatched.length+'건',unmatchedNode,true));
      dailyPanel.append(list);pieces.push(dailyPanel,monthly,detailPanel);
      target.replaceChildren(...pieces);
    } catch {
      if (version !== requestVersion) return;
      target.prepend(el('p', '출근부를 불러오지 못했습니다. 이전 조회와 입력 상태는 유지됩니다.', 'message error'));
    }
  }

  function addNavigation() {
    // Compatibility no-op. Sidebar ownership belongs to dashboard-shell.
  }

  function addDashboardCard() {
    if (!can('attendance.admin_view')) return;
    const grid = main()?.querySelector('.dashboard-grid');
    if (!grid || grid.querySelector('[data-attendance-card]')) return;
    const card = el('article', null, 'dashboard-card'); card.dataset.attendanceCard = '1'; card.dataset.dashboardCardKey = 'attendance.today';
    card.append(
      el('span', '현재 담당 업무', 'status-label'),
      el('h3', '오늘 출근부'),
      el('p', '앱 GPS와 지문 출근부의 차이·누락을 우선 확인합니다.')
    );
    const button = el('button', '출근부 열기', 'button button-quiet');
    button.type = 'button';
    button.addEventListener('click', () => openAttendance());
    card.append(button);
    grid.prepend(card);
  }

  function sync() { addDashboardCard(); }
  injectStyles();
  document.addEventListener('taejang-app-ready', () => setTimeout(sync, 100));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(sync, 120));
  document.addEventListener('taejang-capabilities-ready', () => setTimeout(sync, 0));
  window.TaejangAttendanceAdmin = { openAttendance, compareEvidence, allExcelRows, addNavigation };
})();
