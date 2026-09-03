(() => {
  'use strict';

  const ELIGIBLE = new Set(['promotion_lead', 'operations_manager']);
  const TYPE_LABELS = {
    homepage_article: '태장 소식',
    external_content: '외부 기사·콘텐츠',
    press_release: '보도자료'
  };
  const LIFECYCLE_LABELS = { published: '공개 중', hidden: '숨김' };

  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };
  const button = (label, handler, quiet = false) => {
    const node = el('button', label, `button${quiet ? ' button-quiet' : ''}`);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  };

  function closeSidebar() {
    document.getElementById('desktop-app-shell')?.classList.remove('sidebar-open');
    document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function friendly(error, fallback) {
    return app()?.friendlyError?.(error) || error?.message || fallback;
  }

  async function setVisibility(item, visible) {
    const reason = window.prompt(visible ? '다시 공개하는 이유를 적어주세요.' : '숨기는 이유를 적어주세요.', '')?.trim();
    if (!reason) return;
    try {
      await app().rpc('set_promotion_visibility', {
        p_content_id: item.content_id,
        p_visible: visible,
        p_reason: reason
      });
      await openPublicationAdmin();
    } catch (error) {
      window.alert(friendly(error, '공개 상태를 변경하지 못했습니다.'));
    }
  }

  async function requestDeletion(item) {
    const reason = window.prompt('운영총괄에게 전달할 삭제 이유를 적어주세요.', '')?.trim();
    if (!reason) return;
    try {
      await app().rpc('request_promotion_deletion', { p_content_id: item.content_id, p_reason: reason });
      window.alert('삭제 요청을 운영총괄에게 보냈습니다. 글은 삭제 전까지 숨기거나 다시 공개할 수 있습니다.');
      await openPublicationAdmin();
    } catch (error) {
      window.alert(friendly(error, '삭제 요청을 보내지 못했습니다.'));
    }
  }

  async function permanentDelete(item) {
    const confirmedTitle = window.prompt(`영구 삭제하려면 아래 제목을 정확히 다시 입력하세요.\n\n${item.title}`, '') || '';
    if (confirmedTitle !== item.title) {
      if (confirmedTitle) window.alert('제목이 일치하지 않아 삭제하지 않았습니다.');
      return;
    }
    const reason = window.prompt('영구 삭제 이유를 적어주세요.', '')?.trim();
    if (!reason) return;
    if (!window.confirm('이 글을 영구 삭제합니다. 복구할 수 없습니다. 계속하시겠습니까?')) return;
    try {
      await app().rpc('delete_promotion_content', {
        p_content_id: item.content_id,
        p_confirm_title: confirmedTitle,
        p_reason: reason
      });
      window.alert('글을 영구 삭제했습니다. 공개 홈페이지에서도 더 이상 표시되지 않습니다.');
      await openPublicationAdmin();
    } catch (error) {
      window.alert(friendly(error, '글을 삭제하지 못했습니다.'));
    }
  }

  async function rejectDeletion(request) {
    const comment = window.prompt('삭제 요청을 반려하는 이유를 적어주세요.', '')?.trim();
    if (!comment) return;
    try {
      await app().rpc('reject_promotion_deletion_request', { p_request_id: request.request_id, p_comment: comment });
      await openPublicationAdmin();
    } catch (error) {
      window.alert(friendly(error, '삭제 요청을 반려하지 못했습니다.'));
    }
  }

  function itemCard(item, role) {
    const card = el('article', null, 'dashboard-card phase-c-v2-card');
    card.append(el('span', `${TYPE_LABELS[item.content_type] || '홍보 글'} · ${LIFECYCLE_LABELS[item.lifecycle] || item.lifecycle}`, 'eyebrow'));
    card.append(el('h3', item.title || '제목 없음'));
    if (item.published_at) card.append(el('p', `공개 시각 ${formatDate(item.published_at)}`));
    if (item.pending_delete_request) card.append(el('p', '삭제 요청 대기 중', 'message'));

    const actions = el('div', null, 'quick-links');
    const publicLink = el('a', '홈페이지에서 보기', 'button button-quiet');
    publicLink.href = `../promotion.html?id=${encodeURIComponent(item.content_id)}`;
    publicLink.target = '_blank';
    publicLink.rel = 'noopener noreferrer';
    actions.append(publicLink);

    if (item.lifecycle === 'published') actions.append(button('숨기기', () => setVisibility(item, false), true));
    if (item.lifecycle === 'hidden') actions.append(button('다시 공개', () => setVisibility(item, true), true));

    if (role === 'promotion_lead') {
      if (!item.pending_delete_request) actions.append(button('삭제 요청', () => requestDeletion(item), true));
    } else if (role === 'operations_manager') {
      actions.append(button('영구 삭제', () => permanentDelete(item)));
    }

    card.append(actions);
    return card;
  }

  function deletionRequestCard(request, items) {
    const card = el('article', null, 'dashboard-card phase-c-v2-card');
    card.append(el('span', '운영팀장 삭제 요청', 'eyebrow'));
    card.append(el('h3', request.content_title || '삭제 요청'));
    card.append(el('p', request.reason || '사유 없음'));
    card.append(el('p', `요청 시각 ${formatDate(request.created_at)}`));
    const actions = el('div', null, 'quick-links');
    const item = items.find(candidate => candidate.content_id === request.content_id);
    if (item) actions.append(button('영구 삭제', () => permanentDelete(item)));
    actions.append(button('요청 반려', () => rejectDeletion(request), true));
    card.append(actions);
    return card;
  }

  async function openPublicationAdmin() {
    closeSidebar();
    const currentRoute = route();
    const target = main();
    if (!target || !ELIGIBLE.has(currentRoute)) return;
    document.getElementById('desktop-page-title').textContent = '공개 글 관리';
    target.hidden = false;
    target.classList.add('phase-c-v2');
    target.replaceChildren(el('p', '공개 글 상태를 불러오고 있습니다.', 'message'));

    try {
      const data = await app().rpc('get_promotion_publication_admin');
      const role = data?.role || currentRoute;
      const items = Array.isArray(data?.items) ? data.items : [];
      const requests = Array.isArray(data?.deletion_requests) ? data.deletion_requests : [];

      const intro = el('section', null, 'dashboard-intro');
      intro.append(el('p', '홈페이지 운영', 'eyebrow'));
      intro.append(el('h1', '공개 글 관리'));
      intro.append(el('p', role === 'operations_manager'
        ? '공개·숨김 상태를 관리하고 영구 삭제를 최종 결정합니다. 영구 삭제는 운영총괄만 가능합니다.'
        : '잘못 공개된 글은 즉시 숨길 수 있습니다. 영구 삭제가 필요하면 운영총괄에게 요청하세요.'));
      intro.append(el('p', '승인이 끝난 글은 별도 홈페이지 빌드 없이 바로 공개 데이터에 들어갑니다. 새로 연 홈페이지 화면에서 즉시 확인할 수 있습니다.', 'help'));
      target.replaceChildren(intro);

      if (role === 'operations_manager' && requests.length) {
        const requestSection = el('section', null, 'dashboard-section');
        requestSection.append(el('h2', `삭제 요청 ${requests.length}건`));
        const requestGrid = el('div', null, 'phase-c-v2-grid');
        requests.forEach(request => requestGrid.append(deletionRequestCard(request, items)));
        requestSection.append(requestGrid);
        target.append(requestSection);
      }

      const section = el('section', null, 'dashboard-section');
      section.append(el('h2', `공개 글 ${items.length}건`));
      const grid = el('div', null, 'phase-c-v2-grid');
      if (!items.length) grid.append(el('p', '현재 공개되었거나 숨김 처리된 글이 없습니다.', 'empty'));
      items.forEach(item => grid.append(itemCard(item, role)));
      section.append(grid);
      target.append(section);
    } catch (error) {
      target.replaceChildren(el('p', friendly(error, '공개 글을 불러오지 못했습니다.'), 'message error'));
    }
  }

  function ensureNav() {
    const nav = document.getElementById('app-nav');
    if (!nav) return;
    const eligible = ELIGIBLE.has(route());
    let node = nav.querySelector('[data-phase-c-publication-admin]');
    if (!eligible) {
      node?.remove();
      return;
    }
    if (node) return;
    node = document.createElement('button');
    node.type = 'button';
    node.textContent = '공개 글 관리';
    node.dataset.phaseCPublicationAdmin = '1';
    node.addEventListener('click', openPublicationAdmin);
    const homepage = [...nav.querySelectorAll('button')].find(candidate => candidate.textContent.trim() === '홈페이지 내용 관리');
    if (homepage?.nextSibling) nav.insertBefore(node, homepage.nextSibling);
    else nav.append(node);
  }

  const nav = document.getElementById('app-nav');
  if (nav) new MutationObserver(ensureNav).observe(nav, { childList: true });
  window.addEventListener('pageshow', ensureNav);
  window.addEventListener('taejang-dashboard-refresh', ensureNav);
  setTimeout(ensureNav, 0);
})();
