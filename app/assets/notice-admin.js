(() => {
  'use strict';

  const ui = window.TaejangStaffInformationUI;
  let options = null;
  let notices = [];
  let schedules = [];

  function showMessage(value, error = false) {
    ui.message('notice-admin-message', value, error);
  }

  function updateTargets(selected = '') {
    ui.fillTargetSelect(ui.element('notice-scope'), ui.element('notice-target'), options, selected);
  }

  function renderOptions() {
    if (!options) return;
    ui.fillScopeSelect(ui.element('notice-scope'), options);
    updateTargets();
    ui.fillSelect(
      ui.element('notice-related-guide'),
      options.work_guides.filter(guide => guide.status === 'published'),
      '연결하지 않음'
    );
    ui.fillSelect(ui.element('notice-related-schedule'), schedules, '연결하지 않음');
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
    const preview = ui.element('notice-preview');
    preview.replaceChildren();
    const importance = ui.element('notice-importance').value;
    preview.className = `guide-preview importance-${importance}`;
    preview.append(
      ui.text('p', `${ui.IMPORTANCE[importance]} · ${ui.NOTICE_KINDS[ui.element('notice-kind').value] || '공지'}`, 'card-kicker'),
      ui.text('h3', ui.element('notice-title-input').value.trim() || '공지 제목'),
      ui.text('p', ui.element('notice-body').value || '쉬운 안내문을 적어주세요.', 'card-body')
    );
    if (ui.element('notice-requires-ack').checked) preview.append(ui.text('p', '내용 확인이 필요한 공지입니다.', 'status-text'));
  }

  function button(label, handler) {
    const node = ui.text('button', label, 'button button-quiet');
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  }

  async function showAckSummary(item, slot) {
    slot.textContent = '확인 현황을 불러오고 있습니다.';
    try {
      const summary = await window.TaejangApp.rpc('get_notice_ack_summary', { p_notice_id: item.id });
      slot.textContent = summary.requires_acknowledgement
        ? `확인 필요 ${summary.required_count}명 · 확인 ${summary.acknowledged_count}명 · 미확인 ${summary.unacknowledged_count}명`
        : '확인이 필요하지 않은 공지입니다.';
    } catch {
      slot.textContent = '확인 현황을 불러오지 못했습니다.';
    }
  }

  function renderList() {
    const list = ui.element('notice-admin-list');
    list.replaceChildren();
    if (!notices.length) {
      list.append(ui.text('p', '등록된 공지가 없습니다.', 'empty'));
      return;
    }
    notices.forEach(item => {
      const card = document.createElement('article');
      card.className = 'admin-record-card';
      const summary = ui.text('p', '', 'help');
      card.append(
        ui.text('p', `${ui.IMPORTANCE[item.importance]} · ${ui.STATUS[item.status] || item.status} · v${item.version_no}`, 'card-kicker'),
        ui.text('h3', item.title),
        ui.text('p', `게시 시작: ${ui.formatDateTime(item.publish_start_at)}`, 'help'),
        button('공지 수정', () => fillForm(item))
      );
      if (item.requires_acknowledgement) card.append(button('확인 현황', () => showAckSummary(item, summary)), summary);
      list.append(card);
    });
  }

  function resetForm() {
    ui.element('notice-form').reset();
    ui.element('notice-id').value = '';
    const today = window.TaejangApp.getBoardDate();
    ui.element('notice-publish-start-date').value = today;
    ui.element('notice-publish-start-time').value = '08:00';
    ui.element('notice-status').value = 'draft';
    ui.element('notice-importance').value = 'normal';
    renderOptions();
    renderPreview();
  }

  function fillForm(item) {
    ui.element('notice-id').value = item.id;
    ui.element('notice-kind').value = item.notice_kind;
    ui.element('notice-importance').value = item.importance;
    ui.element('notice-title-input').value = item.title || '';
    ui.element('notice-body').value = item.body_easy || '';
    setDateTime('notice-publish-start', item.publish_start_at);
    if (item.publish_end_at) setDateTime('notice-publish-end', item.publish_end_at);
    else {
      ui.element('notice-publish-end-date').value = '';
      ui.element('notice-publish-end-time').value = '';
    }
    ui.element('notice-effective-start').value = item.effective_start_date || '';
    ui.element('notice-effective-end').value = item.effective_end_date || '';
    ui.element('notice-location').value = item.location || '';
    ui.element('notice-materials').value = item.materials_text || '';
    ui.element('notice-related-schedule').value = item.related_schedule_id || '';
    ui.element('notice-related-guide').value = item.related_work_guide_id || '';
    ui.element('notice-link-url').value = item.related_link_url || '';
    ui.element('notice-link-label').value = item.related_link_label || '';
    ui.element('notice-requires-ack').checked = Boolean(item.requires_acknowledgement);
    ui.element('notice-scope').value = item.target_scope;
    updateTargets(ui.targetId(item));
    ui.element('notice-status').value = item.status;
    ui.element('notice-reason').value = '';
    renderPreview();
    ui.element('notice-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function load() {
    if (!options) return;
    ui.element('refresh-notice-admin').disabled = true;
    showMessage('공지 목록을 불러오고 있습니다.');
    try {
      const [noticeRows, scheduleRows] = await Promise.all([
        window.TaejangApp.rpc('list_manageable_notices', { p_limit: 200 }),
        window.TaejangApp.rpc('list_manageable_schedules', { p_include_past: true, p_limit: 200 })
      ]);
      notices = ui.array(noticeRows);
      schedules = ui.array(scheduleRows).map(item => ({ id: item.id, title: item.title }));
      renderOptions();
      renderList();
      showMessage('');
    } catch {
      showMessage('공지 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.', true);
    } finally {
      ui.element('refresh-notice-admin').disabled = false;
    }
  }

  async function submit(event) {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    showMessage('');
    try {
      const target = ui.targetPayload(ui.element('notice-scope'), ui.element('notice-target'));
      const linkUrl = ui.element('notice-link-url').value.trim();
      const linkLabel = ui.element('notice-link-label').value.trim();
      const importance = ui.element('notice-importance').value;
      const requiresAcknowledgement = ui.element('notice-requires-ack').checked;
      if (Boolean(linkUrl) !== Boolean(linkLabel)) throw new Error('LINK_PAIR_REQUIRED');
      if (linkUrl && !ui.safeHttpsUrl(linkUrl)) throw new Error('INVALID_HTTPS_LINK');
      if (requiresAcknowledgement && importance === 'normal') throw new Error('IMPORTANT_ACK_ONLY');
      const result = await window.TaejangApp.rpc('save_notice', {
        p_notice_id: ui.element('notice-id').value || null,
        p_notice_kind: ui.element('notice-kind').value,
        p_importance: importance,
        p_title: ui.element('notice-title-input').value,
        p_body_easy: ui.element('notice-body').value,
        p_publish_start_at: readDateTime('notice-publish-start', true),
        p_publish_end_at: readDateTime('notice-publish-end'),
        p_effective_start_date: ui.element('notice-effective-start').value || null,
        p_effective_end_date: ui.element('notice-effective-end').value || null,
        p_location: ui.element('notice-location').value,
        p_materials_text: ui.element('notice-materials').value,
        p_related_schedule_id: ui.element('notice-related-schedule').value || null,
        p_related_work_guide_id: ui.element('notice-related-guide').value || null,
        p_related_link_url: linkUrl || null,
        p_related_link_label: linkLabel || null,
        p_requires_acknowledgement: requiresAcknowledgement,
        ...target,
        p_status: ui.element('notice-status').value,
        p_change_reason: ui.element('notice-reason').value
      });
      if (!result?.ok) throw new Error(result?.code || 'SAVE_FAILED');
      showMessage(`공지를 저장했습니다. 공지 버전은 ${result.version_no}입니다.`);
      resetForm();
      await load();
      await window.TaejangApp.refreshToday();
    } catch (error) {
      const label = error.message === 'TARGET_REQUIRED' ? '대상을 선택해주세요.'
        : error.message.includes('DATE_TIME') ? '게시 날짜와 시간을 함께 입력해주세요.'
          : error.message === 'LINK_PAIR_REQUIRED' ? '링크 표시명과 HTTPS 주소를 함께 입력해주세요.'
            : error.message === 'INVALID_HTTPS_LINK' ? '관련 링크는 올바른 HTTPS 주소만 사용할 수 있습니다.'
              : error.message === 'IMPORTANT_ACK_ONLY' ? '중요 또는 긴급 공지만 확인이 필요하도록 설정할 수 있습니다.'
                : error.message.startsWith('FORBIDDEN') ? '이 범위의 공지나 관련 자료를 수정할 권한이 없습니다.'
                  : '공지를 저장하지 못했습니다. 게시기간·대상·필수항목을 확인해주세요.';
      showMessage(label, true);
    } finally {
      submit.disabled = false;
    }
  }

  function bind() {
    ui.element('notice-form').addEventListener('submit', submit);
    ui.element('reset-notice-form').addEventListener('click', resetForm);
    ui.element('refresh-notice-admin').addEventListener('click', load);
    ui.element('notice-scope').addEventListener('change', () => updateTargets());
    ui.element('notice-form').addEventListener('input', renderPreview);
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
