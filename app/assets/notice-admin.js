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

  const app = window.TaejangApp;
  function route() { return app?.getRoute?.() || ''; }
  function isOperations() { return route() === 'operations_manager' || route() === 'super_admin'; }
  function isPromotionLead() { return route() === 'promotion_lead'; }

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
    const status = ui.element('notice-status');
    const draftOnly = isPromotionLead() && !isOperations();
    [...status.options].forEach(option => { option.disabled = draftOnly && option.value !== 'draft'; });
    if (draftOnly) status.value = 'draft';
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
    void renderMediaEditor();
    void renderPreview();
  }

  function removeMediaAt(index) {
    const item = mediaItems[index];
    if (!item) return;
    if (item.kind === 'existing') removedMedia.push(item);
    if (item.kind === 'pending' && item.signed_url) URL.revokeObjectURL(item.signed_url);
    mediaItems.splice(index, 1);
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
    const reason = window.prompt('운영총괄에게 상신할 사유를 적어주세요.', '공지 검토 요청');
    if (reason === null) return;
    if (!reason.trim()) {
      showMessage('상신 사유를 입력해주세요.', true);
      return;
    }
    showMessage('운영총괄에게 공지를 상신하고 있습니다.');
    try {
      const result = await app.rpc('submit_notice_for_operations_review', {
        p_notice_id: item.id,
        p_reason: reason.trim(),
      });
      if (!result?.ok) throw new Error(result?.code || 'SUBMIT_FAILED');
      showMessage('운영총괄에게 공지를 상신했습니다.');
      await load();
    } catch {
      showMessage('공지를 상신하지 못했습니다. 작성 중 상태와 권한을 확인해주세요.', true);
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
    activeView = view === 'create' ? 'create' : 'manage';
    const heading = ui.element('notice-admin-title');
    const refresh = ui.element('refresh-notice-admin');
    const manage = noticeManageSection();
    if (heading) heading.textContent = activeView === 'create' ? '공지 등록' : '공지 관리';
    if (refresh) refresh.hidden = activeView === 'create';
    if (manage) manage.hidden = activeView === 'create';

    if (activeView === 'create') {
      resetForm();
      revealEditor({ preview: true });
      ui.element('notice-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      hideEditor();
      if (options) void load();
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
        ui.text('p', `${ui.IMPORTANCE[item.importance]} · ${ui.STATUS[item.status] || item.status} · v${item.version_no}`, 'card-kicker'),
        ui.text('h3', item.title),
        ui.text('p', `게시 시작: ${ui.formatDateTime(item.publish_start_at)}`, 'help')
      );
      if (review) card.append(ui.text('p', review, 'notice-review-banner'));
      if (item.creator_display_name) card.append(ui.text('p', `작성: ${item.creator_display_name}`, 'help'));

      const editLabel = isOperations() && item.review_state === 'submitted' ? '상신 공지 검토·수정' : '공지 수정';
      card.append(button(editLabel, () => fillForm(item)), button('미리보기', () => previewItem(item)));

      if (isPromotionLead() && item.status === 'draft') {
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
    ui.element('notice-form').reset();
    ui.element('notice-id').value = '';
    clearMediaState();
    const today = app.getBoardDate();
    ui.element('notice-publish-start-date').value = today;
    ui.element('notice-publish-start-time').value = '08:00';
    ui.element('notice-status').value = 'draft';
    ui.element('notice-importance').value = 'normal';
    renderOptions();
    void renderMediaEditor();
    void renderPreview();
  }

  function fillForm(item, { scrollTo = 'form' } = {}) {
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
    revealEditor({ preview: scrollTo === 'preview' });
    void renderMediaEditor();
    void renderPreview();
    const target = scrollTo === 'preview' ? ui.element('notice-preview') : ui.element('notice-form');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function load() {
    if (!options) return;
    ui.element('refresh-notice-admin').disabled = true;
    showMessage('공지 목록을 불러오고 있습니다.');
    try {
      const [noticeRows, scheduleRows] = await Promise.all([
        app.rpc('list_manageable_notices', { p_limit: 200 }),
        app.rpc('list_manageable_schedules', { p_include_past: true, p_limit: 200 })
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

  async function persistMedia(noticeId, reason) {
    const api = mediaApi();
    if (!api) throw new Error('NOTICE_MEDIA_NOT_READY');
    if (mediaItems.length > api.MAX_PHOTOS) throw new Error('NOTICE_MEDIA_LIMIT');

    for (const removed of removedMedia) {
      const result = await app.rpc('archive_notice_media', {
        p_media_id: removed.id,
        p_reason: reason || '공지 사진 자료 수정',
      });
      if (!result?.ok) throw new Error(result?.code || 'NOTICE_MEDIA_REMOVE_FAILED');
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
        const uploaded = await api.upload(noticeId, item.file);
        const result = await app.rpc('add_notice_media', {
          p_notice_id: noticeId,
          p_storage_path: uploaded.storage_path,
          p_mime_type: uploaded.mime_type,
          p_alt_text: item.alt_text.trim(),
          p_display_order: index,
        });
        if (!result?.ok) {
          await api.remove(uploaded.storage_path).catch(() => {});
          throw new Error(result?.code || 'NOTICE_MEDIA_REGISTER_FAILED');
        }
      }
    }
  }

  async function submit(event) {
    event.preventDefault();
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    showMessage('');
    try {
      const target = ui.targetPayload(ui.element('notice-scope'), ui.element('notice-target'));
      const linkUrl = ui.element('notice-link-url').value.trim();
      const linkLabel = ui.element('notice-link-label').value.trim();
      const importance = ui.element('notice-importance').value;
      const requiresAcknowledgement = ui.element('notice-requires-ack').checked;
      const reason = ui.element('notice-reason').value.trim() || '공지 작성·수정';
      if (Boolean(linkUrl) !== Boolean(linkLabel)) throw new Error('LINK_PAIR_REQUIRED');
      if (linkUrl && !ui.safeHttpsUrl(linkUrl)) throw new Error('INVALID_HTTPS_LINK');
      if (requiresAcknowledgement && importance === 'normal') throw new Error('IMPORTANT_ACK_ONLY');
      if (mediaItems.length > (mediaApi()?.MAX_PHOTOS || 10)) throw new Error('NOTICE_MEDIA_LIMIT');
      if (mediaItems.some(item => !String(item.alt_text || '').trim())) throw new Error('NOTICE_MEDIA_ALT_REQUIRED');

      const result = await app.rpc('save_notice', {
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
        p_change_reason: reason,
      });
      if (!result?.ok) throw new Error(result?.code || 'SAVE_FAILED');

      // Persist the saved id before photo work starts. If a later upload/RPC
      // fails, retrying the still-open form must update this notice instead of
      // creating a duplicate notice.
      ui.element('notice-id').value = result.id;
      try {
        await persistMedia(result.id, reason);
      } catch (mediaError) {
        const partialError = new Error('NOTICE_SAVED_MEDIA_FAILED');
        partialError.cause = mediaError;
        throw partialError;
      }
      showMessage(`공지와 사진 자료를 저장했습니다. 공지 버전은 ${result.version_no}입니다.`);
      await load();
      if (activeView === 'create') {
        resetForm();
        revealEditor({ preview: true });
      } else {
        hideEditor();
      }
      await app.refreshToday();
    } catch (error) {
      const message = error.message === 'TARGET_REQUIRED' ? '대상을 선택해주세요.'
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
                            : error.message === 'NOTICE_SAVED_MEDIA_FAILED' ? '공지 내용은 저장됐지만 사진 자료 저장에 실패했습니다. 입력은 유지됩니다. 사진을 확인한 뒤 다시 저장해주세요.'
                            : error.message.startsWith('FORBIDDEN') ? '이 범위의 공지나 사진 자료를 수정할 권한이 없습니다.'
                          : '공지를 저장하지 못했습니다. 게시기간·대상·필수항목·사진을 확인해주세요.';
      showMessage(message, true);
    } finally {
      submitButton.disabled = false;
    }
  }

  function addSelectedPhotos(event) {
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
    ui.element('reset-notice-form').addEventListener('click', () => {
      resetForm();
      revealEditor({ preview: true });
    });
    ui.element('refresh-notice-admin').addEventListener('click', load);
    ui.element('notice-scope').addEventListener('change', () => updateTargets());
    ui.element('notice-photo-input').addEventListener('change', addSelectedPhotos);
    ui.element('notice-form').addEventListener('input', () => { void renderPreview(); });
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
