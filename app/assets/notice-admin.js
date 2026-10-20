(() => {
  'use strict';

  const ui = window.TaejangStaffInformationUI;
  const mediaApi = () => window.TaejangNoticeMedia;
  let options = null;
  let notices = [];
  let schedules = [];
  let mediaItems = [];
  let removedMedia = [];
  let previewGeneration = 0;
  let activeView = 'manage';
  let savedNoticeId = null;
  let savedStatus = 'draft';
  let reviewPending = false;
  let leadMode = null;
  let leadEditable = true;
  let leadBackendUnavailable = false;
  let saving = false;
  let savedPublishStart = null;
  let publicationUncertain = false;
  let editorReadonly = false;
  let savedPublishEnd = null;
  let listGeneration = 0;
  let pageTotal = 0;
  let hasMore = false;
  let legacyList = false;
  let createResponseUncertain = false;
  let pendingWrite = null;
  let pendingPublication = null;
  let publishEndAuto = false;
  // Default every new notice to the company, preserving legacy targeted edits.
  let existingAudience = null;
  const COMPANY_AUDIENCE = Object.freeze({
    p_target_scope: 'company',
    p_target_department_id: null,
    p_target_work_group_id: null,
    p_target_profile_id: null
  });

  const app = window.TaejangApp;
  function route() { return app?.getRoute?.() || ''; }
  function isOperations() { return route() === 'operations_manager' || route() === 'super_admin'; }
  function isPromotionLead() { return route() === 'promotion_lead'; }

  const ROUTINE_KINDS = new Set(['general','external_activity','training','transport','materials','clothing','company_life']);
  function canEditLeadItem(item) {
    return item.can_lead_edit === true || (item.can_lead_edit === undefined
      && !item.lead_notice_mode && item.status === 'draft' && (!item.review_state || item.review_state === 'none'));
  }
  function canLeadPublish() {
    return isPromotionLead() && !leadBackendUnavailable && leadEditable && !reviewPending && leadMode !== 'review'
      && (leadMode === 'routine' || !ui.element('notice-id').value)
      && (!existingAudience || existingAudience.p_target_scope === 'company')
      && ROUTINE_KINDS.has(ui.element('notice-kind').value)
      && ui.element('notice-importance').value === 'normal' && !ui.element('notice-requires-ack').checked;
  }
  async function saveNotice(payload) {
    const dedicated = isPromotionLead() && (payload.p_target_scope === 'company' || leadMode);
    if (dedicated && leadBackendUnavailable) throw new Error('LEAD_NOTICE_BACKEND_UNAVAILABLE');
    try {
      return await app.rpc(dedicated ? 'save_lead_notice' : 'save_notice', dedicated
        ? { ...payload, p_confirm_routine: ui.element('notice-routine-confirm').checked } : payload);
    } catch (error) {
      // A missing schema-cache function is definitive. Network/permission errors
      // must retain the existing uncertain-response handling, without a retry write.
      if (dedicated && error.status === 404
        && ((error.code === 'PGRST202' && /save_lead_notice/.test(error.message))
          || /Could not find the function public\.save_lead_notice\b.*schema cache/i.test(error.message))) {
        leadBackendUnavailable = true;
        publicationUncertain = false;
        throw new Error('LEAD_NOTICE_BACKEND_UNAVAILABLE');
      }
      throw error;
    }
  }

  function showMessage(value, error = false) {
    ui.message('notice-admin-message', value, error);
  }

  function audiencePayload() {
    if (!existingAudience || existingAudience.p_target_scope === 'company') return { ...COMPANY_AUDIENCE };
    const requiredKey = {
      department: 'p_target_department_id',
      work_group: 'p_target_work_group_id',
      profile: 'p_target_profile_id'
    }[existingAudience.p_target_scope];
    if (!requiredKey || !existingAudience[requiredKey]) throw new Error('NOTICE_TARGET_UNAVAILABLE');
    return { ...existingAudience };
  }

  function audienceLabel(target) {
    const scope = target.p_target_scope;
    if (scope === 'company') return '전체 직원';
    const detail = {
      department: [options?.departments, target.p_target_department_id, '부서'],
      work_group: [options?.work_groups, target.p_target_work_group_id, '작업반'],
      profile: [options?.profiles, target.p_target_profile_id, '개인']
    }[scope];
    if (!detail) return '확인되지 않은 기존 대상';
    const [rows, id, label] = detail;
    const name = ui.array(rows).find(row => row.id === id)?.name;
    return name ? `${label} · ${name}` : `${label} · 기존 설정`;
  }

  function updateAudienceSummary() {
    const note = ui.element('notice-target-summary');
    if (!note) return;
    note.textContent = existingAudience && existingAudience.p_target_scope !== 'company'
      ? `기존 공지 대상: ${audienceLabel(existingAudience)} (수정 시 원래 대상 유지)`
      : '게시 대상: 전체 직원 (자동 적용)';
  }

  function renderOptions() {
    if (!options) return;
    updateAudienceSummary();
    ui.fillSelect(
      ui.element('notice-related-guide'),
      options.work_guides.filter(guide => guide.status === 'published'),
      '연결하지 않음'
    );
    ui.fillSelect(ui.element('notice-related-schedule'), schedules, '연결하지 않음');
    const status = ui.element('notice-status');
    const draftOnly = isPromotionLead() && !isOperations();
    [...status.options].forEach(option => { option.disabled = draftOnly && option.value !== 'draft'; });
    if (draftOnly && savedStatus === 'draft') status.value = 'draft';
    updateActions();
  }

  function updateActions() {
    const draft = savedStatus === 'draft';
    ui.element('notice-save-draft').hidden = !draft;
    const direct = canLeadPublish();
    ui.element('notice-publish').hidden = !draft || !(isOperations() || direct);
    ui.element('notice-routine-confirm-label').hidden = !direct;
    ui.element('notice-routine-policy').hidden = !isPromotionLead();
    const waiting = (reviewPending || !leadEditable) && isPromotionLead();
    ui.element('notice-submit-review').hidden = !draft || !isPromotionLead();
    ui.element('notice-submit-review').disabled = saving || waiting;
    ui.element('notice-save-draft').disabled = saving || waiting;
    ui.element('notice-submit-review').textContent = waiting ? '운영총괄 검토 대기' : '비공개 저장 후 운영총괄 상신';
    ui.element('notice-save-existing').hidden = draft;
    ui.element('notice-management-settings').hidden = draft || !(isOperations() || direct);
    [...ui.element('notice-status').options].forEach(option => {
      option.disabled = !isOperations() ? !(option.value === savedStatus || (direct && option.value === 'inactive'))
        : option.value !== savedStatus && !['published', 'cancelled', 'inactive'].includes(option.value);
    });
    const now = draft && ui.element('notice-publish-mode').value === 'now';
    ui.element('notice-publish-mode-label').hidden = !draft;
    ui.element('notice-publish-mode-label').firstChild.textContent = isPromotionLead() && !direct ? '희망 게시 시각' : '게시 시각';
    ui.element('notice-publish-mode').options[0].textContent = isPromotionLead() && !direct ? '검토 후 게시 (희망)' : '지금 게시';
    ui.element('notice-publish-help').textContent = isPromotionLead() && !direct
      ? '희망 시각은 초안에만 저장됩니다. 실제 게시·예약은 운영총괄이 검토 후 결정합니다.'
      : '지금 게시하면 확인 후 현재 한국 시각(KST)으로 게시합니다. 지정한 예약시각은 날짜·시간 지정에서 사용합니다.';
    ui.element('notice-start-fields').hidden = now;
    for (const suffix of ['date', 'time']) {
      ui.element(`notice-publish-start-${suffix}`).disabled = now;
    }
    ui.element('notice-publish').textContent = ui.element('notice-publish-mode').value === 'scheduled'
      && new Date(`${ui.element('notice-publish-start-date').value}T${ui.element('notice-publish-start-time').value || '00:00'}:00+09:00`) > new Date() ? '게시 예약' : '게시하기';
    ui.element('notice-edit-state').textContent = !draft
      ? savedStatus === 'published' ? '게시 상태를 유지합니다. 저장하면 직원에게 반영됩니다 (대상·기간 조건부). 사진은 순차 반영됩니다. 수정하면 버전이 바뀌며 알림이 다시 발송될 수 있습니다.' : '현재 취소·사용 중지 상태를 유지하여 저장합니다.'
      : waiting ? '운영총괄 검토·승인 자료입니다. 운영팀장은 직접 수정·중지할 수 없습니다.'
      : isPromotionLead() && leadBackendUnavailable ? '공지 서버 기능 반영이 필요합니다. 새 전 직원 공지의 저장·게시·상신은 완료되지 않았습니다. 기존 초안은 기존 대상으로 관리할 수 있습니다.'
      : isPromotionLead() ? direct ? '내 일상 공지입니다. 직접 게시·예약할 수 있습니다. 수정하면 버전이 바뀌며 알림이 다시 발송될 수 있습니다.' : '이 분류·중요도·기존 원고는 운영총괄 검토가 필요합니다. 비공개 저장 후 상신하세요.' : '비공개 저장은 직원에게 보이지 않습니다. 게시하기는 대상과 시각 확인 후 실행합니다.';
    if (editorReadonly || (isPromotionLead() && !leadEditable)) {
      [...ui.element('notice-form').elements].forEach(node => { if (node.id !== 'reset-notice-form') node.disabled = true; });
    }
    if (editorReadonly) {
      for (const id of ['notice-save-draft','notice-save-existing','notice-publish','notice-submit-review']) ui.element(id).hidden = true;
      ui.element('notice-edit-state').textContent = '조회 전용 공지입니다. 조회 권한은 수정·게시·승인 권한과 다릅니다. 보관된 공지는 복구 전 수정할 수 없습니다.';
    }
  }

  function markReviewEdited() {
    if (isPromotionLead() && !leadEditable) return;
    ui.element('notice-routine-confirm').checked = false;
    reviewPending = false;
    updateActions();
  }

  function exposureLabel(item) {
    if (item.review_state === 'submitted') return '운영총괄 검토 대기 — 직원 비공개';
    if (item.status === 'draft') return '비공개 초안 · 초안 저장됨 — 직원 비공개';
    if (item.status === 'cancelled' || item.status === 'inactive') return `취소·사용 중지 · ${ui.STATUS[item.status]}`;
    if (item.status !== 'published') return ui.STATUS[item.status] || item.status;
    if (new Date(item.publish_start_at) > new Date()) return `예약 게시 · 게시 예약됨 — ${ui.formatDateTime(item.publish_start_at)} (KST) 공개 예정`;
    if (item.publish_end_at && new Date(item.publish_end_at) <= new Date()) return '게시 종료 · 게시기간 종료 — 직원 비공개';
    return '게시 중 · 현재 공개됨 — 직원앱에서 확인 가능 (대상·기간 조건부)';
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

  // Only new notices receive the default; a manual end or blank ending is authoritative.
  function syncDefaultPublishEnd() {
    if (!publishEndAuto) return;
    let start;
    try {
      if (ui.element('notice-publish-mode').value === 'now') start = new Date();
      else {
        const scheduled = readDateTime('notice-publish-start', true);
        if (!scheduled) return;
        start = new Date(scheduled);
      }
    } catch {
      return; // Incomplete schedule: never produce a 1970 expiration.
    }
    if (Number.isNaN(start.getTime())) return;
    setDateTime('notice-publish-end', new Date(start.getTime() + 7 * 86400000));
  }

  function notePublishPeriodEdit(event) {
    const id = event.target?.id || '';
    if (id === 'notice-publish-end-date' || id === 'notice-publish-end-time') {
      publishEndAuto = false; // Includes intentional clearing.
    } else if (id === 'notice-publish-mode' || id === 'notice-publish-start-date' || id === 'notice-publish-start-time') {
      syncDefaultPublishEnd();
    }
  }

  function existingMedia(item) {
    return {
      kind: 'existing',
      id: item.id,
      storage_path: item.storage_path,
      mime_type: item.mime_type,
      alt_text: item.alt_text || '공지 사진',
      saved_alt_text: item.alt_text || '공지 사진',
      saved_display_order: item.display_order,
      signed_url: null,
    };
  }

  function pendingMedia(file) {
    const base = String(file.name || '공지 사진').replace(/\.[^.]+$/, '').trim().slice(0, 240) || '공지 사진';
    return {
      kind: 'pending',
      key: crypto.randomUUID(),
      file,
      alt_text: base,
      signed_url: URL.createObjectURL(file),
    };
  }

  function clearMediaState() {
    mediaItems.filter(item => item.kind === 'pending' && item.signed_url).forEach(item => URL.revokeObjectURL(item.signed_url));
    mediaItems = [];
    removedMedia = [];
    const input = ui.element('notice-photo-input');
    if (input) input.value = '';
  }

  async function ensureMediaUrls(items = mediaItems) {
    const api = mediaApi();
    if (!api) return;
    await Promise.all(items.map(async item => {
      if (item.signed_url || item.kind !== 'existing') return;
      item.signed_url = await api.signedUrl(item.storage_path).catch(() => null);
    }));
  }

  function moveMedia(index, direction) {
    const next = index + direction;
    if (next < 0 || next >= mediaItems.length) return;
    [mediaItems[index], mediaItems[next]] = [mediaItems[next], mediaItems[index]];
    markReviewEdited();
    void renderMediaEditor();
    void renderPreview();
  }

  function removeMediaAt(index) {
    const item = mediaItems[index];
    if (!item) return;
    if (item.kind === 'existing') removedMedia.push(item);
    if (item.kind === 'pending' && item.signed_url) URL.revokeObjectURL(item.signed_url);
    mediaItems.splice(index, 1);
    markReviewEdited();
    void renderMediaEditor();
    void renderPreview();
  }

  async function renderMediaEditor() {
    const slot = ui.element('notice-media-editor');
    if (!slot) return;
    slot.replaceChildren();
    await ensureMediaUrls();
    if (!mediaItems.length) {
      slot.append(ui.text('p', '등록할 사진이 없습니다.', 'help'));
      return;
    }

    mediaItems.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'notice-media-edit-card';
      if (item.signed_url) {
        const image = document.createElement('img');
        image.src = item.signed_url;
        image.alt = item.alt_text || '공지 사진';
        image.loading = 'lazy';
        card.append(image);
      } else {
        card.append(ui.text('p', '사진 미리보기를 불러오지 못했습니다.', 'help'));
      }

      const label = document.createElement('label');
      label.textContent = '사진 설명';
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 240;
      input.required = true;
      input.value = item.alt_text || '';
      input.addEventListener('input', () => {
        item.alt_text = input.value;
        void renderPreview();
      });
      label.append(input);

      const actions = document.createElement('div');
      actions.className = 'notice-media-edit-actions';
      const up = button('앞으로', () => moveMedia(index, -1));
      const down = button('뒤로', () => moveMedia(index, 1));
      const remove = button('사진 제거', () => removeMediaAt(index));
      up.disabled = index === 0;
      down.disabled = index === mediaItems.length - 1;
      actions.append(up, down, remove);
      card.append(label, actions);
      slot.append(card);
    });
  }

  async function renderPreview() {
    const generation = ++previewGeneration;
    const preview = ui.element('notice-preview');
    if (!preview) return;
    preview.replaceChildren();

    const importance = ui.element('notice-importance').value;
    preview.className = `guide-preview notice-preview importance-${importance}`;
    preview.append(
      ui.text('p', `${ui.IMPORTANCE[importance]} · ${ui.NOTICE_KINDS[ui.element('notice-kind').value] || '공지'}`, 'card-kicker'),
      ui.text('h3', ui.element('notice-title-input').value.trim() || '공지 제목'),
      ui.text('p', ui.element('notice-body').value || '공지 내용을 적어주세요.', 'notice-body')
    );

    await ensureMediaUrls();
    if (generation !== previewGeneration) return;
    const gallery = document.createElement('div');
    gallery.className = 'notice-photo-gallery';
    mediaItems.filter(item => item.signed_url).forEach(item => {
      const photo = document.createElement('button');
      photo.type = 'button';
      photo.className = 'notice-photo-thumb';
      photo.setAttribute('aria-label', `${item.alt_text || '공지 사진'} 크게 보기`);
      const image = document.createElement('img');
      image.src = item.signed_url;
      image.alt = item.alt_text || '공지 사진';
      photo.append(image);
      photo.addEventListener('click', () => mediaApi()?.openLightbox(item.signed_url, item.alt_text));
      gallery.append(photo);
    });
    if (gallery.childElementCount) preview.append(gallery);

    if (ui.element('notice-requires-ack').checked) {
      preview.append(ui.text('p', '내용 확인이 필요한 공지입니다.', 'status-text'));
    }
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
      const summary = await app.rpc('get_notice_ack_summary', { p_notice_id: item.id });
      slot.textContent = summary.requires_acknowledgement
        ? `확인 필요 ${summary.required_count}명 · 확인 ${summary.acknowledged_count}명 · 미확인 ${summary.unacknowledged_count}명`
        : '확인이 필요하지 않은 공지입니다.';
    } catch {
      slot.textContent = '확인 현황을 불러오지 못했습니다.';
    }
  }

  async function submitForReview(item) {
    if (saving) return;
    const reason = window.prompt('운영총괄에게 상신할 사유를 적어주세요.', '공지 검토 요청');
    if (reason === null) return;
    if (!reason.trim()) {
      showMessage('상신 사유를 입력해주세요.', true);
      return;
    }
    saving = true;
    showMessage('운영총괄에게 공지를 상신하고 있습니다.');
    try {
      const result = await app.rpc('submit_notice_for_operations_review', {
        p_notice_id: item.id,
        p_reason: reason.trim(),
      });
      if (!result?.ok) throw new Error(result?.code || 'SUBMIT_FAILED');
      const verified = await readNotice(item.id);
      if (verified?.id !== item.id || verified.status !== 'draft' || verified.review_state !== 'submitted') throw new Error('SUBMIT_RESULT_UNVERIFIED');
      if (ui.element('notice-id').value === item.id) reviewPending = true;
      ui.element('notice-list-filters').reset();
      const loaded = await load({ preserveMessage: true });
      showSavedNotice(item.id, `운영총괄 검토 대기 — 직원 비공개 · ${verified.title}`, loaded);
    } catch {
      showMessage('공지 상신 결과를 확인하지 못했습니다. 서버에 이미 접수됐을 수 있어 자동 재상신하지 않습니다. 입력을 유지하며 목록에서 최신 상태를 확인해주세요.', true);
    } finally {
      saving = false;
      updateActions();
    }
  }

  function noticeEditorCard() { return ui.element('notice-editor-card'); }
  function noticePreviewCard() { return ui.element('notice-preview-card'); }
  function noticeManageSection() { return ui.element('notice-manage-section'); }

  function revealEditor({ preview = false } = {}) {
    const editor = noticeEditorCard();
    const previewCard = noticePreviewCard();
    if (editor) {
      editor.hidden = false;
      editor.open = true;
    }
    if (previewCard) {
      previewCard.hidden = false;
      // A live preview is always immediately below the writing form, including edit mode.
      previewCard.open = true;
    }
  }

  function hideEditor() {
    const editor = noticeEditorCard();
    const previewCard = noticePreviewCard();
    if (editor) editor.hidden = true;
    if (previewCard) previewCard.hidden = true;
  }

  function renderViewChrome() {
    const heading = ui.element('notice-admin-title');
    const refresh = ui.element('refresh-notice-admin');
    const create = ui.element('new-notice-admin');
    const manage = noticeManageSection();
    if (heading) heading.textContent = activeView === 'create' ? '공지 등록' : activeView === 'archive' ? '공지 보관함' : '공지 관리';
    if (refresh) refresh.hidden = activeView === 'create';
    if (create) create.hidden = activeView === 'create';
    if (manage) manage.hidden = activeView === 'create';
    ui.element('archive-notice-admin').hidden = activeView !== 'manage';
    ui.element('back-notice-admin').hidden = activeView !== 'archive';
    ui.element('notice-manage-title').textContent = activeView === 'archive' ? '보관 · 취소 · 사용 중지 공지' : '등록된 공지';
    for (const option of ui.element('notice-list-status').options) {
      const archiveStatus = ['cancelled','inactive','archived'].includes(option.value);
      option.hidden = Boolean(option.value) && archiveStatus !== (activeView === 'archive');
      option.disabled = option.hidden;
    }
  }

  function showSavedNotice(id, message, loaded, view = 'manage') {
    savedNoticeId = id;
    activeView = view;
    renderViewChrome();
    renderList();
    const found = loaded && notices.some(item => item.id === id);
    showMessage(`저장 완료 · ${message}${!loaded ? ' — 목록 새로고침 실패. 저장은 완료됐습니다.' : !found ? ' — 현재 조회 목록에서 찾지 못했습니다. 저장된 원고는 아래에서 확인할 수 있습니다.' : ''}`);
    if (found) {
      const viewSaved = button('저장한 공지 목록에서 확인', () => {
        const card = ui.element('notice-admin-list').querySelector(`[data-notice-id="${CSS.escape(id)}"]`);
        card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card?.focus({ preventScroll: true });
      });
      ui.element('notice-admin-message').append(document.createTextNode(' '), viewSaved);
    }
    const resultMessage = ui.element('notice-admin-message');
    resultMessage.tabIndex = -1;
    resultMessage.focus({ preventScroll: true });
    resultMessage.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setView(view) {
    if (saving) return;
    const previousView = activeView;
    activeView = ['create','archive'].includes(view) ? view : 'manage';
    if (previousView !== activeView) ui.element('notice-list-filters').reset();
    if (previousView !== activeView && !pendingWrite && !publicationUncertain && !createResponseUncertain) showMessage('');
    renderViewChrome();

    if (activeView === 'create') {
      resetForm();
      revealEditor({ preview: true });
      ui.element('notice-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      hideEditor();
      if (options) void load({ preserveMessage: Boolean(ui.element('notice-admin-message').textContent) });
    }
  }

  function previewItem(item) {
    void openItem(item, { scrollTo: 'preview', readOnly: true });
  }

  const missingRpc = error => error?.code === 'PGRST202';
  async function readNotice(id) {
    try { return await app.rpc('get_manageable_notice', { p_notice_id: id }); }
    catch (error) {
      if (!missingRpc(error)) throw error;
      // Compatibility only while the reviewed migration awaits approval. Never
      // treat absence from a limited list as proof that a write failed.
      const rows = await app.rpc('list_manageable_notices', { p_limit: 500 });
      const item = ui.array(rows).find(row => row.id === id);
      if (!item) throw new Error('NOTICE_READBACK_UNAVAILABLE');
      return item;
    }
  }
  async function openItem(item, settings = {}) {
    if (saving) return;
    try {
      const current = await readNotice(item.id);
      fillForm(current, settings);
    } catch { showMessage('공지 최신 내용을 확인하지 못했습니다. 기존 입력을 보존합니다. 새로고침 후 다시 확인해주세요.', true); }
  }

  function exposure(item) {
    if (item.archived_at) return 'archived';
    if (['inactive','cancelled'].includes(item.status)) return item.status;
    if (item.review_state === 'submitted') return 'review';
    if (item.status === 'draft') return 'draft';
    if (item.publish_end_at && Date.parse(item.publish_end_at) <= Date.now()) return 'expired';
    return Date.parse(item.publish_start_at) > Date.now() ? 'scheduled' : 'active';
  }
  const isArchived = item => Boolean(item.archived_at) || ['inactive','cancelled'].includes(item.status);
  function sortNotices(rows) {
    const rank = item => activeView === 'archive' ? 0 : exposure(item) === 'active' ? 0 : exposure(item) === 'expired' ? 2 : 1;
    const instant = item => Date.parse(activeView === 'archive' ? item.archived_at || item.updated_at || item.created_at
      : exposure(item) === 'expired' ? item.publish_end_at : item.published_at || item.publish_start_at || item.created_at) || 0;
    return [...rows].sort((a,b) => rank(a)-rank(b) || instant(b)-instant(a) || String(a.id).localeCompare(String(b.id), 'en'));
  }

  function reviewLabel(item) {
    if (item.review_state === 'submitted') {
      return isOperations()
        ? `운영팀장 상신 · ${item.submitter_display_name || '상신자'}`
        : '운영총괄 검토 대기';
    }
    if (item.review_state === 'reviewed') return '운영총괄 검토 완료';
    return '';
  }

  function renderList() {
    const list = ui.element('notice-admin-list');
    list.replaceChildren();
    if (!notices.length) {
      list.append(ui.text('p', '등록된 공지가 없습니다.', 'empty'));
      return;
    }
    let group = '';
    sortNotices(notices).forEach(item => {
      const state = exposure(item);
      const nextGroup = activeView === 'archive' ? '보관 자료' : state === 'active' ? '게시 중인 공지' : state === 'expired' ? '게시기간 종료' : '게시 예정 · 검토 대기 · 초안';
      if (group !== nextGroup) { list.append(ui.text('h4', nextGroup, 'notice-list-group')); group = nextGroup; }
      const card = document.createElement('article');
      card.className = `admin-record-card notice-list-row notice-state-${state}`;
      card.dataset.noticeId = item.id;
      card.tabIndex = -1;
      if (item.id === savedNoticeId) {
        card.dataset.savedNotice = '1';
        card.append(ui.text('p', '방금 저장한 공지', 'notice-review-banner'));
      }
      const summary = ui.text('p', '', 'help');
      const review = reviewLabel(item);
      const stateLabel = { active:'게시 중',scheduled:'예약 게시',review:'운영총괄 검토 대기',draft:'비공개 초안',expired:'게시기간 종료',cancelled:'취소',inactive:'사용 중지',archived:'보관' }[state];
      card.append(
        ui.text('p', `${stateLabel} · ${ui.IMPORTANCE[item.importance]} · v${item.version_no}`, 'card-kicker'),
        ui.text('h3', ''),
        ui.text('p', `게시: ${ui.formatDateTime(item.published_at || item.publish_start_at)} · 종료: ${item.publish_end_at ? ui.formatDateTime(item.publish_end_at) : '종료 없음'} (KST)`, 'help')
      );
      if (state === 'scheduled') card.append(ui.text('p', `공개 예정: ${ui.formatDateTime(item.publish_start_at)} (KST)`, 'help'));
      const title = document.createElement('a');
      title.href = '#notice-editor-card'; title.textContent = item.title;
      title.addEventListener('click', event => { event.preventDefault(); void openItem(item, { readOnly: true }); });
      card.querySelector('h3').append(title);
      if (item.archived_at) card.append(ui.text('p', `보관: ${ui.formatDateTime(item.archived_at)} (KST) · ${item.archive_reason || ''}`, 'help'));
      const sourceLabel = item.lead_notice_mode === 'routine' ? ' · 운영팀장 직접 게시 경로' : item.lead_notice_mode ? ' · 운영총괄 검토·처리 경로' : '';
      if (review) card.append(ui.text('p', review, 'notice-review-banner'));
      card.append(ui.text('p', `작성: ${item.creator_display_name || '작성자 기록 없음'}${sourceLabel}`, 'help'));

      const editable = !item.archived_at && item.can_edit !== false && (isOperations() || canEditLeadItem(item));
      const editLabel = !editable ? '공지 보기 (검토·게시 이력)' : isOperations() && item.review_state === 'submitted' ? '상신 공지 검토·수정' : '공지 수정';
      const actions = ui.text('div', '', 'notice-row-actions');
      actions.append(button(editLabel, () => void openItem(item, { readOnly: !editable })), button('미리보기', () => previewItem(item)));
      card.append(actions);
      window.TaejangRecoveryControls?.decorateNoticeCard(item, card, () => load({ preserveMessage: true }));

      if (isPromotionLead() && item.status === 'draft' && canEditLeadItem(item)) {
        if (item.review_state === 'submitted') {
          const waiting = button('운영총괄 검토 대기', () => {});
          waiting.disabled = true;
          card.append(waiting);
        } else {
          card.append(button('운영총괄 상신', () => void submitForReview(item)));
        }
      }

      const canReadAck = item.can_read_ack_summary === true || (item.can_read_ack_summary === undefined
        && !(isPromotionLead() && item.target_scope === 'company'));
      if (item.requires_acknowledgement && canReadAck) card.append(button('확인 현황', () => showAckSummary(item, summary)), summary);
      list.append(card);
    });
  }

  function resetForm() {
    editorReadonly = false;
    pendingWrite = null;
    [...ui.element('notice-form').elements].forEach(node => { node.disabled = false; });
    ui.element('notice-form').reset();
    leadMode = null;
    leadEditable = true;
    ui.element('notice-id').value = '';
    clearMediaState();
    savedStatus = 'draft';
    reviewPending = false;
    ui.element('notice-kind').value = 'general';
    existingAudience = null;
    updateAudienceSummary();
    savedPublishStart = null;
    savedPublishEnd = null;
    publicationUncertain = false;
    pendingPublication = null;
    setDateTime('notice-publish-start', new Date());
    ui.element('notice-publish-mode').value = 'now';
    publishEndAuto = true;
    syncDefaultPublishEnd();
    ui.element('notice-additional-settings').open = false;
    ui.element('notice-status').value = 'draft';
    ui.element('notice-importance').value = 'normal';
    renderOptions();
    void renderMediaEditor();
    void renderPreview();
  }

  function fillForm(item, { scrollTo = 'form', readOnly = false } = {}) {
    if (saving) return;
    [...ui.element('notice-form').elements].forEach(node => { node.disabled = false; });
    leadMode = item.lead_notice_mode || null;
    leadEditable = canEditLeadItem(item);
    editorReadonly = readOnly || Boolean(item.archived_at) || item.can_edit === false;
    pendingWrite = null;
    ui.element('notice-routine-confirm').checked = false;
    savedStatus = item.status;
    reviewPending = item.review_state === 'submitted';
    savedPublishStart = item.publish_start_at;
    savedPublishEnd = item.publish_end_at;
    publicationUncertain = false;
    pendingPublication = null;
    publishEndAuto = false; // Existing notices retain their stored expiry.
    ui.element('notice-publish-mode').value = 'scheduled';
    clearMediaState();
    mediaItems = ui.array(item.media).map(existingMedia);
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
    existingAudience = {
      p_target_scope: item.target_scope,
      p_target_department_id: item.target_department_id || null,
      p_target_work_group_id: item.target_work_group_id || null,
      p_target_profile_id: item.target_profile_id || null
    };
    updateAudienceSummary();
    ui.element('notice-status').value = item.status;
    ui.element('notice-reason').value = '공지 작성·수정';
    updateActions();
    revealEditor({ preview: scrollTo === 'preview' });
    void renderMediaEditor();
    void renderPreview();
    const target = scrollTo === 'preview' ? ui.element('notice-preview') : ui.element('notice-form');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function queryPayload(offset = 0) {
    const until = ui.element('notice-list-until').value;
    return { p_limit: 50, p_offset: offset, p_archive: activeView === 'archive',
      p_search: ui.element('notice-list-search').value.trim() || null,
      p_status: ui.element('notice-list-status').value || null,
      p_from: ui.element('notice-list-from').value ? ui.toKstIso(ui.element('notice-list-from').value, '00:00') : null,
      p_until: until ? new Date(Date.parse(ui.toKstIso(until, '00:00')) + 86400000).toISOString() : null };
  }
  async function fetchNoticePage(offset) {
    const query = queryPayload(offset);
    try {
      const result = await app.rpc('list_manageable_notices_page', query);
      if (!Array.isArray(result?.items) || !Number.isInteger(result.total)) throw new Error('INVALID_NOTICE_PAGE');
      legacyList = false;
      return result;
    } catch (error) {
      if (!missingRpc(error)) throw error;
      legacyList = true;
      const all = ui.array(await app.rpc('list_manageable_notices', { p_limit: 500 }));
      const rows = all.filter(item => isArchived(item) === query.p_archive
        && (!query.p_search || String(item.title).toLocaleLowerCase('ko').includes(query.p_search.toLocaleLowerCase('ko')))
        && (!query.p_status || exposure(item) === query.p_status)
        && (!query.p_from || Date.parse(item.archived_at || item.published_at || item.publish_start_at || item.created_at) >= Date.parse(query.p_from))
        && (!query.p_until || Date.parse(item.archived_at || item.published_at || item.publish_start_at || item.created_at) < Date.parse(query.p_until)));
      return { items: sortNotices(rows), total: rows.length, has_more: false };
    }
  }
  async function load({ preserveMessage = false, more = false } = {}) {
    if (!options) return;
    const generation = ++listGeneration;
    ui.element('refresh-notice-admin').disabled = true;
    ui.element('notice-list-more').disabled = true;
    if (!preserveMessage) showMessage('공지 목록을 불러오고 있습니다.');
    try {
      const [noticeResult, scheduleResult] = await Promise.allSettled([
        fetchNoticePage(more ? notices.length : 0),
        app.rpc('list_manageable_schedules', { p_include_past: true, p_limit: 200 })
      ]);
      if (noticeResult.status !== 'fulfilled') throw noticeResult.reason;
      if (generation !== listGeneration) return false;
      const page = noticeResult.value;
      notices = more ? [...new Map([...notices,...page.items].map(item => [item.id,item])).values()] : page.items;
      pageTotal = page.total;
      hasMore = page.has_more;
      // The optional schedule picker cannot hide a successfully loaded notice list.
      if (scheduleResult.status === 'fulfilled') schedules = ui.array(scheduleResult.value).map(item => ({ id: item.id, title: item.title }));
      renderOptions();
      renderList();
      ui.element('notice-list-summary').textContent = legacyList
        ? '서버 목록 기능 업데이트 필요 · 최대 500건의 제한된 목록입니다. 전체 검색·타인 공지·보관 자료 조회는 아직 확인할 수 없습니다.'
        : `${notices.length} / ${pageTotal}건 · ${activeView === 'archive' ? '최근 보관·중지순' : '최근 발행순 (같은 시각은 공지 ID순)'} · 날짜는 ${activeView === 'archive' ? '보관일, 보관일이 없으면 게시일' : '게시일'} 기준 · KST`;
      ui.element('notice-list-more').hidden = !hasMore;
      if (!preserveMessage) showMessage('');
      return true;
    } catch {
      if (generation !== listGeneration) return false;
      ui.element('notice-list-summary').textContent = '목록 조회 실패 — 이전 결과입니다. 검색 결과가 없다는 뜻이 아닙니다.';
      if (!preserveMessage) showMessage('공지 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.', true);
      return false;
    } finally {
      if (generation === listGeneration) {
        ui.element('refresh-notice-admin').disabled = false;
        ui.element('notice-list-more').disabled = false;
      }
    }
  }

  async function persistMedia(noticeId, reason) {
    const api = mediaApi();
    if (!api) throw new Error('NOTICE_MEDIA_NOT_READY');
    if (mediaItems.length > api.MAX_PHOTOS) throw new Error('NOTICE_MEDIA_LIMIT');

    while (removedMedia.length) {
      const removed = removedMedia[0];
      const result = await app.rpc('archive_notice_media', {
        p_media_id: removed.id,
        p_reason: reason || '공지 사진 자료 수정',
      });
      if (!result?.ok) throw new Error(result?.code || 'NOTICE_MEDIA_REMOVE_FAILED');
      removedMedia.shift();
      await api.remove(removed.storage_path).catch(() => {});
    }

    for (let index = 0; index < mediaItems.length; index += 1) {
      const item = mediaItems[index];
      if (!String(item.alt_text || '').trim()) throw new Error('NOTICE_MEDIA_ALT_REQUIRED');
      if (item.kind === 'existing') {
        if (item.saved_alt_text === item.alt_text.trim() && item.saved_display_order === index) continue;
        const result = await app.rpc('update_notice_media', {
          p_media_id: item.id,
          p_alt_text: item.alt_text.trim(),
          p_display_order: index,
        });
        if (!result?.ok) throw new Error(result?.code || 'NOTICE_MEDIA_UPDATE_FAILED');
        item.saved_alt_text = item.alt_text.trim();
        item.saved_display_order = index;
      } else {
        // Keep successful registrations as existing media before the next upload.
        const uploaded = item.uploaded || await api.upload(noticeId, item.file);
        if (item.uploaded) {
          const current = await readNotice(noticeId).catch(() => {
            throw new Error('NOTICE_MEDIA_REGISTRATION_UNKNOWN');
          });
          const registered = current.media?.find(photo => photo.storage_path === uploaded.storage_path);
          if (registered) {
            URL.revokeObjectURL(item.signed_url);
            Object.assign(item, existingMedia(registered));
            index -= 1;
            continue;
          }
          // A capped/filtered list cannot prove that registration failed.
          // Never re-register or delete an object whose result is uncertain.
          throw new Error('NOTICE_MEDIA_REGISTRATION_UNKNOWN');
        }
        item.uploaded = uploaded;
        const result = await app.rpc('add_notice_media', {
          p_notice_id: noticeId,
          p_storage_path: uploaded.storage_path,
          p_mime_type: uploaded.mime_type,
          p_alt_text: item.alt_text.trim(),
          p_display_order: index,
        }).catch(() => { throw new Error('NOTICE_MEDIA_REGISTRATION_UNKNOWN'); });
        if (!result?.ok) {
          // Preserve the uploaded object even on an ambiguous/conflicting response.
          throw new Error('NOTICE_MEDIA_REGISTRATION_UNKNOWN');
        }
        URL.revokeObjectURL(item.signed_url);
        Object.assign(item, existingMedia({ ...uploaded, id: result.id, alt_text: item.alt_text, display_order: index }));
        delete item.file;
        delete item.uploaded;
      }
    }
  }

  function matchesSaved(item, payload) {
    if (!item || (payload.p_notice_id && item.id !== payload.p_notice_id)) return false;
    return Object.entries(payload).every(([key,value]) => {
      if (['p_notice_id','p_change_reason','p_confirm_routine'].includes(key)) return true;
      const stored = item[key.slice(2)];
      if (key === 'p_publish_start_at' || key === 'p_publish_end_at') return value ? Date.parse(stored) === Date.parse(value) : !stored;
      return (typeof value === 'string' ? value.trim() || null : value ?? null)
        === (typeof stored === 'string' ? stored.trim() || null : stored ?? null);
    });
  }

  async function submit(event) {
    event.preventDefault();
    if (saving || editorReadonly) return;
    if (isPromotionLead() && !leadEditable) { showMessage('검토·승인된 자료는 직접 수정할 수 없습니다.', true); return; }
    const action = event.submitter?.value || (savedStatus === 'draft' ? 'draft' : 'save');
    if (isPromotionLead() && reviewPending && ['review', 'draft'].includes(action)) return;
    saving = true;
    let previousStatus = savedStatus;
    let bodySaved = false;
    let controls = [];
    showMessage('');
    try {
      // A lost publish response must be reconciled before retrying any write.
      if (createResponseUncertain && !ui.element('notice-id').value) throw new Error('CREATE_RESPONSE_UNKNOWN');
      let reconciledWrite = null;
      if (pendingWrite) {
        const current = await readNotice(pendingWrite.id);
        if (!matchesSaved(current, pendingWrite.payload)) throw new Error('NOTICE_SAVE_RESULT_UNKNOWN');
        reconciledWrite = current;
        savedPublishStart = current.publish_start_at;
        savedPublishEnd = current.publish_end_at;
        pendingWrite = null;
      }
      if (publicationUncertain) {
        const current = await readNotice(ui.element('notice-id').value);
        if (!current) throw new Error('PUBLISH_RESULT_UNKNOWN');
        if (current.status === 'published' && pendingPublication && matchesSaved(current, pendingPublication)) reconciledWrite = current;
        savedStatus = previousStatus = current.status;
        savedPublishStart = current.publish_start_at;
        savedPublishEnd = current.publish_end_at;
        publicationUncertain = false;
        pendingPublication = null;
      }
      const target = audiencePayload();
      const linkUrl = ui.element('notice-link-url').value.trim();
      const linkLabel = ui.element('notice-link-label').value.trim();
      const importance = ui.element('notice-importance').value;
      const requiresAcknowledgement = ui.element('notice-requires-ack').checked;
      if (action === 'publish' && !(isOperations() || canLeadPublish())) throw new Error('OPERATIONS_REVIEW_REQUIRED');
      const status = action === 'publish' ? 'published' : savedStatus === 'draft' ? 'draft'
        : ['published', 'cancelled', 'inactive'].includes(ui.element('notice-status').value) ? ui.element('notice-status').value : savedStatus;
      const defaultReason = status === 'inactive'
        ? '공지 사용중지'
        : status === 'cancelled'
          ? '공지 취소'
          : '공지 작성·수정';
      const reason = ui.element('notice-reason').value.trim() || defaultReason;
      if (isPromotionLead() && status !== 'draft' && !ui.element('notice-routine-confirm').checked) throw new Error('ROUTINE_CONFIRM_REQUIRED');
      if (Boolean(linkUrl) !== Boolean(linkLabel)) throw new Error('LINK_PAIR_REQUIRED');
      if (linkUrl && !ui.safeHttpsUrl(linkUrl)) throw new Error('INVALID_HTTPS_LINK');
      if (requiresAcknowledgement && importance === 'normal') throw new Error('IMPORTANT_ACK_ONLY');
      if (mediaItems.length > (mediaApi()?.MAX_PHOTOS || 10)) throw new Error('NOTICE_MEDIA_LIMIT');
      if (mediaItems.some(item => !String(item.alt_text || '').trim())) throw new Error('NOTICE_MEDIA_ALT_REQUIRED');

      let publishStart = savedStatus === 'draft' && ui.element('notice-publish-mode').value === 'now'
        ? new Date().toISOString() : readDateTime('notice-publish-start', true);
      if (reconciledWrite && savedStatus === 'draft' && ui.element('notice-publish-mode').value === 'now') publishStart = reconciledWrite.publish_start_at;
      const unchangedStart = savedPublishStart
        && ui.kstDate(savedPublishStart) === ui.element('notice-publish-start-date').value
        && ui.kstTime(savedPublishStart) === ui.element('notice-publish-start-time').value;
      if (savedStatus !== 'draft' && unchangedStart) publishStart = savedPublishStart;
      if (publishEndAuto && !reconciledWrite) syncDefaultPublishEnd(); // Never move an already committed period while reconciling.
      let publishEnd = readDateTime('notice-publish-end');
      if (savedPublishEnd && ui.kstDate(savedPublishEnd) === ui.element('notice-publish-end-date').value
        && ui.kstTime(savedPublishEnd) === ui.element('notice-publish-end-time').value) publishEnd = savedPublishEnd;
      if (publishEnd && new Date(publishEnd) <= new Date(publishStart)) throw new Error('INVALID_PERIOD');
      if (action === 'publish' && publishEnd && new Date(publishEnd) <= new Date()) throw new Error('INVALID_PERIOD');
      if (action === 'publish' || status !== savedStatus) {
        const targetLabel = audienceLabel(target);
        if (!window.confirm(`${ui.element('notice-title-input').value}\n대상: ${targetLabel}\n분류: ${ui.NOTICE_KINDS[ui.element('notice-kind').value]} · ${ui.IMPORTANCE[importance]}\n게시 시작: ${ui.formatDateTime(publishStart)} (KST)\n게시 종료: ${publishEnd ? ui.formatDateTime(publishEnd) : '종료 없음'}\n${status === 'published' ? new Date(publishStart) > new Date() ? '이 시각에 게시를 예약할까요?' : '직원에게 지금 게시할까요?' : '공지 ' + ui.STATUS[status] + '를 적용할까요?'}`)) return;
      }
      controls = [...ui.element('notice-form').elements].map(node => [node, node.disabled]);
      controls.forEach(([node]) => { node.disabled = true; });
      const payload = {
        p_notice_id: ui.element('notice-id').value || null,
        p_notice_kind: ui.element('notice-kind').value,
        p_importance: importance,
        p_title: ui.element('notice-title-input').value,
        p_body_easy: ui.element('notice-body').value,
        p_publish_start_at: publishStart,
        p_publish_end_at: publishEnd,
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
        p_status: status,
        p_change_reason: reason,
      };
      // A new/unpublished notice stays private until every photo is registered.
      const writePayload = { ...payload, p_status: previousStatus === 'draft' ? 'draft' : status };
      let result;
      try {
        result = reconciledWrite && matchesSaved(reconciledWrite, writePayload)
          ? { ok: true, id: reconciledWrite.id, version_no: reconciledWrite.version_no, lead_notice_mode: reconciledWrite.lead_notice_mode }
          : await saveNotice(writePayload);
      } catch (error) {
        if (error.message !== 'LEAD_NOTICE_BACKEND_UNAVAILABLE' && (!error.status || error.status >= 500)) {
          if (writePayload.p_notice_id) pendingWrite = { id: writePayload.p_notice_id, payload: writePayload };
          else createResponseUncertain = true;
        }
        throw error;
      }
      if (!result?.ok) throw new Error(result?.code || 'SAVE_FAILED');
      if (!result.id || (payload.p_notice_id && result.id !== payload.p_notice_id)) throw new Error('NOTICE_SAVE_RESULT_UNKNOWN');

      // Persist the saved id before photo work starts. If a later upload/RPC
      // fails, retrying the still-open form must update this notice instead of
      // creating a duplicate notice.
      ui.element('notice-id').value = result.id;
      bodySaved = true;
      leadMode = result.lead_notice_mode || leadMode;
      savedStatus = previousStatus === 'draft' ? 'draft' : status;
      ui.element('notice-status').value = savedStatus;
      try {
        await persistMedia(result.id, reason);
      } catch (mediaError) {
        const partialError = new Error(mediaError.message === 'NOTICE_MEDIA_REGISTRATION_UNKNOWN'
          ? 'NOTICE_SAVED_MEDIA_UNCERTAIN' : 'NOTICE_SAVED_MEDIA_FAILED');
        partialError.cause = mediaError;
        throw partialError;
      }
      let reviewState = '';
      if (action === 'publish' && previousStatus === 'draft') {
        publicationUncertain = true;
        pendingPublication = { ...payload, p_notice_id: result.id, p_status: 'published' };
        const published = await saveNotice(pendingPublication);
        publicationUncertain = false;
        pendingPublication = null;
        if (!published?.ok) throw new Error(published?.code || 'PUBLISH_FAILED');
        savedStatus = 'published';
      } else if (action === 'review') {
        if (!isPromotionLead()) throw new Error('OPERATIONS_REVIEW_REQUIRED');
        const submitted = await app.rpc('submit_notice_for_operations_review', { p_notice_id: result.id, p_reason: reason });
        if (!submitted?.ok) throw new Error(submitted?.code || 'SUBMIT_FAILED');
        reviewState = 'submitted';
        reviewPending = true;
        if (isPromotionLead()) leadEditable = false;
      }
      ui.element('notice-status').value = savedStatus;
      savedPublishStart = publishStart;
      savedPublishEnd = publishEnd;
      setDateTime('notice-publish-start', publishStart);
      const finalPayload = { ...payload, p_notice_id: result.id, p_status: savedStatus };
      const verified = await readNotice(result.id).catch(() => {
        pendingWrite = { id: result.id, payload: finalPayload };
        throw new Error('NOTICE_READBACK_UNAVAILABLE');
      });
      if (!matchesSaved(verified, finalPayload) || verified.version_no < result.version_no
        || (reviewState && verified.review_state !== reviewState)
        || ui.array(verified.media).length !== mediaItems.length
        || mediaItems.some((photo,index) => !ui.array(verified.media).some(stored => stored.id === photo.id && stored.alt_text === photo.alt_text.trim() && stored.display_order === index))) {
        pendingWrite = { id: result.id, payload: finalPayload };
        throw new Error('NOTICE_SAVE_RESULT_UNKNOWN');
      }
      const label = exposureLabel(verified);
      activeView = isArchived(verified) ? 'archive' : 'manage';
      ui.element('notice-list-filters').reset();
      const loaded = await load({ preserveMessage: true });
      showSavedNotice(result.id, `${label} · ${verified.title}`, loaded, activeView);
      // Keep the saved id, input and result visible. A new notice is an explicit action.
      revealEditor({ preview: true });
      await renderMediaEditor();
      await renderPreview();
      await app.refreshToday().catch(() => {});
    } catch (error) {
      const message = error.message === 'LEAD_NOTICE_BACKEND_UNAVAILABLE' ? '공지 서버 준비가 완료되지 않았습니다 (PGRST202). 새 전 직원 공지의 저장·게시·상신을 완료하지 못했습니다. 입력·예약 시각·사진을 유지합니다. 관리자에게 공지 DB 기능 반영을 요청해주세요. 기존 초안은 기존 대상으로 관리할 수 있습니다.'
        : error.message === 'ROUTINE_CONFIRM_REQUIRED' ? '근무제도·인사·급여·안전사고·중요 입장이 아닌 일상 안내인지 확인해주세요.'
        : error.message === 'LEAD_COMPANY_ONLY' ? '운영팀장 직접 공지는 전체 직원 대상으로만 작성할 수 있습니다.'
        : error.message === 'LEAD_PUBLIC_CHANGE_FORBIDDEN' ? '게시된 공지를 초안으로 바꾸거나 민감 공지로 직접 수정할 수 없습니다. 운영총괄 검토를 요청해주세요.'
        : error.message === 'LEAD_DRAFT_FIRST' ? '비공개 초안을 먼저 저장해야 합니다. 입력을 유지했으니 비공개 저장부터 다시 시도해주세요.'
        : error.message === 'NOTICE_NOT_SUBMITTABLE' ? '이미 상신됐거나 현재 상태에서 상신할 수 없는 공지입니다. 목록에서 최신 상태를 확인해주세요.'
        : error.message === 'INVALID_NOTICE' ? '서버가 공지 입력값을 거부했습니다. 제목·본문 길이와 기간·링크를 확인해주세요 (22023).'
        : error.message === 'NOTICE_SAVED_MEDIA_UNCERTAIN'
        ? `${savedStatus === 'published' ? '공개 공지 내용과 일부 사진은 이미 반영됐을 수 있습니다. ' : '현재 공지는 직원 비공개로 유지됩니다. '}사진 등록 여부를 확인하지 못해 추가 등록과 파일 삭제를 중단했습니다. 업로드 파일·입력·공지 ID를 보존했습니다.`
        : error.message === 'INVALID_PERIOD' ? '게시 종료 시각은 시작 시각보다 뒤여야 하며, 게시할 때 종료 시각이 지나지 않아야 합니다.'
        : error.message === 'NOTICE_TARGET_UNAVAILABLE' ? '기존 공지 게시 대상 정보가 불완전하여 수정할 수 없습니다. 운영총괄에게 확인해주세요.'
        : error.message.includes('DATE_TIME') ? '게시 날짜와 시간을 함께 입력해주세요.'
          : error.message === 'LINK_PAIR_REQUIRED' ? '링크 표시명과 HTTPS 주소를 함께 입력해주세요.'
            : error.message === 'INVALID_HTTPS_LINK' ? '관련 링크는 올바른 HTTPS 주소만 사용할 수 있습니다.'
              : error.message === 'IMPORTANT_ACK_ONLY' ? '중요 또는 긴급 공지만 확인이 필요하도록 설정할 수 있습니다.'
                : error.message === 'NOTICE_MEDIA_LIMIT' ? '공지 사진은 최대 10장까지 등록할 수 있습니다.'
                  : error.message === 'NOTICE_MEDIA_COMPRESS_TOO_LARGE' ? '사진을 자동 압축했지만 용량이 너무 큽니다. 다른 사진을 사용해주세요.'
                  : error.message === 'NOTICE_MEDIA_DECODE_FAILED' || error.message === 'NOTICE_MEDIA_COMPRESS_FAILED' ? '사진을 처리하지 못했습니다. 다른 사진 파일을 선택해주세요.'
                  : error.message === 'NOTICE_MEDIA_ALT_REQUIRED' ? '모든 사진에 사진 설명을 입력해주세요.'
                    : error.message === 'NOTICE_MEDIA_TYPE_INVALID' ? '사진은 JPG·PNG·WEBP·GIF 파일만 사용할 수 있습니다.'
                          : error.message === 'NOTICE_MEDIA_TOO_LARGE' ? '원본 사진은 15MB 이하 파일을 사용해주세요.'
                            : error.message === 'OPERATIONS_REVIEW_REQUIRED' ? '운영팀장은 공지를 작성 중으로 저장한 뒤 운영총괄에게 상신할 수 있습니다.'
                            : error.message === 'NOTICE_SAVED_MEDIA_FAILED' ? (savedStatus === 'published' ? '공개 공지 내용과 일부 사진은 이미 직원에게 반영됐을 수 있습니다. 사진 저장에 실패했습니다. 입력과 공지 ID는 유지됩니다. 다시 저장해주세요.' : `${savedStatus === 'draft' ? '초안' : ui.STATUS[savedStatus] + ' 공지'}은 저장됐지만 사진 저장에 실패했습니다. 직원에게 공개·상신하지 않았습니다. 입력과 공지 ID는 유지됩니다. 다시 저장해주세요.`)
                            : error.message.startsWith('FORBIDDEN') ? '이 범위의 공지나 사진 자료를 수정할 권한이 없습니다.'
                          : '공지를 저장하지 못했습니다. 게시기간·대상·필수항목·사진을 확인해주세요.';
      const verificationError = ['NOTICE_READBACK_UNAVAILABLE','NOTICE_SAVE_RESULT_UNKNOWN'].includes(error.message);
      showMessage(createResponseUncertain && !ui.element('notice-id').value
        ? '새 공지 저장 응답을 확인하지 못했습니다. 중복 생성을 막기 위해 새 저장을 중단했습니다. 입력과 사진을 보존합니다. 목록에서 저장 여부를 확인해주세요. 자동 재저장은 하지 않습니다.'
        : error.status === 401 && error.code === 'PGRST303'
        ? '로그인 세션을 갱신하지 못해 요청이 거부됐습니다. 입력·사진·공지 ID를 보존했습니다. 다시 로그인한 뒤 저장해주세요. 인증 오류 외의 저장 요청은 자동 재전송하지 않습니다.'
        : verificationError || pendingWrite
        ? '저장 결과 확인이 필요합니다. 동일 공지 ID의 서버 내용·버전·사진 재조회를 확인하지 못해 저장 완료로 표시하지 않습니다. 입력과 ID를 보존하며 자동 재게시하지 않습니다.'
        : publicationUncertain
        ? '게시 응답을 확인하지 못했습니다. 공개 여부는 아직 확정할 수 없습니다. 입력과 공지 ID는 유지되며, 다시 저장하면 먼저 서버 상태를 확인합니다.'
        : bodySaved && !['NOTICE_SAVED_MEDIA_FAILED', 'NOTICE_SAVED_MEDIA_UNCERTAIN'].includes(error.message)
        ? `공지 내용은 저장됐습니다 (${savedStatus === 'draft' ? '직원 비공개' : '현재 상태 유지'}). 게시·상신을 완료하지 못했습니다. ${message}` : message, true);
      if (['LINK_PAIR_REQUIRED', 'INVALID_HTTPS_LINK'].includes(error.message)) {
        const destination = !ui.element('notice-link-url').value.trim() ? 'notice-link-url'
          : !ui.element('notice-link-label').value.trim() ? 'notice-link-label' : 'notice-link-url';
        ui.element(destination).focus();
      } else {
        ui.element('notice-additional-settings').open = true;
      }
    } finally {
      controls.forEach(([node, disabled]) => { node.disabled = disabled; });
      saving = false;
      updateActions();
    }
  }

  function addSelectedPhotos(event) {
    if (saving) return;
    const api = mediaApi();
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length || !api) return;

    try {
      if (mediaItems.length + files.length > api.MAX_PHOTOS) throw new Error('NOTICE_MEDIA_LIMIT');
      files.forEach(file => {
        api.validateFile(file);
        mediaItems.push(pendingMedia(file));
      });
      markReviewEdited();
      void renderMediaEditor();
      void renderPreview();
    } catch (error) {
      const message = error.message === 'NOTICE_MEDIA_LIMIT' ? '공지 사진은 최대 10장까지 등록할 수 있습니다.'
        : error.message === 'NOTICE_MEDIA_TOO_LARGE' ? '원본 사진은 15MB 이하 파일을 사용해주세요.'
          : '사진은 JPG·PNG·WEBP·GIF 파일만 사용할 수 있습니다.';
      showMessage(message, true);
    }
  }

  function bind() {
    ui.element('notice-form').addEventListener('submit', submit);
    ui.element('notice-form').addEventListener('invalid', event => {
      const details = event.target.closest('details');
      if (details) details.open = true;
      showMessage(event.target.id === 'notice-link-url'
        ? '관련 링크는 올바른 HTTPS 주소(https://)를 입력해주세요.'
        : '필수항목과 입력 형식을 확인해주세요.', true);
    }, true);
    ui.element('notice-form').addEventListener('change', event => {
      notePublishPeriodEdit(event);
      if (event.target.id === 'notice-routine-confirm') updateActions();
      else if (event.target.id !== 'notice-photo-input') markReviewEdited();
    });
    ui.element('reset-notice-form').addEventListener('click', () => {
      if (saving) return;
      resetForm();
      showMessage('새 공지를 작성합니다. 이전 저장 결과는 공지 관리 목록에서 확인할 수 있습니다.');
      revealEditor({ preview: true });
    });
    ui.element('new-notice-admin').addEventListener('click', () => setView('create'));
    ui.element('archive-notice-admin').addEventListener('click', () => setView('archive'));
    ui.element('back-notice-admin').addEventListener('click', () => setView('manage'));
    ui.element('notice-list-filters').addEventListener('submit', event => { event.preventDefault(); if (!saving) void load(); });
    ui.element('notice-clear-filters').addEventListener('click', () => { if (!saving) { ui.element('notice-list-filters').reset(); void load(); } });
    ui.element('notice-list-more').addEventListener('click', () => { if (!saving) void load({ more: true }); });
    ui.element('refresh-notice-admin').addEventListener('click', () => { if (!saving) void load(); });
    ui.element('notice-photo-input').addEventListener('change', addSelectedPhotos);
    ui.element('notice-form').addEventListener('input', event => {
      notePublishPeriodEdit(event);
      if (event.target.id === 'notice-routine-confirm') updateActions();
      else if (event.target.id !== 'notice-photo-input') markReviewEdited();
      void renderPreview();
    });
  }

  function canManageNotices() {
    const current = app;
    if (!current?.hasCapabilityContract?.()) return Boolean(current?.isTodayManager?.());
    return Boolean(app.can?.('notice.manage'));
  }

  document.addEventListener('taejang-app-ready', () => {
    if (!canManageNotices()) return;
    bind();
    resetForm();
  }, { once: true });

  document.addEventListener('taejang-admin-options-ready', event => {
    options = event.detail.options;
    renderOptions();
    void load().then(() => {
      if (activeView === 'manage') hideEditor();
    });
  });

  document.addEventListener('taejang-open-notice-admin', event => {
    if (!canManageNotices()) return;
    setView(event.detail?.view);
  });

  window.TaejangNoticeAdmin = { setView, renderPreview };
})();
