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
    if (!window.confirm('공개 목록에서 내립니다. 원문과 감사기록은 복구 가능하게 보존됩니다. 계속할까요?')) return;
    try {
      await app().rpc('lead_archive_recent_promotion_content', { p_content_id: item.content_id, p_reason: reason });
      await openPublicationAdmin();
    } catch (error) {
      window.alert(friendly(error, '글을 정리하지 못했습니다.'));
    }
  }

  async function submitChangeRequest(payload) {
    await app().rpc('create_public_content_change_request', payload);
  }

  async function openChangeForm(item, direct) {
    const target = setPage(direct ? '기존 글 수정' : '기존 글 수정 요청', direct
      ? '공개 후 24시간 이내 플랫폼 작성 글만 운영팀장이 직접 수정합니다. 수정 이력과 감사기록은 보존됩니다.'
      : '공개 후 24시간이 지난 글은 삭제하지 않고 운영총괄에게 수정 요청만 상신합니다.');
    if (!target) return;

    const detail = item?.content_id ? await fetchPublicDetail(item.content_id) : null;
    const form = document.createElement('form');
    form.className = 'phase-c-board-form';
    form.addEventListener('submit', event => event.preventDefault());

    const title = document.createElement('input');
    title.maxLength = 500;
    title.value = detail?.title || item?.title || '';
    const summary = document.createElement('textarea');
    summary.rows = 4;
    summary.maxLength = 4000;
    summary.value = detail?.summary || item?.summary || '';
    const body = document.createElement('textarea');
    body.rows = 9;
    body.maxLength = 30000;
    body.value = detail?.public_body || '';
    const reason = document.createElement('textarea');
    reason.rows = 3;
    reason.maxLength = 1000;

    form.append(field('제목', title), field('요약', summary), field('본문', body), field('수정 사유', reason));
    form.append(button(direct ? '수정 반영' : '운영총괄에게 수정 요청', async () => {
      if (!reason.value.trim()) {
        window.alert('수정 사유를 적어주세요.');
        return;
      }
      try {
        if (direct) {
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
        window.alert(friendly(error, '수정 내용을 저장하지 못했습니다.'));
      }
    }), button('목록으로', openPublicationAdmin, true));

    const section = document.createElement('section');
    section.className = 'dashboard-section promotion-composer';
    section.append(form);
    target.append(section);
  }

  function manualArchiveRequestForm() {
    const section = document.createElement('section');
    section.className = 'dashboard-section';
    section.append(el('h2', '기타 공개글 수정 요청'));
    section.append(el('p', 'ChatGPT 지시로 정적 반영된 글, 블로그·유튜브·언론 연결글은 자동으로 전부 불러오지 않습니다. 공개 소식·기록에서 해당 글을 확인한 뒤 주소와 수정 내용을 적어 운영총괄에게 상신하세요.', 'help'));

    const openArchive = document.createElement('a');
    openArchive.href = '../archive.html';
    openArchive.target = '_blank';
    openArchive.rel = 'noopener noreferrer';
    openArchive.className = 'button button-quiet';
    openArchive.textContent = '전체 소식·기록 열기';
    section.append(openArchive);

    const form = document.createElement('form');
    form.className = 'phase-c-board-form';
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
    card.append(el('span', `${TYPE_LABELS[item.content_type] || '홍보 글'} · ${item.lifecycle === 'hidden' ? '숨김' : '공개'}`, 'status-label'));
    card.append(el('h3', item.title || '제목 없음'));
    if (item.published_at) card.append(el('p', `공개 시각 ${formatDate(item.published_at)}`, 'help'));
    const actions = document.createElement('div');
    actions.className = 'quick-links';
    const publicLink = document.createElement('a');
    publicLink.href = `../promotion.html?id=${encodeURIComponent(item.content_id)}`;
    publicLink.target = '_blank';
    publicLink.rel = 'noopener noreferrer';
    publicLink.className = 'button button-quiet';
    publicLink.textContent = '공개 화면';
    actions.append(publicLink);

    if (role === 'promotion_lead') {
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
    card.append(actions);
    return card;
  }

  async function openPublicationAdmin() {
    const currentRoute = route();
    if (!ELIGIBLE_ROLES.has(currentRoute)) return;
    const isOperations = currentRoute === 'operations_manager';
    const target = setPage('기존 글 관리', isOperations
      ? '운영총괄에게 올라온 기존 공개글 수정 요청을 검토합니다.'
      : '플랫폼에서 작성된 공개글은 바로 관리하고, 정적·ChatGPT·블로그·유튜브 글은 주소를 지정해 수정 요청합니다. 전체 공개 페이지를 뒤에서 다시 불러오지 않는 가벼운 방식입니다.');
    if (!target) return;
    const loading = el('p', '기존 글을 불러오고 있습니다.', 'message');
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
      loading.textContent = friendly(error, '기존 글을 불러오지 못했습니다.');
      loading.classList.add('error');
    }
  }

  function ensureNav() {
    // Compatibility no-op. dashboard-shell owns all sidebar nodes.
  }

  window.TaejangPublicationAdmin = { openPublicationAdmin, ensureNav };

})();