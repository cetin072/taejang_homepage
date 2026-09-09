(() => {
  'use strict';

  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const node = (tag, text, className) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  };
  const kstDate = value => {
    if (!value) return '';
    const d = new Date(value);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(d);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  };
  const kstTime = value => value ? new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value)) : '-';
  const isoForKstInput = (date, time) => `${date}T${time}:00+09:00`;

  function statusLabel(record) {
    if (!record) return '미처리';
    if (record.status === 'recorded') return 'GPS 확인';
    if (record.status === 'exception_approved') return '관리자 승인';
    if (record.status === 'exception_pending') return '확인 필요';
    if (record.status === 'exception_rejected') return '반려';
    if (record.status === 'corrected') return '관리자 보정';
    if (record.status === 'correction_invalidated') return '무효 처리';
    return record.status;
  }

  function injectStyles() {
    if (document.querySelector('style[data-attendance-integrity-ui]')) return;
    const style = document.createElement('style');
    style.dataset.attendanceIntegrityUi = '1';
    style.textContent = `
      .attendance-correction-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin:16px 0;padding:14px;border:1px solid var(--app-border,#ddd);border-radius:14px;background:#fff}
      .attendance-correction-toolbar label{display:grid;gap:6px;font-weight:800}
      .attendance-correction-toolbar input{min-height:44px;padding:8px 10px;border:1px solid #ccc;border-radius:10px;font:inherit}
      .attendance-correction-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
      .attendance-correction-note{margin-top:6px;font-size:14px;line-height:1.45;color:#555}
      .attendance-correction-history{margin-top:6px;padding:8px 10px;border-radius:10px;background:#f5f5f1;font-size:14px;line-height:1.5}
      @media(max-width:720px){.attendance-correction-toolbar{display:grid;grid-template-columns:1fr}.attendance-correction-toolbar .button{width:100%}}
    `;
    document.head.append(style);
  }

  async function enforceAttendanceSubjectUi() {
    const currentRoute = route();
    if (!currentRoute) return;
    try {
      const data = await app().rpc('get_my_attendance_today');
      if (data?.attendance_required !== false) return;
      const cards = [
        document.getElementById('worker-attendance-card'),
        document.getElementById('employee-attendance-card')
      ].filter(Boolean);
      cards.forEach(card => {
        const titleClass = card.id === 'worker-attendance-card' ? 'worker-attendance-state' : 'employee-attendance-state';
        card.replaceChildren(
          node('h2', '오늘 출퇴근'),
          node('p', '근태 기록 대상이 아닙니다.', titleClass)
        );
      });
      document.querySelectorAll('[data-attendance-action],[data-employee-attendance-action],[data-exception-request],[data-employee-exception-request]').forEach(el => el.remove());
    } catch {
      // Existing attendance UI owns its normal error state.
    }
  }

  async function correctionHistory(employeeUuid, workDate) {
    try {
      const history = await app().rpc('get_attendance_correction_history', {
        p_employee_uuid: employeeUuid,
        p_work_date: workDate
      });
      return Array.isArray(history) ? history : [];
    } catch {
      return [];
    }
  }

  function correctionActionButton(label, className = 'button button-quiet') {
    const button = node('button', label, className);
    button.type = 'button';
    return button;
  }

  async function createCorrection({ employeeUuid, workDate, eventType, action, currentRecord }) {
    if (route() !== 'operations_manager') return;
    let correctedEventAt = null;
    if (action === 'set_time') {
      const defaultTime = currentRecord?.event_at && kstDate(currentRecord.event_at) === workDate
        ? kstTime(currentRecord.event_at)
        : eventType === 'clock_in' ? '09:00' : '18:00';
      const entered = window.prompt(
        `${eventType === 'clock_in' ? '출근' : '퇴근'} 시간을 24시간 형식(HH:MM)으로 입력하세요.`,
        defaultTime
      );
      if (!entered) return;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(entered)) {
        window.alert('시간은 예: 09:00 또는 18:30 형식으로 입력해주세요.');
        return;
      }
      correctedEventAt = isoForKstInput(workDate, entered);
    }

    const reason = window.prompt(action === 'set_time'
      ? '보정 사유를 5자 이상 입력하세요.'
      : '무효 처리 사유를 5자 이상 입력하세요.');
    if (!reason || reason.trim().length < 5) {
      window.alert('사유를 5자 이상 입력해야 합니다.');
      return;
    }

    if (!window.confirm(action === 'set_time'
      ? '기존 GPS 기록은 보존되고 보정 이력이 추가됩니다. 진행할까요?'
      : '기존 기록은 삭제되지 않고 무효 처리 이력이 추가됩니다. 진행할까요?')) return;

    const result = await app().rpc('create_attendance_correction', {
      p_employee_uuid: employeeUuid,
      p_work_date: workDate,
      p_event_type: eventType,
      p_action: action,
      p_corrected_event_at: correctedEventAt,
      p_reason: reason.trim()
    });

    if (!result?.ok) {
      const copy = {
        CLOCK_IN_REQUIRED: '먼저 출근 시간을 등록해야 합니다.',
        CLOCK_OUT_EXISTS: '퇴근 기록이 남아 있어 출근만 무효 처리할 수 없습니다. 퇴근부터 정리해주세요.',
        CLOCK_OUT_BEFORE_CLOCK_IN: '퇴근 시간은 출근 시간보다 빠를 수 없습니다.',
        CLOCK_IN_AFTER_CLOCK_OUT: '출근 시간은 퇴근 시간보다 늦을 수 없습니다.',
        NOTHING_TO_INVALIDATE: '현재 무효 처리할 유효 기록이 없습니다.',
        ATTENDANCE_NOT_REQUIRED: '근태 기록 대상이 아닌 직원입니다.',
        OUTSIDE_EMPLOYMENT_PERIOD: '재직기간 밖의 날짜는 보정할 수 없습니다.'
      }[result?.code] || '근태 보정을 처리하지 못했습니다.';
      window.alert(copy);
      return;
    }
    window.alert('근태 보정 이력을 저장했습니다. 원본 기록은 그대로 보존됩니다.');
  }

  async function openCorrectionScreen() {
    if (route() !== 'operations_manager') return;
    const main = document.getElementById('dashboard-main');
    if (!main) return;
    document.getElementById('desktop-app-shell')?.classList.remove('sidebar-open');
    document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
    document.getElementById('desktop-page-title').textContent = '근태 보정';
    main.hidden = false;

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const toolbar = node('section', null, 'attendance-correction-toolbar');
    const label = node('label', '확인 날짜');
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = today;
    label.append(dateInput);
    const loadButton = correctionActionButton('출근부 조회', 'button');
    toolbar.append(label, loadButton);

    const intro = node('header', null, 'dashboard-intro');
    intro.append(
      node('p', '운영총괄 전용', 'eyebrow'),
      node('h2', '근태 기록 보정'),
      node('p', '누락 출퇴근 추가, 시간 정정, 잘못된 기록 무효 처리를 합니다. GPS 원본 기록은 삭제하거나 덮어쓰지 않습니다.')
    );
    const back = correctionActionButton('대시보드로');
    back.addEventListener('click', () => document.dispatchEvent(new CustomEvent('taejang-dashboard-refresh')));
    intro.append(back);
    const list = node('section', null, 'attendance-list');
    main.replaceChildren(intro, toolbar, list);

    const render = async () => {
      const workDate = dateInput.value;
      if (!workDate) return;
      list.replaceChildren(node('p', '출근부를 불러오고 있습니다.', 'message'));
      try {
        const data = await app().rpc('get_attendance_admin_today', { p_work_date: workDate });
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        list.replaceChildren();
        if (!rows.length) {
          list.append(node('p', '이 날짜에 현재 근태 대상 직원이 없습니다.', 'empty'));
          return;
        }
        for (const row of rows) {
          const line = node('article', null, 'attendance-row');
          line.append(node('div', `${row.display_name || '직원'} · ${row.employee_id || ''}`, 'attendance-person'));
          for (const [eventType, labelText] of [['clock_in', '출근'], ['clock_out', '퇴근']]) {
            const record = row[eventType];
            const cell = node('div', null, 'attendance-cell');
            cell.append(
              node('span', labelText, 'eyebrow'),
              node('strong', `${record?.event_at ? kstTime(record.event_at) : '-'} · ${statusLabel(record)}`)
            );
            if (record?.correction_reason) cell.append(node('p', `최근 보정: ${record.correction_reason}`, 'attendance-correction-note'));
            const actions = node('div', null, 'attendance-correction-actions');
            const setTime = correctionActionButton(record?.event_at ? '시간 정정' : '누락 시간 추가');
            setTime.addEventListener('click', async () => {
              try {
                await createCorrection({ employeeUuid: row.employee_uuid, workDate, eventType, action: 'set_time', currentRecord: record });
                await render();
              } catch { window.alert('근태 보정을 처리하지 못했습니다.'); }
            });
            actions.append(setTime);
            if (record?.event_at) {
              const invalidate = correctionActionButton('무효 처리');
              invalidate.addEventListener('click', async () => {
                try {
                  await createCorrection({ employeeUuid: row.employee_uuid, workDate, eventType, action: 'invalidate', currentRecord: record });
                  await render();
                } catch { window.alert('근태 보정을 처리하지 못했습니다.'); }
              });
              actions.append(invalidate);
            }
            cell.append(actions);
            const history = await correctionHistory(row.employee_uuid, workDate);
            const related = history.filter(item => item.event_type === eventType);
            if (related.length) cell.append(node('p', `보정 이력 ${related.length}건 · 최신 사유: ${related[0].reason}`, 'attendance-correction-history'));
            line.append(cell);
          }
          list.append(line);
        }
      } catch {
        list.replaceChildren(node('p', '출근부를 불러오지 못했습니다.', 'message error'));
      }
    };

    loadButton.addEventListener('click', render);
    dateInput.addEventListener('change', render);
    await render();
  }

  function addCorrectionNavigation() {
    if (route() !== 'operations_manager') return;
    const nav = document.getElementById('app-nav');
    if (!nav || nav.querySelector('[data-attendance-correction-nav]')) return;
    const button = correctionActionButton('근태 보정');
    button.dataset.attendanceCorrectionNav = '1';
    button.addEventListener('click', openCorrectionScreen);
    const homepage = [...nav.children].find(child => child.textContent?.trim() === '홈페이지');
    if (homepage) nav.insertBefore(button, homepage); else nav.append(button);
  }

  function sync() {
    injectStyles();
    addCorrectionNavigation();
    setTimeout(enforceAttendanceSubjectUi, 0);
    setTimeout(enforceAttendanceSubjectUi, 250);
  }

  document.addEventListener('taejang-app-ready', sync);
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(addCorrectionNavigation, 100));
  window.TaejangAttendanceIntegrity = { openCorrectionScreen, enforceAttendanceSubjectUi };
})();
