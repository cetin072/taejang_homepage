(() => {
  'use strict';

  const legacyAllowed = new Set(['promotion_lead', 'operations_manager']);
  const EVIDENCE_SOURCE = 'fingerprint_excel';
  const ALIGNMENT_TOLERANCE_MINUTES = 5;
  let currentWorkDate = null;

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

  function injectStyles() {
    if (document.querySelector('style[data-attendance-admin]')) return;
    const style = document.createElement('style');
    style.dataset.attendanceAdmin = '1';
    style.textContent = `
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

    toolbar.append(el(
      'p',
      'GPS와 지문 Excel은 원본 근거로 따로 보존합니다. 5분 이내 차이는 정상 후보로 표시하고, 누락·큰 차이·미매칭만 우선 확인합니다.',
      'attendance-evidence-help'
    ));
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
        ? `확정 시각: ${revision?.confirmed_at ? new Date(revision.confirmed_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'} · snapshot ${revision?.snapshot_fingerprint || '-'}`
        : pending.length
          ? `확정 전 해결할 항목이 ${pending.length}건 있습니다. 출근·퇴근 누락은 실제 시간을 입력하고, 판단이 필요한 예외만 확인 사유를 남긴 뒤 하루 전체를 확정합니다.`
          : '모든 필수 확인 항목이 해소되었습니다. 이 날짜의 전체 출근부를 한 번에 확정할 수 있습니다.'),
    );
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
      panel.append(list);
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
          line.append(
            el('strong', `${row?.work_date || '-'} · ${row?.display_name_at_confirmation || '직원'} · v${row?.revision_no || '-'}`),
            el('span', `출근 ${time(row?.clock_in_at)} / 퇴근 ${time(row?.clock_out_at)} · record ${row?.record_fingerprint || '-'}`),
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

  async function openAttendance(workDate = null) {
    if (!can('attendance.admin_view')) return;
    closeSidebar();
    const target = main();
    document.getElementById('desktop-page-title').textContent = '출근부';
    target.hidden = false;
    target.replaceChildren(el('p', '출근부와 지문 근거자료를 불러오고 있습니다.', 'message'));
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
      const data = rosterResult.value;
      const evidenceAvailable = evidenceResult.status === 'fulfilled';
      const confirmationAvailable = confirmationResult.status === 'fulfilled';
      const workdayAvailable = dayStatusResult.status === 'fulfilled';
      const holidayAssignmentsAvailable = holidayAssignmentsResult.status === 'fulfilled';
      const evidenceData = evidenceAvailable ? evidenceResult.value : null;
      const confirmation = confirmationAvailable ? confirmationResult.value : null;
      const dayStatus = workdayAvailable ? dayStatusResult.value : null;
      const holidayAssignments = holidayAssignmentsAvailable ? holidayAssignmentsResult.value : null;
      currentWorkDate = data?.work_date || requestedWorkDate;
      const rows = Array.isArray(data?.rows) ? data.rows : [];
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
        ? rows.map(row => compareEvidence(row, byEmployee.get(String(row.employee_uuid)) || [], fingerprintImported))
        : rows.map(() => ({ label: '지문 근거자료 서버 동기화 필요', needsReview: true }));
      const reviewCount = comparisons.filter(item => item.needsReview).length
        + unmatched.length
        + rows.filter(row => row.clock_in?.status === 'exception_pending' || row.clock_out?.status === 'exception_pending').length;
      const alignedCount = comparisons.filter(item => !item.needsReview && fingerprintImported).length;

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
        summaryCard('정상 후보', alignedCount),
        summaryCard('확인 필요', reviewCount),
        summaryCard('지문 미매칭', unmatched.length)
      );

      const list = el('section', null, 'attendance-list');
      if (!rows.length) list.append(el('p', '현재 출퇴근 대상 직원 계정이 없습니다.', 'empty'));
      rows.forEach((row, index) => {
        const evidence = byEmployee.get(String(row.employee_uuid)) || [];
        const fingerprint = evidence.length === 1 ? evidence[0] : null;
        const comparison = comparisons[index];
        const line = el('article', null, 'attendance-row');
        const person = el('div', null, 'attendance-person');
        person.append(
          document.createTextNode(row.display_name || '직원'),
          el('span', row.employee_id || '', 'attendance-evidence-line')
        );
        const compare = el('div', comparison.label, 'attendance-compare');
        compare.dataset.review = String(comparison.needsReview);
        line.append(
          person,
          cell('출근', row.clock_in, fingerprint?.clock_in_at),
          cell('퇴근', row.clock_out, fingerprint?.clock_out_at),
          compare
        );
        list.append(line);
      });

      const pieces = [intro, makeToolbar(currentWorkDate)];
      if (!evidenceAvailable) pieces.push(syncRequiredPanel('지문 근거자료'));
      if (!workdayAvailable || !holidayAssignmentsAvailable) {
        pieces.push(syncRequiredPanel('휴일근무 지정'));
      } else {
        const holidayPanel = holidayWorkPanel(dayStatus, holidayAssignments, rows, currentWorkDate);
        if (holidayPanel) pieces.push(holidayPanel);
      }
      pieces.push(confirmationAvailable
        ? confirmationPanel(confirmation, currentWorkDate)
        : syncRequiredPanel('일일 근태 확정'));
      pieces.push(confirmedLedgerPanel(currentWorkDate), summary);
      const unmatchedNode = unmatchedPanel(unmatched, rows, currentWorkDate);
      if (unmatchedNode) pieces.push(unmatchedNode);
      pieces.push(list);
      target.replaceChildren(...pieces);
    } catch {
      target.replaceChildren(el('p', '출근부를 불러오지 못했습니다.', 'message error'));
    }
  }

  function addNavigation() {
    if (!can('attendance.admin_view')) return;
    const nav = document.getElementById('app-nav');
    if (!nav || nav.querySelector('[data-attendance-nav]')) return;
    const button = el('button', '출근부', 'button button-quiet');
    button.type = 'button'; button.dataset.attendanceNav = '1';
    button.addEventListener('click', () => openAttendance());
    const homepage = [...nav.children].find(child => child.textContent?.trim() === '홈페이지');
    if (homepage) nav.insertBefore(button, homepage); else nav.append(button);
  }

  function addDashboardCard() {
    if (!can('attendance.admin_view')) return;
    const grid = main()?.querySelector('.dashboard-grid');
    if (!grid || grid.querySelector('[data-attendance-card]')) return;
    const card = el('article', null, 'dashboard-card'); card.dataset.attendanceCard = '1';
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

  function sync() { addNavigation(); addDashboardCard(); }
  injectStyles();
  document.addEventListener('taejang-app-ready', () => setTimeout(sync, 100));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(sync, 120));
  document.addEventListener('taejang-capabilities-ready', () => setTimeout(sync, 0));
  window.TaejangAttendanceAdmin = { openAttendance, compareEvidence, allExcelRows };
})();
