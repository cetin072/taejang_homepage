(() => {
  'use strict';

  const legacyAllowed = new Set(['promotion_lead', 'operations_manager']);
  const EVIDENCE_SOURCE = 'fingerprint_excel';
  const ALIGNMENT_TOLERANCE_MINUTES = 10;
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
      'GPS와 지문 Excel은 원본 근거로 따로 보존합니다. 10분 이내 차이는 정상 후보로 표시하고, 누락·큰 차이·미매칭만 우선 확인합니다.',
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

  async function openAttendance(workDate = null) {
    if (!can('attendance.admin_view')) return;
    closeSidebar();
    const target = main();
    document.getElementById('desktop-page-title').textContent = '출근부';
    target.hidden = false;
    target.replaceChildren(el('p', '출근부와 지문 근거자료를 불러오고 있습니다.', 'message'));
    try {
      const [data, evidenceData] = await Promise.all([
        app().rpc('get_attendance_admin_today', { p_work_date: workDate }),
        app().rpc('get_attendance_external_evidence', { p_work_date: workDate }),
      ]);
      currentWorkDate = data?.work_date || evidenceData?.work_date || workDate;
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

      const comparisons = rows.map(row => compareEvidence(
        row,
        byEmployee.get(String(row.employee_uuid)) || [],
        fingerprintImported
      ));
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

      const pieces = [intro, makeToolbar(currentWorkDate), summary];
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
