(() => {
  'use strict';

  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const canCorrect = () => app()?.hasCapabilityContract?.()
    ? Boolean(app()?.can?.('attendance.correct'))
    : new Set(['promotion_lead', 'operations_manager']).has(route());
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
  const TIME_VALUE_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

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
      .attendance-correction-dialog{width:min(520px,calc(100vw - 28px));padding:0;border:0;border-radius:16px;box-shadow:0 20px 64px rgba(0,0,0,.24)}
      .attendance-correction-dialog::backdrop{background:rgba(15,23,42,.48)}
      .attendance-correction-dialog form{display:grid;gap:14px;padding:22px}
      .attendance-correction-dialog h2,.attendance-correction-dialog p{margin:0}
      .attendance-correction-dialog label{display:grid;gap:7px;font-weight:800}
      .attendance-correction-dialog input,.attendance-correction-dialog select,.attendance-correction-dialog textarea{width:100%;min-height:44px;padding:8px 10px;border:1px solid #bbb;border-radius:9px;background:#fff;font:inherit;box-sizing:border-box}
      .attendance-time-picker-field{display:grid;gap:8px;font-weight:800}
      .attendance-time-picker{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center}
      .attendance-time-picker__colon{font-size:24px;font-weight:900;text-align:center}
      .attendance-time-picker select{min-height:50px;font-size:18px;font-weight:800}
      .attendance-direct-time{border:1px solid #e1e5e2;border-radius:10px;padding:10px 12px;background:#fafbf9}
      .attendance-direct-time summary{cursor:pointer;font-weight:750;color:#53675d}
      .attendance-direct-time label{margin-top:10px}
      .attendance-correction-dialog textarea{min-height:96px;resize:vertical}
      .attendance-correction-dialog__actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
      .attendance-correction-dialog__error{min-height:1.4em;color:#9f1d1d;font-weight:700}
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

  function correctionErrorMessage(code) {
    return {
      CLOCK_IN_REQUIRED: '먼저 출근 시간을 등록해야 합니다.',
      CLOCK_OUT_EXISTS: '퇴근 기록이 남아 있어 출근만 무효 처리할 수 없습니다. 퇴근부터 정리해주세요.',
      CLOCK_OUT_BEFORE_CLOCK_IN: '퇴근 시간은 출근 시간보다 빠를 수 없습니다.',
      CLOCK_IN_AFTER_CLOCK_OUT: '출근 시간은 퇴근 시간보다 늦을 수 없습니다.',
      NOTHING_TO_INVALIDATE: '현재 무효 처리할 유효 기록이 없습니다.',
      ATTENDANCE_NOT_REQUIRED: '근태 기록 대상이 아닌 직원입니다.',
      OUTSIDE_EMPLOYMENT_PERIOD: '재직기간 밖의 날짜는 보정할 수 없습니다.',
      FORBIDDEN: '근태 보정 권한이 없습니다.',
      WORK_DATE_REQUIRED: '보정할 날짜를 선택해주세요.',
      INVALID_EVENT_TYPE: '출근 또는 퇴근 기록만 보정할 수 있습니다.',
      INVALID_CORRECTION_ACTION: '지원하지 않는 근태 보정 방식입니다.',
      CORRECTED_TIME_REQUIRED: '보정할 시간을 입력해주세요.',
      CORRECTED_TIME_DATE_MISMATCH: '선택한 날짜의 시간만 입력할 수 있습니다.',
      FUTURE_ATTENDANCE_TIME: '미래 시각은 근태 기록으로 입력할 수 없습니다.',
      INVALIDATED_TIME_MUST_BE_NULL: '무효 처리에는 별도 시간을 입력할 수 없습니다.',
      REASON_REQUIRED: '기존 기록을 변경하거나 무효화할 때는 사유를 5자 이상 입력해야 합니다.',
      EMPLOYEE_NOT_FOUND: '직원 정보를 찾을 수 없습니다. 출근부를 다시 불러와주세요.'
    }[code] || `근태 보정을 처리하지 못했습니다${code ? ` (${code})` : ''}.`;
  }

  function openCorrectionDialog({ workDate, eventType, action, currentRecord }) {
    return new Promise(resolve => {
      const isSetTime = action === 'set_time';
      const isMissingBackfill = isSetTime && !currentRecord?.event_at;
      const defaultTime = currentRecord?.event_at && kstDate(currentRecord.event_at) === workDate
        ? kstTime(currentRecord.event_at)
        : eventType === 'clock_in' ? '09:00' : '18:00';
      const dialog = document.createElement('dialog');
      dialog.className = 'attendance-correction-dialog';
      dialog.setAttribute('aria-labelledby', 'attendance-correction-dialog-title');
      const form = document.createElement('form');
      form.method = 'dialog';
      const title = node('h2', isSetTime
        ? `${eventType === 'clock_in' ? '출근' : '퇴근'} 시간 ${isMissingBackfill ? '추가' : '정정'}`
        : `${eventType === 'clock_in' ? '출근' : '퇴근'} 기록 무효 처리`);
      title.id = 'attendance-correction-dialog-title';
      form.append(title);
      form.append(node('p', isMissingBackfill
        ? '누락 시간을 수기 입력합니다. 입력자와 입력시각은 자동 기록되며, 원본 근거는 변경하지 않습니다.'
        : '원본 기록은 삭제하지 않고 append-only 보정 이력을 추가합니다.'));

      let timeInput = null;
      let hourSelect = null;
      let minuteSelect = null;
      if (isSetTime) {
        const [defaultHour, defaultMinute] = defaultTime.split(':');
        const pickerField = node('div', null, 'attendance-time-picker-field');
        pickerField.append(node('span', `${eventType === 'clock_in' ? '출근' : '퇴근'} 시간 선택`));
        const picker = node('div', null, 'attendance-time-picker');

        hourSelect = document.createElement('select');
        hourSelect.name = 'corrected-hour';
        hourSelect.setAttribute('aria-label', '시 선택');
        for (let hour = 0; hour < 24; hour += 1) {
          const value = String(hour).padStart(2, '0');
          hourSelect.append(new Option(`${value}시`, value, false, value === defaultHour));
        }

        minuteSelect = document.createElement('select');
        minuteSelect.name = 'corrected-minute';
        minuteSelect.setAttribute('aria-label', '분 선택');
        for (let minute = 0; minute < 60; minute += 1) {
          const value = String(minute).padStart(2, '0');
          minuteSelect.append(new Option(`${value}분`, value, false, value === defaultMinute));
        }

        picker.append(hourSelect, node('span', ':', 'attendance-time-picker__colon'), minuteSelect);
        pickerField.append(picker);

        const direct = document.createElement('details');
        direct.className = 'attendance-direct-time';
        const summary = document.createElement('summary');
        summary.textContent = '직접 입력이 필요한 경우 (HH:MM)';
        const directLabel = node('label', '시간 직접 입력');
        timeInput = document.createElement('input');
        timeInput.type = 'time';
        timeInput.name = 'corrected-time';
        timeInput.value = defaultTime;
        directLabel.append(timeInput);
        direct.append(summary, directLabel);
        pickerField.append(direct);

        const syncDirectInput = () => {
          timeInput.value = `${hourSelect.value}:${minuteSelect.value}`;
        };
        hourSelect.addEventListener('change', syncDirectInput);
        minuteSelect.addEventListener('change', syncDirectInput);
        timeInput.addEventListener('input', () => {
          const match = String(timeInput.value || '').match(TIME_VALUE_PATTERN);
          if (!match) return;
          hourSelect.value = match[1];
          minuteSelect.value = match[2];
        });

        form.append(pickerField);
      }

      let reasonInput = null;
      if (!isMissingBackfill) {
        const reasonLabel = node('label', isSetTime ? '시간 변경 사유 (5자 이상)' : '무효 처리 사유 (5자 이상)');
        reasonInput = document.createElement('textarea');
        reasonInput.name = 'reason';
        reasonInput.minLength = 5;
        reasonInput.maxLength = 300;
        reasonInput.required = true;
        reasonInput.placeholder = '변경 또는 무효 처리 사유를 입력하세요.';
        reasonLabel.append(reasonInput);
        form.append(reasonLabel);
      }

      const error = node('p', '', 'attendance-correction-dialog__error');
      error.setAttribute('aria-live', 'polite');
      form.append(error);
      const actions = node('div', null, 'attendance-correction-dialog__actions');
      const cancel = correctionActionButton('취소');
      cancel.addEventListener('click', () => dialog.close('cancel'));
      const submit = correctionActionButton(isSetTime ? '보정 저장' : '무효 처리', 'button');
      submit.type = 'submit';
      submit.value = 'save';
      actions.append(cancel, submit);
      form.append(actions);
      dialog.append(form);
      document.body.append(dialog);

      form.addEventListener('submit', event => {
        if (event.submitter?.value !== 'save') return;
        const timeValue = isSetTime ? `${hourSelect?.value || ''}:${minuteSelect?.value || ''}` : '';
        const reason = reasonInput?.value.trim() || null;
        if (isSetTime && !TIME_VALUE_PATTERN.test(timeValue)) {
          event.preventDefault();
          error.textContent = '시간을 시·분 선택에서 골라주세요.';
          hourSelect?.focus();
          return;
        }
        if (!isMissingBackfill && (!reason || reason.length < 5)) {
          event.preventDefault();
          error.textContent = '기존 기록을 변경하거나 무효화할 때는 사유를 5자 이상 입력해야 합니다.';
          reasonInput?.focus();
        }
      });
      dialog.addEventListener('close', () => {
        const saved = dialog.returnValue === 'save';
        const value = saved ? {
          correctedEventAt: isSetTime ? isoForKstInput(workDate, `${hourSelect.value}:${minuteSelect.value}`) : null,
          reason: reasonInput?.value.trim() || null,
          isMissingBackfill
        } : null;
        dialog.remove();
        resolve(value);
      }, { once: true });
      dialog.showModal();
      (hourSelect || reasonInput || submit).focus();
    });
  }

  async function createCorrection({ employeeUuid, workDate, eventType, action, currentRecord }) {
    if (!canCorrect()) return;
    const input = await openCorrectionDialog({ workDate, eventType, action, currentRecord });
    if (!input) return false;

    const result = await app().rpc('create_attendance_correction', {
      p_employee_uuid: employeeUuid,
      p_work_date: workDate,
      p_event_type: eventType,
      p_action: action,
      p_corrected_event_at: input.correctedEventAt,
      p_reason: input.reason
    });

    if (!result?.ok) {
      throw new Error(correctionErrorMessage(result?.code));
    }
    window.alert(input.isMissingBackfill ? '누락 시간을 저장했습니다. 입력자와 입력시각은 자동 기록됩니다.' : '근태 보정 이력을 저장했습니다. 원본 기록은 그대로 보존됩니다.');
    return true;
  }

  async function openCorrectionScreen() {
    if (!canCorrect()) return;
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
      node('p', '근태 보정 권한', 'eyebrow'),
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
                if (await createCorrection({ employeeUuid: row.employee_uuid, workDate, eventType, action: 'set_time', currentRecord: record })) await render();
              } catch (error) { window.alert(error.message || '근태 보정을 처리하지 못했습니다.'); }
            });
            actions.append(setTime);
            if (record?.event_at) {
              const invalidate = correctionActionButton('무효 처리');
              invalidate.addEventListener('click', async () => {
                try {
                  if (await createCorrection({ employeeUuid: row.employee_uuid, workDate, eventType, action: 'invalidate', currentRecord: record })) await render();
                } catch (error) { window.alert(error.message || '근태 보정을 처리하지 못했습니다.'); }
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
    if (!canCorrect()) return;
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
  document.addEventListener('taejang-capabilities-ready', () => setTimeout(addCorrectionNavigation, 0));
  async function addMissingTime({ employeeUuid, workDate, eventType }) {
    return createCorrection({
      employeeUuid,
      workDate,
      eventType,
      action: 'set_time',
      currentRecord: null
    });
  }

  window.TaejangAttendanceIntegrity = { openCorrectionScreen, enforceAttendanceSubjectUi, addMissingTime };
})();
