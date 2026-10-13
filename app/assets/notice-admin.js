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
  let savedStatus = 'draft';
  let reviewPending = false;
  let leadMode = null;
  let leadEditable = true;
  let saving = false;
  let savedPublishStart = null;
  let publicationUncertain = false;

  const app = window.TaejangApp;
  function route() { return app?.getRoute?.() || ''; }
  function isOperations() { return route() === 'operations_manager' || route() === 'super_admin'; }
  function isPromotionLead() { return route() === 'promotion_lead'; }

  const ROUTINE_KINDS = new Set(['general','external_activity','training','transport','materials','clothing','company_life']);
  function canLeadPublish() {
    return isPromotionLead() && leadEditable && !reviewPending && leadMode !== 'review'
      && (leadMode === 'routine' || !ui.element('notice-id').value)
      && ui.element('notice-scope').value === 'company'
      && ROUTINE_KINDS.has(ui.element('notice-kind').value)
      && ui.element('notice-importance').value === 'normal' && !ui.element('notice-requires-ack').checked;
  }
  async function saveNotice(payload) {
    const dedicated = isPromotionLead() && (payload.p_target_scope === 'company' || leadMode);
    return app.rpc(dedicated ? 'save_lead_notice' : 'save_notice', dedicated
      ? { ...payload, p_confirm_routine: ui.element('notice-routine-confirm').checked } : payload);
  }

  function showMessage(value, error = false) {
    ui.message('notice-admin-message', value, error);
  }

  function updateTargets(selected = '') {
    ui.fillTargetSelect(ui.element('notice-scope'), ui.element('notice-target'), options, selected);
  }

  function renderOptions() {
    if (!options) return;
    ui.fillScopeSelect(ui.element('notice-scope'), { ...options, company_allowed: options.company_allowed || isPromotionLead() });
    updateTargets(ui.element('notice-target').value);
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
    for (const suffix of ['date', 'time']) {
      ui.element(`notice-publish-start-${suffix}`).disabled = now;
    }
    ui.element('notice-publish').textContent = ui.element('notice-publish-mode').value === 'scheduled'
      && new Date(`${ui.element('notice-publish-start-date').value}T${ui.element('notice-publish-start-time').value || '00:00'}:00+09:00`) > new Date() ? '게시 예약' : '게시하기';
    ui.element('notice-edit-state').textContent = !draft
      ? savedStatus === 'published' ? '게시 상태를 유지합니다. 저장하면 직원에게 반영됩니다 (대상·기간 조건부). 사진은 순차 반영됩니다.' : '현재 취소·사용 중지 상태를 유지하여 저장합니다.'
      : waiting ? '운영총괄 검토·승인 자료입니다. 운영팀장은 직접 수정·중지할 수 없습니다.'
      : isPromotionLead() ? direct ? '내 일상 공지입니다. 직접 게시·예약할 수 있습니다. 수정하면 버전이 바뀌며 알림이 다시 발송될 수 있습니다.' : '이 분류·중요도·기존 원고는 운영총괄 검토가 필요합니다. 비공개 저장 후 상신하세요.' : '비공개 저장은 직원에게 보이지 않습니다. 게시하기는 대상과 시각 확인 후 실행합니다.';
    if (isPromotionLead() && !leadEditable) {
      [...ui.element('notice-form').elements].forEach(node => { if (node.id !== 'reset-notice-form') node.disabled = true; });
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
    if (item.status === 'draft') return '초안 저장됨 — 직원 비공개';
    if (item.status !== 'published') return ui.STATUS[item.status] || item.status;
    if (new Date(item.publish_start_at) > new Date()) return `게시 예약됨 — ${ui.formatDateTime(item.publish_start_at)} (KST) 공개 예정`;
    if (item.publish_end_at && new Date(item.publish_end_at) <= new Date()) return '게시기간 종료 — 직원 비공개';
    return '현재 공개됨 — 직원앱에서 확인 가능 (대상·기간 조건부)';
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

  function existingMedia(item) {
    return {
      kind: 'existing',
      id: item.id,
      storage_path: item.storage_path,
      mime_type: item.mime_type,
      alt_text: item.alt_text || '공지 사진',
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
      if (ui.element('notice-id').value === item.id) reviewPending = true;
      await load({ preserveMessage: true });
      showMessage('운영총괄 검토 대기 — 직원 비공개');
    } catch {
      showMessage('공지를 상신하지 못했습니다. 작성 중 상태와 권한을 확인해주세요.', true);
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
      previewCard.open = preview;
    }
  }

  function hideEditor() {
    const editor = noticeEditorCard();
    const previewCard = noticePreviewCard();
    if (editor) editor.hidden = true;
    if (previewCard) previewCard.hidden = true;
  }

  function setView(view) {
    if (saving) return;
    activeView = view === 'create' ? 'create' : 'manage';
    const heading = ui.element('notice-admin-title');
    const refresh = ui.element('refresh-notice-admin');
    const create = ui.element('new-notice-admin');
    const manage = noticeManageSection();
    if (heading) heading.textContent = activeView === 'create' ? '공지 등록' : '공지 관리';
    if (refresh) refresh.hidden = activeView === 'create';
    if (create) create.hidden = activeView === 'create';
    if (manage) manage.hidden = activeView === 'create';

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
    fillForm(item, { scrollTo: 'preview' });
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
    notices.forEach(item => {
      const card = document.createElement('article');
      card.className = 'admin-record-card';
      const summary = ui.text('p', '', 'help');
      const review = reviewLabel(item);
      card.append(
        ui.text('p', `${ui.IMPORTANCE[item.importance]} · ${exposureLabel(item)} · v${item.version_no}`, 'card-kicker'),
        ui.text('h3', item.title),
        ui.text('p', `게시 시작: ${ui.formatDateTime(item.publish_start_at)}`, 'help')
      );
      if (item.lead_notice_mode) card.append(ui.text('p', item.lead_notice_mode === 'routine' ? '내 일상 공지 · 직접 게시 경로' : '운영총괄 검토 경로', 'help'));
      if (review) card.append(ui.text('p', review, 'notice-review-banner'));
      if (item.creator_display_name) card.append(ui.text('p', `작성: ${item.creator_display_name}`, 'help'));

      const editLabel = isPromotionLead() && item.can_lead_edit !== true ? '공지 보기 (검토·게시 이력)' : isOperations() && item.review_state === 'submitted' ? '상신 공지 검토·수정' : '공지 수정';
      card.append(button(editLabel, () => fillForm(item)), button('미리보기', () => previewItem(item)));

      if (isPromotionLead() && item.status === 'draft' && item.can_lead_edit === true) {
        if (item.review_state === 'submitted') {
          const waiting = button('운영총괄 검토 대기', () => {});
          waiting.disabled = true;
          card.append(waiting);
        } else {
          card.append(button('운영총괄 상신', () => void submitForReview(item)));
        }
      }

      if (item.requires_acknowledgement) card.append(button('확인 현황', () => showAckSummary(item, summary)), summary);
      list.append(card);
    });
  }

  function resetForm() {
    [...ui.element('notice-form').elements].forEach(node => { node.disabled = false; });
    ui.element('notice-form').reset();
    leadMode = null;
    leadEditable = true;
    ui.element('notice-id').value = '';
    clearMediaState();
    savedStatus = 'draft';
    reviewPending = false;
    ui.element('notice-kind').value = 'general';
    savedPublishStart = null;
    publicationUncertain = false;
    setDateTime('notice-publish-start', new Date());
    ui.element('notice-publish-mode').value = 'now';
    ui.element('notice-additional-settings').open = false;
    ui.element('notice-status').value = 'draft';
    ui.element('notice-importance').value = 'normal';
    renderOptions();
    void renderMediaEditor();
    void renderPreview();
  }

  function fillForm(item, { scrollTo = 'form' } = {}) {
    if (saving) return;
    [...ui.element('notice-form').elements].forEach(node => { node.disabled = false; });
    leadMode = item.lead_notice_mode || null;
    leadEditable = item.can_lead_edit === true;
    ui.element('notice-routine-confirm').checked = false;
    savedStatus = item.status;
    reviewPending = item.review_state === 'submitted';
    savedPublishStart = item.publish_start_at;
    publicationUncertain = false;
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
    ui.element('notice-scope').value = item.target_scope;
    updateTargets(ui.targetId(item));
    ui.element('notice-status').value = item.status;
    ui.element('notice-reason').value = '공지 작성·수정';
    updateActions();
    revealEditor({ preview: scrollTo === 'preview' });
    void renderMediaEditor();
    void renderPreview();
    const target = scrollTo === 'preview' ? ui.element('notice-preview') : ui.element('notice-form');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function load({ preserveMessage = false } = {}) {
    if (!options) return;
    ui.element('refresh-notice-admin').disabled = true;
    if (!preserveMessage) showMessage('공지 목록을 불러오고 있습니다.');
    try {
      const [noticeRows, scheduleRows] = await Promise.all([
        app.rpc('list_manageable_notices', { p_limit: 200 }),
        app.rpc('list_manageable_schedules', { p_include_past: true, p_limit: 200 })
      ]);
      notices = ui.array(noticeRows);
      schedules = ui.array(scheduleRows).map(item => ({ id: item.id, title: item.title }));
      renderOptions();
      renderList();
      if (!preserveMessage) showMessage('');
      return true;
    } catch {
      if (!preserveMessage) showMessage('공지 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.', true);
      return false;
    } finally {
      ui.element('refresh-notice-admin').disabled = false;
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
        const result = await app.rpc('update_notice_media', {
          p_media_id: item.id,
          p_alt_text: item.alt_text.trim(),
          p_display_order: index,
        });
        if (!result?.ok) throw new Error(result?.code || 'NOTICE_MEDIA_UPDATE_FAILED');
      } else {
        // Keep successful registrations as existing media before the next upload.
        const uploaded = item.uploaded || await api.upload(noticeId, item.file);
        if (item.uploaded) {
          const rows = await app.rpc('list_manageable_notices', { p_limit: 200 }).catch(() => {
            throw new Error('NOTICE_MEDIA_REGISTRATION_UNKNOWN');
          });
          const registered = ui.array(rows).find(row => row.id === noticeId)?.media?.find(photo => photo.storage_path === uploaded.storage_path);
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
        Object.assign(item, existingMedia({ ...uploaded, id: result.id, alt_text: item.alt_text }));
        delete item.file;
        delete item.uploaded;
      }
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
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
      if (publicationUncertain) {
        const rows = await app.rpc('list_manageable_notices', { p_limit: 200 });
        const current = ui.array(rows).find(item => item.id === ui.element('notice-id').value);
        if (!current) throw new Error('PUBLISH_RESULT_UNKNOWN');
        savedStatus = previousStatus = current.status;
        publicationUncertain = false;
      }
      const target = ui.targetPayload(ui.element('notice-scope'), ui.element('notice-target'));
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
      const unchangedStart = savedPublishStart
        && ui.kstDate(savedPublishStart) === ui.element('notice-publish-start-date').value
        && ui.kstTime(savedPublishStart) === ui.element('notice-publish-start-time').value;
      if (savedStatus !== 'draft' && unchangedStart) publishStart = savedPublishStart;
      const publishEnd = readDateTime('notice-publish-end');
      if (publishEnd && new Date(publishEnd) <= new Date(publishStart)) throw new Error('INVALID_PERIOD');
      if (action === 'publish' && publishEnd && new Date(publishEnd) <= new Date()) throw new Error('INVALID_PERIOD');
      if (action === 'publish' || status !== savedStatus) {
        const targetLabel = [ui.element('notice-scope').selectedOptions[0]?.textContent, ui.element('notice-target').selectedOptions[0]?.textContent].filter(Boolean).join(' · ');
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
      const result = await saveNotice({ ...payload, p_status: previousStatus === 'draft' ? 'draft' : status });
      if (!result?.ok) throw new Error(result?.code || 'SAVE_FAILED');

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
      if (action === 'publish') {
        publicationUncertain = true;
        const published = await saveNotice({ ...payload, p_notice_id: result.id, p_status: 'published' });
        publicationUncertain = false;
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
      setDateTime('notice-publish-start', publishStart);
      const label = exposureLabel({ status: savedStatus, publish_start_at: publishStart, publish_end_at: publishEnd, review_state: reviewState });
      const loaded = await load({ preserveMessage: true });
      showMessage(`${label} · ${payload.p_title}${loaded ? '' : ' — 목록 새로고침 실패. 저장은 완료됐습니다.'}`);
      // Keep the saved id, input and result visible. A new notice is an explicit action.
      revealEditor({ preview: true });
      await renderMediaEditor();
      await renderPreview();
      await app.refreshToday().catch(() => {});
    } catch (error) {
      const message = error.message === 'ROUTINE_CONFIRM_REQUIRED' ? '근무제도·인사·급여·안전사고·중요 입장이 아닌 일상 안내인지 확인해주세요.'
        : error.message === 'NOTICE_SAVED_MEDIA_UNCERTAIN'
        ? `${savedStatus === 'published' ? '공개 공지 내용과 일부 사진은 이미 반영됐을 수 있습니다. ' : '현재 공지는 직원 비공개로 유지됩니다. '}사진 등록 여부를 확인하지 못해 추가 등록과 파일 삭제를 중단했습니다. 업로드 파일·입력·공지 ID를 보존했습니다.`
        : error.message === 'INVALID_PERIOD' ? '게시 종료 시각은 시작 시각보다 뒤여야 하며, 게시할 때 종료 시각이 지나지 않아야 합니다.'
        : error.message === 'TARGET_REQUIRED' ? '대상을 선택해주세요.'
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
      showMessage(publicationUncertain
        ? '게시 응답을 확인하지 못했습니다. 공개 여부는 아직 확정할 수 없습니다. 입력과 공지 ID는 유지되며, 다시 저장하면 먼저 서버 상태를 확인합니다.'
        : bodySaved && !['NOTICE_SAVED_MEDIA_FAILED', 'NOTICE_SAVED_MEDIA_UNCERTAIN'].includes(error.message)
        ? `공지 내용은 저장됐습니다 (${savedStatus === 'draft' ? '직원 비공개' : '현재 상태 유지'}). 게시·상신을 완료하지 못했습니다. ${message}` : message, true);
      ui.element('notice-additional-settings').open = true;
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
      showMessage('필수항목과 입력 형식을 확인해주세요.', true);
    }, true);
    ui.element('notice-form').addEventListener('change', event => {
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
    ui.element('refresh-notice-admin').addEventListener('click', () => { if (!saving) void load(); });
    ui.element('notice-scope').addEventListener('change', () => updateTargets());
    ui.element('notice-photo-input').addEventListener('change', addSelectedPhotos);
    ui.element('notice-form').addEventListener('input', event => {
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
