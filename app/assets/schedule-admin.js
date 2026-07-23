(() => {
  'use strict';

  const ui = window.TaejangStaffInformationUI;
  let options = null;
  let schedules = [];
  let editing = null;

  function showMessage(value, error = false) {
    ui.message('schedule-admin-message', value, error);
  }

  function updateTargets(selected = '') {
    ui.fillTargetSelect(ui.element('schedule-scope'), ui.element('schedule-target'), options, selected);
  }

  function renderOptions() {
    if (!options) return;
    ui.fillScopeSelect(ui.element('schedule-scope'), options);
    updateTargets();
  }

  function setDateTime(prefix, value) {
    ui.element(`${prefix}-date`).value = ui.kstDate(value);
    ui.element(`${prefix}-time`).value = ui.kstTime(value);
  }

  function readDateTime(prefix, required = false) {
    const date = ui.element(`${prefix}-date`).value;
    const time = ui.element(`${prefix}-time`).value;
    if (!date && !time) return null;
    if (!date || !time) throw new Error(required ? 'DATE_TIME_REQUIRED' : 'DATE_TIME_PAIR_REQUIRED');
    return ui.toKstIso(date, time);
  }

  function renderPreview() {
    const preview = ui.element('schedule-preview');
    preview.replaceChildren();
    const title = ui.element('schedule-title-input').value.trim() || '일정 제목';
    const type = ui.SCHEDULE_TYPES[ui.element('schedule-type').value] || '일정';
    preview.append(ui.text('p', type, 'card-kicker'), ui.text('h3', title));
    const start = ui.toKstIso(ui.element('schedule-start-date').value, ui.element('schedule-start-time').value || '00:00');
    const end = ui.element('schedule-end-date').value
      ? ui.toKstIso(ui.element('schedule-end-date').value, ui.element('schedule-end-time').value || '00:00')
      : null;
    preview.append(ui.text('p', ui.formatRange(start, end, ui.element('schedule-all-day').checked), 'card-primary'));
    if (ui.element('schedule-location').value) preview.append(ui.text('p', `장소: ${ui.element('schedule-location').value}`, 'card-body'));
    preview.append(ui.text('p', ui.element('schedule-easy-text').value || '쉬운 안내문을 적어주세요.', 'card-body'));
  }

  function editButton(label, handler) {
    const button = ui.text('button', label, 'button button-quiet');
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }

  function renderList() {
    const list = ui.element('schedule-admin-list');
    list.replaceChildren();
    if (!schedules.length) {
      list.append(ui.text('p', '등록된 일정이 없습니다.', 'empty'));
      return;
    }
    schedules.forEach(item => {
      const card = document.createElement('article');
      card.className = 'admin-record-card';
      card.append(
        ui.text('p', `${ui.SCHEDULE_TYPES[item.schedule_type] || '일정'} · ${ui.STATUS[item.status] || item.status}`, 'card-kicker'),
        ui.text('h3', item.title),
        ui.text('p', ui.formatRange(item.starts_at, item.ends_at, item.all_day), 'help'),
        editButton('일정 수정', () => fillForm(item))
      );
      list.append(card);
    });
  }

  function resetForm() {
    editing = null;
    ui.element('schedule-form').reset();
    ui.element('schedule-id').value = '';
    const today = window.TaejangApp.getBoardDate();
    ui.element('schedule-start-date').value = today;
    ui.element('schedule-start-time').value = '09:00';
    ui.element('schedule-status').value = 'draft';
    renderOptions();
    renderPreview();
  }

  function fillForm(item) {
    editing = item;
    ui.element('schedule-id').value = item.id;
    ui.element('schedule-type').value = item.schedule_type;
    ui.element('schedule-title-input').value = item.title || '';
    setDateTime('schedule-start', item.starts_at);
    if (item.ends_at) setDateTime('schedule-end', item.ends_at);
    else {
      ui.element('schedule-end-date').value = '';
      ui.element('schedule-end-time').value = '';
    }
    ui.element('schedule-all-day').checked = Boolean(item.all_day);
    ui.element('schedule-location').value = item.location || '';
    ui.element('schedule-manager').value = item.manager_label || '';
    ui.element('schedule-materials').value = item.materials_text || '';
    ui.element('schedule-transport').value = item.transport_method || '';
    if (item.vehicle_departure_at) setDateTime('schedule-vehicle', item.vehicle_departure_at);
    else {
      ui.element('schedule-vehicle-date').value = '';
      ui.element('schedule-vehicle-time').value = '';
    }
    ui.element('schedule-easy-text').value = item.easy_text || '';
    ui.element('schedule-scope').value = item.target_scope;
    updateTargets(ui.targetId(item));
    ui.element('schedule-status').value = item.status;
    ui.element('schedule-reason').value = '';
    renderPreview();
    ui.element('schedule-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function load() {
    if (!options) return;
    ui.element('refresh-schedule-admin').disabled = true;
    showMessage('일정 목록을 불러오고 있습니다.');
    try {
      schedules = ui.array(await window.TaejangApp.rpc('list_manageable_schedules', {
        p_include_past: true,
        p_limit: 200
      }));
      showMessage('');
      renderList();
      document.dispatchEvent(new CustomEvent('taejang-schedule-admin-loaded', { detail: { schedules } }));
    } catch {
      showMessage('일정 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.', true);
    } finally {
      ui.element('refresh-schedule-admin').disabled = false;
    }
  }

  async function submit(event) {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    showMessage('');
    try {
      const target = ui.targetPayload(ui.element('schedule-scope'), ui.element('schedule-target'));
      const startsAt = readDateTime('schedule-start', true);
      const endsAt = readDateTime('schedule-end');
      const vehicleAt = readDateTime('schedule-vehicle');
      const result = await window.TaejangApp.rpc('save_schedule_item', {
        p_schedule_id: ui.element('schedule-id').value || null,
        p_schedule_type: ui.element('schedule-type').value,
        p_title: ui.element('schedule-title-input').value,
        p_starts_at: startsAt,
        p_ends_at: endsAt,
        p_all_day: ui.element('schedule-all-day').checked,
        p_location: ui.element('schedule-location').value,
        p_manager_label: ui.element('schedule-manager').value,
        p_materials_text: ui.element('schedule-materials').value,
        p_transport_method: ui.element('schedule-transport').value,
        p_vehicle_departure_at: vehicleAt,
        p_easy_text: ui.element('schedule-easy-text').value,
        ...target,
        p_status: ui.element('schedule-status').value,
        p_change_reason: ui.element('schedule-reason').value,
        p_external_provider: editing?.external_provider || null,
        p_external_event_id: editing?.external_event_id || null,
        p_last_synced_at: editing?.last_synced_at || null,
        p_sync_direction: editing?.sync_direction || 'none'
      });
      if (!result?.ok) throw new Error(result?.code || 'SAVE_FAILED');
      showMessage('일정을 저장했습니다. 대상과 날짜를 미리보기에서 다시 확인하세요.');
      resetForm();
      await load();
      await window.TaejangApp.refreshToday();
    } catch (error) {
      const label = error.message === 'TARGET_REQUIRED' ? '대상을 선택해주세요.'
        : error.message.includes('DATE_TIME') ? '날짜와 시간을 함께 입력해주세요.'
          : error.message === 'FORBIDDEN' ? '이 범위의 일정을 수정할 권한이 없습니다.'
            : '일정을 저장하지 못했습니다. 필수항목과 시간·대상을 확인해주세요.';
      showMessage(label, true);
    } finally {
      submit.disabled = false;
    }
  }

  function bind() {
    ui.element('schedule-form').addEventListener('submit', submit);
    ui.element('reset-schedule-form').addEventListener('click', resetForm);
    ui.element('refresh-schedule-admin').addEventListener('click', load);
    ui.element('schedule-scope').addEventListener('change', () => updateTargets());
    ui.element('schedule-form').addEventListener('input', renderPreview);
  }

  document.addEventListener('taejang-app-ready', () => {
    if (!window.TaejangApp.isTodayManager()) return;
    bind();
    resetForm();
  }, { once: true });
  document.addEventListener('taejang-admin-options-ready', event => {
    options = event.detail.options;
    renderOptions();
    load();
  });
})();
