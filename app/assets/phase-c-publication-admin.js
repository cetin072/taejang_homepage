(() => {
  'use strict';

  const ELIGIBLE_ROLES = new Set(['promotion_lead', 'operations_manager']);
  const TYPE_LABELS = {
    homepage_article: '태장 소식',
    external_content: '외부 기사·콘텐츠',
    press_release: '보도자료'
  };
  const STATUS_LABELS = {
    pending: '승인 대기',
    changes_requested: '보완 요청',
    rejected: '반려',
    approved: '승인 완료'
  };
  const LIFECYCLE_LABELS = {
    draft: '작성 중',
    review_pending: '승인 대기',
    needs_revision: '보완 필요',
    approved: '승인 완료',
    scheduled: '게시 예정',
    published: '게시 완료',
    hidden: '숨김',
    archived: '삭제됨'
  };

  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');
  const arr = value => Array.isArray(value) ? value : [];
  const el = (tag, value, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = value;
    return node;
  };
  const button = (label, handler, quiet = false) => {
    const node = el('button', label, `button${quiet ? ' button-quiet' : ''}`);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  };
  const field = (label, control, help = '') => {
    const wrap = document.createElement('label');
    wrap.append(el('span', label));
    if (help) wrap.append(el('small', help, 'field-help'));
    wrap.append(control);
    return wrap;
  };
  const friendly = (error, fallback) => app()?.friendlyError?.(error) || error?.message || fallback;

  function closeSidebar() {
    document.getElementById('desktop-app-shell')?.classList.remove('sidebar-open');
    document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  }

  function setPage(title, copy) {
    closeSidebar();
    const target = main();
    if (!target) return null;
    document.getElementById('desktop-page-title').textContent = title;
    const intro = document.createElement('header');
    intro.className = 'dashboard-intro';
    intro.append(el('p', '소식·기록 관리', 'eyebrow'), el('h2', title), el('p', copy));
    target.hidden = false;
    target.classList.add('phase-c-v2');
    target.replaceChildren(intro);
    return target;
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function within24Hours(value) {
    if (!value) return false;
    const time = new Date(value).getTime();
    return Number.isFinite(time) && time > Date.now() - 24 * 60 * 60 * 1000;
  }

  async function fetchPublicDetail(contentId) {
    try {
      const response = await fetch(`../.netlify/functions/public-promotion-feed?id=${encodeURIComponent(contentId)}&format=json`, {
        credentials: 'same-origin', cache: 'no-store'
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data?.item || null;
    } catch {
      return null;
    }
  }

  async function archiveRecent(item) {
    const reason = window.prompt(`“${item.title}” 글을 공개 후 24시간 안에 내리는 이유를 적어주세요.`, '')?.trim();
    if (!reason) return;
    if (!window.confirm('공개 목록에서 내립니다. 원문과 감사기록은 복원 가능하게 보존됩니다. 계속할까요?')) return;
    try {
      await app().rpc('lead_archive_recent_promotion_content', { p_content_id: item.content_id, p_reason: reason });
      await openPublicationAdmin();
    } catch (error) {
      window.alert(friendly(error, '글을 정리하지 못했습니다.'));
    }
  }

  async function archiveAsOperations(item) {
    const reason = window.prompt(`“${item.title || '제목 없음'}” 글을 삭제하는 사유를 입력해 주세요.`, '')?.trim();
    if (!reason) return;
    if (!window.confirm('삭제하면 사용자 화면과 발행 목록에서 내려가고, 휴지통에서 복원할 수 있습니다. 계속할까요?')) return;
    try {
      await app().rpc('archive_promotion_content', {
        p_content_id: item.content_id,
        p_confirm_title: item.title || '',
        p_reason: reason
      });
      await openPublicationAdmin();
    } catch (error) {
      window.alert(friendly(error, '글을 삭제하지 못했습니다.'));
    }
  }

  function openArchiveManager() {
    const api = window.TaejangIssue146?.openPromotionArchive;
    if (typeof api === 'function') return api();
    window.TaejangFeatureHealth?.showFailure?.('홍보글 휴지통 기능');
  }

  async function submitChangeRequest(payload) {
    await app().rpc('create_public_content_change_request', payload);
  }

  async function openMissingPhotoCorrection(item) {
    const target = setPage('발행글 누락 사진 보완',
      '기존 사진이 없는 공개글에 실제 승인 사진 한 장만 추가합니다. 원문·게시일·이전 승인 이력은 보존되며 운영총괄의 정정 기록이 남습니다.');
    if (!target) return;

    let detail;
    try {
      detail = await app().rpc('get_operations_missing_promotion_photo', { p_content_id: item.content_id });
      if (!detail?.revision_id || detail.public_media_count !== 0) throw new Error('누락 사진 대상이 아니거나 최근 수정된 글입니다.');
    } catch (error) {
      target.append(el('p', friendly(error, '사진 보완 대상을 불러오지 못했습니다.'), 'message error'),
        button('목록으로', openPublicationAdmin, true));
      return;
    }

    const section = el('section', null, 'dashboard-section promotion-composer');
    const form = document.createElement('form');
    form.className = 'phase-c-board-form app-authoring';
    form.addEventListener('submit', event => event.preventDefault());
    form.append(el('h3', detail.title || item.title || '홍보글'));
    if (detail.external_url) form.append(el('p', '원본 링크: ' + detail.external_url, 'field-help'));

    const photoInput = document.createElement('input');
    photoInput.type = 'file';
    photoInput.accept = 'image/jpeg,image/png,image/webp';
    const alt = document.createElement('input');
    alt.maxLength = 300;
    alt.value = (detail.title || '태장 소식') + ' 대표사진';
    const reason = document.createElement('textarea');
    reason.rows = 2;
    reason.maxLength = 300;
    reason.value = '발행글 누락 대표사진 보완';
    const accepted = document.createElement('input');
    accepted.type = 'checkbox';
    const acknowledgment = field('사진이 이 게시물의 내용과 일치하고, 공개 사용권 및 인물 사진 동의를 확인했습니다.', accepted);
    const status = el('p', '사진을 선택하거나 공식 블로그에서 가져오세요.', 'phase-c-upload-status');
    status.setAttribute('role', 'status');
    const preview = document.createElement('img');
    preview.alt = '등록 예정 대표사진 미리보기';
    preview.hidden = true;
    preview.style.cssText = 'display:block;max-width:100%;max-height:340px;object-fit:contain;margin:12px 0;border-radius:10px';
    preview.style.display = 'none';
    let imageUrl = '';
    let imageReady = false;
    let busy = false;
    const save = button('사진 보완 확정', async () => {
      if (busy || !imageUrl || !imageReady || !accepted.checked) return;
      busy = true;
      save.disabled = true;
      try {
        await preview.decode();
        if (!window.confirm('선택한 사진 한 장을 기존 발행글에 추가합니다. 승인 이력과 게시일은 보존됩니다. 계속할까요?')) return;
        await app().rpc('operations_add_missing_promotion_photo', {
          p_content_id: detail.content_id,
          p_expected_revision_id: detail.revision_id,
          p_photo_url: imageUrl,
          p_photo_alt: alt.value.trim() || '태장 홍보글 대표사진',
          p_reason: reason.value.trim(),
          p_confirm_source: accepted.checked
        });
        window.alert('대표사진이 등록되었습니다. 공개 페이지의 본문·목록·공유 이미지에서 확인할 수 있습니다.');
        await openPublicationAdmin();
      } catch (error) {
        status.textContent = error?.message?.includes('PROMOTION_PUBLIC_EDIT_REVISION_CONFLICT')
          ? '다른 수정본이 먼저 저장되었습니다. 현재 입력은 유지됩니다. 목록에서 최신 글을 다시 확인해 주세요.'
          : friendly(error, '사진 보완을 반영하지 못했습니다. 선택한 사진은 유지됩니다.');
      } finally {
        busy = false;
        syncSave();
      }
    });
    function syncSave() {
      save.disabled = busy || !imageUrl || !imageReady || !accepted.checked || !reason.value.trim();
    }
    function selectPhoto(url, description) {
      imageUrl = url;
      imageReady = false;
      preview.alt = description || '등록 예정 대표사진';
      preview.style.display = '';
      preview.onload = () => {
        imageReady = preview.naturalWidth > 0;
        status.textContent = imageReady
          ? '사진이 정상 표시됩니다. 내용·사용권 확인 후 확정할 수 있습니다.'
          : '사진을 읽지 못했습니다. 다른 사진을 선택해 주세요.';
        syncSave();
      };
      preview.onerror = () => {
        imageReady = false;
        status.textContent = '사진을 열 수 없습니다. 다른 사진을 선택해 주세요.';
        syncSave();
      };
      preview.src = url;
      preview.hidden = false;
      syncSave();
    }

    photoInput.addEventListener('change', async () => {
      const file = photoInput.files?.[0];
      if (!file || busy) return;
      busy = true;
      syncSave();
      status.textContent = '태장 공개 사진 보관함에 업로드하고 있습니다.';
      try {
        const uploader = window.TaejangPromotionWorkspaceV2Api?.uploadImage;
        if (typeof uploader !== 'function') throw new Error('기존 사진 업로드 기능을 불러오지 못했습니다.');
        const url = await uploader(file);
        if (!form.isConnected) return;
        alt.value = file.name.replace(/\.[^.]+$/, '').slice(0, 300);
        selectPhoto(url, alt.value);
      } catch (error) {
        status.textContent = friendly(error, '사진 업로드에 실패했습니다. 다시 선택해 주세요.');
      } finally {
        busy = false;
        syncSave();
      }
    });
    const photoActions = document.createElement('div');
    photoActions.className = 'quick-links';
    if (/^https:\/\/(?:m\.)?blog\.naver\.com\/taejang-official\/\d+/.test(detail.external_url || '')) {
      photoActions.append(button('태장 공식 블로그 사진 가져오기', async () => {
        if (busy) return;
        busy = true;
        syncSave();
        status.textContent = '공식 블로그의 실제 사진 데이터를 확인하고 있습니다.';
        try {
          const importer = window.TaejangPromotionWorkspaceV2Api?.importOfficialPhotoForBackfill;
          if (typeof importer !== 'function') throw new Error('공식 블로그 사진 가져오기 기능을 확인할 수 없습니다.');
          const result = await importer(detail.external_url);
          if (!form.isConnected) return;
          alt.value = result.alt;
          selectPhoto(result.url, result.alt);
        } catch (error) {
          status.textContent = friendly(error, '원본 사진을 가져오지 못했습니다.') +
            ' 원본 접근 제한이 있다면 태장 보유 사진 파일을 직접 추가해 주세요.';
        } finally {
          busy = false;
          syncSave();
        }
      }, true));
    }
    // An existing, approved, first-store opening-ceremony photo is reused only
    // for that same specific publication. Other press stories require own media.
    if (item.content_id === '76000275-af2c-4484-802a-bb84fec2956c') {
      photoActions.append(button('승인된 개소식 사진 사용', () => {
        selectPhoto('https://taejang.co.kr/assets/images/archive/opening-ceremony.webp',
          '경남형 장애인 동행일자리 1호점 개소식');
        alt.value = '경남형 장애인 동행일자리 1호점 개소식';
      }, true));
    }

    form.append(field('실제 사진 파일', photoInput, '자동 대체 로고가 아닌 해당 글의 실제 사진만 등록합니다.'),
      photoActions, preview, status, field('사진 설명', alt),
      field('수정 사유', reason), acknowledgment);
    accepted.addEventListener('change', syncSave);
    reason.addEventListener('input', syncSave);
    syncSave();
    form.append(save, button('취소', openPublicationAdmin, true));
    section.append(form);
    target.append(section);
  }

  async function openChangeForm(item, direct, operations = false) {
    const target = setPage(operations ? '게시글 수정' : direct ? '기존 글 수정' : '기존 글 수정 요청', operations
      ? '제목·요약·본문을 정정합니다. 최초 게시일, 주소, 사진·첨부·링크와 이전 원문은 보존됩니다.' : direct
      ? '공개 후 24시간 이내 플랫폼 작성 글만 운영팀장이 직접 수정합니다. 수정 이력과 감사기록은 보존됩니다.'
      : '공개 후 24시간이 지난 글은 삭제하지 않고 운영총괄에게 수정 요청만 상신합니다.');
    if (!target) return;

    let detail;
    if (operations) {
      try {
        detail = await app().rpc('get_operations_public_promotion_edit', { p_content_id: item.content_id });
      } catch (error) {
        target.append(el('p', friendly(error, '수정할 글을 불러오지 못했습니다.'), 'message error'));
        target.append(button('목록으로', openPublicationAdmin, true));
        return;
      }
      if (!detail?.revision_id) {
        target.append(el('p', '현재 원문을 확인할 수 없습니다. 목록에서 다시 불러오세요.', 'message error'));
        target.append(button('목록으로', openPublicationAdmin, true));
        return;
      }
    } else {
      detail = item?.content_id ? await fetchPublicDetail(item.content_id) : null;
    }
    const form = document.createElement('form');
    form.className = 'phase-c-board-form app-authoring';
    form.addEventListener('submit', event => event.preventDefault());

    const title = document.createElement('input');
    title.maxLength = operations ? 160 : 500;
    title.value = detail?.title || item?.title || '';
    const summary = document.createElement('textarea');
    summary.rows = 4;
    summary.maxLength = operations ? 500 : 4000;
    summary.value = detail?.summary || item?.summary || '';
    const body = document.createElement('textarea');
    body.rows = 9;
    body.maxLength = 30000;
    body.value = detail?.public_body || '';
    const reason = document.createElement('textarea');
    reason.rows = 3;
    reason.maxLength = operations ? 300 : 1000;
    if (operations) reason.value = '게시 후 문구 정정';
    let saving = false;

    form.append(field('제목', title), field('요약', summary), field('본문', body), field('수정 사유', reason));
    form.append(button(direct ? '수정 반영' : '운영총괄에게 수정 요청', async () => {
      if (saving) return;
      if (!operations && !reason.value.trim()) {
        window.alert('수정 사유를 적어주세요.');
        return;
      }
      saving = true;
      form.querySelectorAll('button').forEach(node => { node.disabled = true; });
      try {
        if (operations) {
          await app().rpc('operations_update_public_promotion_text', {
            p_content_id: item.content_id,
            p_expected_revision_id: detail.revision_id,
            p_title: title.value.trim(),
            p_summary: summary.value.trim() || null,
            p_public_body: body.value.trim() || null,
            p_reason: reason.value.trim() || '게시 후 문구 정정'
          });
          window.alert('게시글 수정이 반영되었습니다. 목록의 공개 화면에서 확인할 수 있습니다.');
        } else if (direct) {
          await app().rpc('lead_update_recent_promotion_content', {
            p_content_id: item.content_id,
            p_title: title.value.trim(),
            p_summary: summary.value.trim() || null,
            p_public_body: body.value.trim() || null,
            p_reason: reason.value.trim()
          });
        } else {
          await submitChangeRequest({
            p_target_kind: 'promotion',
            p_target_key: item.content_id,
            p_current_title: item.title || null,
            p_current_summary: item.summary || null,
            p_proposed_title: title.value.trim() || null,
            p_proposed_summary: summary.value.trim() || null,
            p_proposed_body: body.value.trim() || null,
            p_reason: reason.value.trim(),
            p_published_at: item.published_at || null
          });
        }
        await openPublicationAdmin();
      } catch (error) {
        window.alert(error?.message?.includes('PROMOTION_PUBLIC_EDIT_REVISION_CONFLICT')
          ? '다른 사람이 먼저 수정했습니다. 입력 내용은 유지됩니다. 목록에서 최신 글을 다시 불러와 내용을 비교해 주세요.'
          : friendly(error, '수정 내용을 저장하지 못했습니다.'));
      } finally {
        saving = false;
        form.querySelectorAll('button').forEach(node => { node.disabled = false; });
      }
    }), button(operations ? '취소' : '목록으로', openPublicationAdmin, true));

    const section = document.createElement('section');
    section.className = 'dashboard-section promotion-composer';
    section.append(form);
    target.append(section);
  }

  function manualArchiveRequestForm() {
    const section = document.createElement('section');
    section.className = 'dashboard-section';
    section.append(el('h2', '기타 공개글 수정 요청'));
    section.append(el('p', '이 목록에 표시되지 않는 공개 글도 수정 요청할 수 있습니다. ‘공개 소식·기록’에서 해당 글의 주소를 확인한 뒤, 수정할 내용과 이유를 작성하여 운영총괄에게 요청해 주세요.', 'help'));

    const openArchive = document.createElement('a');
    openArchive.href = '../archive.html';
    openArchive.target = '_blank';
    openArchive.rel = 'noopener noreferrer';
    openArchive.className = 'button button-quiet';
    openArchive.textContent = '전체 소식·기록 열기';
    section.append(openArchive);

    const form = document.createElement('form');
    form.className = 'phase-c-board-form app-authoring';
    form.addEventListener('submit', event => event.preventDefault());
    const url = document.createElement('input'); url.placeholder = '예: https://taejang.co.kr/archive.html#...'; url.maxLength = 2000;
    const currentTitle = document.createElement('input'); currentTitle.maxLength = 500;
    const nextTitle = document.createElement('input'); nextTitle.maxLength = 500;
    const nextSummary = document.createElement('textarea'); nextSummary.rows = 3; nextSummary.maxLength = 4000;
    const nextBody = document.createElement('textarea'); nextBody.rows = 6; nextBody.maxLength = 30000;
    const reason = document.createElement('textarea'); reason.rows = 3; reason.maxLength = 1000;
    form.append(
      field('공개 글 주소', url),
      field('현재 제목', currentTitle),
      field('수정 제목', nextTitle),
      field('수정 요약', nextSummary),
      field('수정 본문 또는 요청 내용', nextBody),
      field('수정 사유', reason)
    );
    form.append(button('운영총괄에게 수정 요청', async () => {
      if (!url.value.trim() || !reason.value.trim()) {
        window.alert('공개 글 주소와 수정 사유를 입력해 주세요.');
        return;
      }
      if (!nextTitle.value.trim() && !nextSummary.value.trim() && !nextBody.value.trim()) {
        window.alert('수정할 제목, 요약, 본문 또는 요청 내용 중 하나를 입력해 주세요.');
        return;
      }
      try {
        await submitChangeRequest({
          p_target_kind: 'archive',
          p_target_key: url.value.trim(),
          p_current_title: currentTitle.value.trim() || null,
          p_current_summary: null,
          p_proposed_title: nextTitle.value.trim() || null,
          p_proposed_summary: nextSummary.value.trim() || null,
          p_proposed_body: nextBody.value.trim() || null,
          p_reason: reason.value.trim(),
          p_published_at: null
        });
        window.alert('운영총괄에게 수정 요청을 보냈습니다.');
        await openPublicationAdmin();
      } catch (error) {
        window.alert(friendly(error, '수정 요청을 보내지 못했습니다.'));
      }
    }));
    section.append(form);
    return section;
  }

  async function reviewChangeRequest(request, action) {
    let comment = null;
    if (action === 'reject') {
      comment = window.prompt('반려 이유를 적어주세요.', '')?.trim();
      if (!comment) return;
    }
    try {
      const result = await app().rpc('review_public_content_change_request', {
        p_request_id: request.id,
        p_action: action,
        p_comment: comment
      });
      if (result?.requires_code_apply) {
        window.alert('승인했습니다. 이 항목은 정적/외부 원본이므로 코드 또는 원본 소스 반영 단계가 필요합니다. 요청 기록은 보존됩니다.');
      }
      await openPublicationAdmin();
    } catch (error) {
      window.alert(friendly(error, '수정 요청을 처리하지 못했습니다.'));
    }
  }

  function requestCard(request, isOperations) {
    const card = document.createElement('article');
    card.className = 'dashboard-card phase-c-v2-card';
    card.append(el('span', `${request.target_kind === 'promotion' ? '플랫폼 글' : '기타 공개글'} · ${STATUS_LABELS[request.status] || request.status}`, 'status-label'));
    card.append(el('h3', request.current_title || request.target_key || '수정 요청'));
    if (request.requested_by_name) card.append(el('p', `요청자: ${request.requested_by_name}`, 'help'));
    if (request.reason) card.append(el('p', `사유: ${request.reason}`));
    if (request.proposed_title) card.append(el('p', `수정 제목: ${request.proposed_title}`));
    if (request.decision_comment) card.append(el('p', `검토 의견: ${request.decision_comment}`, 'help'));
    if (isOperations && request.status === 'pending') {
      const actions = document.createElement('div');
      actions.className = 'quick-links';
      actions.append(
        button('승인', () => reviewChangeRequest(request, 'approve')),
        button('반려', () => reviewChangeRequest(request, 'reject'), true)
      );
      card.append(actions);
    }
    return card;
  }

  function itemCard(item, role) {
    const card = document.createElement('article');
    card.className = 'dashboard-card phase-c-v2-card';
    const recent = within24Hours(item.published_at);
    const isPublic = ['published', 'hidden'].includes(item.lifecycle);
    card.append(el('span', `${TYPE_LABELS[item.content_type] || '홍보 글'} · ${LIFECYCLE_LABELS[item.lifecycle] || item.lifecycle || '상태 미확인'}`, 'status-label'));
    card.append(el('h3', item.title || '제목 없음'));
    if (item.published_at) card.append(el('p', `공개 시각 ${formatDate(item.published_at)}`, 'help'));
    const actions = document.createElement('div');
    actions.className = 'quick-links';

    if (isPublic) {
      const publicLink = document.createElement('a');
      publicLink.href = `../promotion.html?id=${encodeURIComponent(item.content_id)}`;
      publicLink.target = '_blank';
      publicLink.rel = 'noopener noreferrer';
      publicLink.className = 'button button-quiet';
      publicLink.textContent = '공개 화면';
      actions.append(publicLink);
    }

    if (role === 'promotion_lead' && isPublic) {
      if (recent) {
        actions.append(
          button('수정', () => openChangeForm(item, true), true),
          button('24시간 내 삭제', () => archiveRecent(item), true)
        );
      } else {
        actions.append(button('수정 요청', () => openChangeForm(item, false), true));
        actions.append(el('span', '24시간 경과 · 삭제 불가', 'help'));
      }
    }

    if (role === 'operations_manager') {
      if (isPublic && item.can_operations_edit_text === true) {
        actions.append(button('게시글 수정', () => openChangeForm(item, true, true), true));
      }
      if (isPublic && item.can_operations_add_missing_photo === true) {
        actions.append(button('누락 사진 보완', () => openMissingPhotoCorrection(item), true));
      }
      actions.append(button('삭제', () => archiveAsOperations(item), true));
    }

    card.append(actions);
    return card;
  }

  async function openPublicationAdmin() {
    const currentRoute = route();
    if (!ELIGIBLE_ROLES.has(currentRoute)) return;
    const isOperations = currentRoute === 'operations_manager';
    const target = setPage('공개 홍보글 관리', isOperations
      ? '승인된 일반 공개글의 문구를 수정하고, 사진이 없는 글에는 실제 사진을 보완할 수 있습니다. 기존 글·승인 기록은 보존됩니다.'
      : '플랫폼에서 작성된 공개글은 바로 관리하고, 정적·ChatGPT·블로그·유튜브 글은 주소를 지정해 수정 요청합니다. 전체 공개 페이지를 뒤에서 다시 불러오지 않는 가벼운 방식입니다.');
    if (!target) return;
    const loading = el('p', '공개 홍보글을 불러오고 있습니다.', 'message');
    target.append(loading);

    try {
      const results = await Promise.allSettled([
        app().rpc('get_promotion_publication_admin'),
        app().rpc('list_public_content_change_requests')
      ]);
      const publication = results[0].status === 'fulfilled' ? results[0].value : {};
      const requests = results[1].status === 'fulfilled' ? arr(results[1].value) : [];
      const items = arr(publication?.items);
      loading.remove();

      if (isOperations) {
        const tools = document.createElement('div');
        tools.className = 'quick-links';
        tools.append(button('휴지통·영구삭제', openArchiveManager, true));
        target.append(tools);

        const contentSection = document.createElement('section');
        contentSection.className = 'dashboard-section';
        contentSection.append(el('h2', `플랫폼 홍보글 ${items.length}건`));
        const contentGrid = document.createElement('div'); contentGrid.className = 'phase-c-v2-grid';
        if (!items.length) contentGrid.append(el('p', '현재 관리할 홍보글이 없습니다.', 'empty'));
        items.forEach(item => contentGrid.append(itemCard(item, currentRoute)));
        contentSection.append(contentGrid);
        target.append(contentSection);

        const requestSection = document.createElement('section');
        requestSection.className = 'dashboard-section';
        requestSection.append(el('h2', `수정 요청 ${requests.filter(item => item.status === 'pending').length}건`));
        const grid = document.createElement('div'); grid.className = 'phase-c-v2-grid';
        if (!requests.length) grid.append(el('p', '현재 기존 글 수정 요청이 없습니다.', 'empty'));
        requests.forEach(request => grid.append(requestCard(request, true)));
        requestSection.append(grid);
        target.append(requestSection);
      } else {
        const section = document.createElement('section');
        section.className = 'dashboard-section';
        section.append(el('h2', `플랫폼 작성 공개글 ${items.length}건`));
        const grid = document.createElement('div'); grid.className = 'phase-c-v2-grid';
        if (!items.length) grid.append(el('p', '현재 플랫폼에서 관리할 공개글이 없습니다.', 'empty'));
        items.forEach(item => grid.append(itemCard(item, currentRoute)));
        section.append(grid);
        target.append(section, manualArchiveRequestForm());

        if (requests.length) {
          const my = document.createElement('section'); my.className = 'dashboard-section';
          my.append(el('h2', '내 수정 요청'));
          const requestGrid = document.createElement('div'); requestGrid.className = 'phase-c-v2-grid';
          requests.forEach(request => requestGrid.append(requestCard(request, false)));
          my.append(requestGrid); target.append(my);
        }
      }
    } catch (error) {
      loading.textContent = friendly(error, '공개 홍보글을 불러오지 못했습니다.');
      loading.classList.add('error');
    }
  }

  function ensureNav() {
    // Compatibility no-op. Sidebar ownership belongs to dashboard-shell.
  }

  window.TaejangPublicationAdmin = { openPublicationAdmin, ensureNav };
})();
