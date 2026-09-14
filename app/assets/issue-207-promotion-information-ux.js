(() => {
  'use strict';

  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');
  const arr = value => Array.isArray(value) ? value : [];
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value ?? '';
    if (className) node.className = className;
    return node;
  };
  const button = (label, run, quiet = false) => {
    const node = text('button', label, `button${quiet ? ' button-quiet' : ''}`);
    node.type = 'button';
    node.addEventListener('click', run);
    return node;
  };
  const lifecycleLabel = {
    draft: '작성 중', review_pending: '승인 대기', needs_revision: '보완 필요', approved: '승인 완료',
    scheduled: '게시 예정', published: '게시 완료', hidden: '숨김', archived: '보관'
  };
  const requestStatusLabel = { pending: '승인 대기', changes_requested: '보완 요청', rejected: '반려', approved: '승인 완료' };
  const noticeKinds = {
    general: '일반공지', safety: '안전', working_hours: '근무시간', work_location: '근무장소', training: '교육',
    external_activity: '외부활동', holiday: '휴무', transport: '차량·이동', materials: '준비물', clothing: '복장', company_life: '회사생활'
  };
  let informationEditingId = null;

  function closeSidebar() {
    document.getElementById('desktop-app-shell')?.classList.remove('sidebar-open');
    document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  }

  function setPage(title, kicker, copy) {
    closeSidebar();
    const target = main();
    if (!target) return null;
    document.getElementById('desktop-page-title').textContent = title;
    const intro = document.createElement('header');
    intro.className = 'dashboard-intro';
    intro.append(text('p', kicker, 'eyebrow'), text('h2', title), text('p', copy));
    target.hidden = false;
    target.classList.add('phase-c-v2');
    target.replaceChildren(intro);
    return target;
  }

  function cleanLabel(node) {
    return String(node?.textContent || '').replace(/\s*·\s*점검중\s*$/, '').trim();
  }

  function findNav(labels) {
    const values = new Set(Array.isArray(labels) ? labels : [labels]);
    return [...(document.getElementById('app-nav')?.children || [])].find(node => values.has(cleanLabel(node))) || null;
  }

  function navNode(label, run, key) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.dataset.issue207Nav = key;
    node.addEventListener('click', run);
    return node;
  }

  function moveKnownToFront(nav, labels) {
    let cursor = nav.firstChild;
    labels.forEach(label => {
      const node = [...nav.children].find(candidate => cleanLabel(candidate) === label);
      if (!node) return;
      nav.insertBefore(node, cursor);
      cursor = node.nextSibling;
    });
  }

  function openExistingContent() {
    if (window.TaejangPublicationAdmin?.openPublicationAdmin) {
      window.TaejangPublicationAdmin.openPublicationAdmin();
      return;
    }
    window.alert('기존 글 관리 기능을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
  }

  function openHomepageManagement() {
    if (window.TaejangPromotionWorkspaceV2Api?.openHomepageManagement) {
      window.TaejangPromotionWorkspaceV2Api.openHomepageManagement();
      return;
    }
    window.alert('홈페이지 내용 관리 기능을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
  }

  function ensureExistingContentNav(nav) {
    let node = nav.querySelector('[data-phase-c-publication-admin]') || findNav(['홍보 글 관리', '기존 글 관리']);
    if (!node) {
      node = navNode('기존 글 관리', openExistingContent, 'existing-content');
      node.dataset.phaseCPublicationAdmin = '1';
      nav.append(node);
    }
    node.textContent = '기존 글 관리';
    return node;
  }

  function ensureHomepageManagementNav(nav) {
    let node = nav.querySelector('[data-phase-c-v2-nav="homepage"]') || findNav('홈페이지 내용 관리');
    if (!node) {
      node = navNode('홈페이지 내용 관리', openHomepageManagement, 'homepage-management');
      node.dataset.phaseCV2Nav = 'homepage';
      nav.append(node);
    }
    node.textContent = '홈페이지 내용 관리';
    return node;
  }

  function removeLegacyInformationNav(nav, keepKey) {
    const legacy = new Set(['공지 관리', '상시 안내 관리', '공지·안내 관리', '공지·안내 확인']);
    [...nav.children].forEach(node => {
      if (node.dataset.issue207Nav === keepKey) return;
      if (legacy.has(cleanLabel(node))) node.remove();
    });
  }

  function ensureNavigation() {
    const nav = document.getElementById('app-nav');
    const currentRoute = route();
    if (!nav || !currentRoute) return;

    if (currentRoute === 'promotion_staff') {
      const write = findNav(['홍보 작성', '새 홍보글 작성']);
      if (write) write.textContent = '새 홍보글 작성';
      const revision = findNav(['수정·보완 요청', '보완 요청받은 글']);
      if (revision) revision.textContent = '보완 요청받은 글';
      if (!nav.querySelector('[data-issue207-nav="sent"]')) {
        const sent = navNode('보낸 글', openSent, 'sent');
        if (write?.nextSibling) nav.insertBefore(sent, write.nextSibling); else nav.append(sent);
      }
      removeLegacyInformationNav(nav, 'notice-read');
      if (!nav.querySelector('[data-issue207-nav="notice-read"]')) nav.append(navNode('공지 확인', openInformationRead, 'notice-read'));
      moveKnownToFront(nav, ['대시보드', '새 홍보글 작성', '보낸 글', '보완 요청받은 글', '공지 확인']);
    }

    if (currentRoute === 'promotion_lead') {
      const review = findNav(['홍보 검토', '홍보 관리', '승인·검토']);
      if (review) review.textContent = '승인·검토';
      const write = findNav(['홍보 작성', '새 홍보글 작성']);
      if (write) write.textContent = '새 홍보글 작성';
      ensureExistingContentNav(nav);
      ensureHomepageManagementNav(nav);
      removeLegacyInformationNav(nav, 'notice-manage');
      if (!nav.querySelector('[data-issue207-nav="notice-manage"]')) nav.append(navNode('공지 관리', openInformationHub, 'notice-manage'));
      moveKnownToFront(nav, ['대시보드', '새 홍보글 작성', '승인·검토', '기존 글 관리', '홈페이지 내용 관리', '공지 관리']);
    }

    if (currentRoute === 'operations_manager') {
      ensureExistingContentNav(nav);
      ensureHomepageManagementNav(nav);
      removeLegacyInformationNav(nav, 'notice-manage');
      if (!nav.querySelector('[data-issue207-nav="notice-manage"]')) nav.append(navNode('공지 관리', openInformationHub, 'notice-manage'));
    }
  }

  function scheduleNavigation() {
    [0, 80, 240, 700].forEach(delay => setTimeout(ensureNavigation, delay));
  }

  function cleanupWriteScreen() {
    const target = main();
    if (!target) return;
    [...target.querySelectorAll('.dashboard-section')].forEach(section => {
      const heading = section.querySelector('h2')?.textContent.trim();
      if (heading === '내 작성글' || heading === '내가 작성한 홍보자료') section.remove();
    });
    const introTitle = target.querySelector('.dashboard-intro h2');
    if (introTitle && /새 홍보자료 작성|새 태장 소식 작성/.test(introTitle.textContent)) introTitle.textContent = '새 홍보글 작성';
  }

  function scheduleWriteCleanup() {
    [80, 250, 700].forEach(delay => setTimeout(cleanupWriteScreen, delay));
  }

  async function openSent() {
    const target = setPage('보낸 글', '홍보 업무', '운영팀장에게 상신했거나 승인·게시 단계로 넘어간 내 글만 모아봅니다. 새 글 작성 화면과 분리했습니다.');
    if (!target) return;
    const section = document.createElement('section');
    section.className = 'dashboard-section';
    section.append(text('p', '보낸 글을 불러오고 있습니다.', 'message'));
    target.append(section);
    try {
      const workspace = await app().rpc('get_my_promotion_workspace');
      const items = arr(workspace?.my_items).filter(item => item.lifecycle !== 'needs_revision' && (item.submitted_at || ['review_pending','approved','scheduled','published','hidden','archived'].includes(item.lifecycle)));
      section.replaceChildren();
      const grid = document.createElement('div'); grid.className = 'phase-c-v2-grid';
      if (!items.length) grid.append(text('p', '아직 운영팀장에게 보낸 글이 없습니다.', 'empty'));
      items.forEach(item => {
        const card = document.createElement('article'); card.className = 'dashboard-card phase-c-v2-card';
        card.append(text('span', lifecycleLabel[item.lifecycle] || item.lifecycle, 'status-label'), text('h3', item.title || '제목 없음'));
        if (item.submitted_at) card.append(text('p', `상신 ${new Date(item.submitted_at).toLocaleString('ko-KR')}`, 'help'));
        if (item.summary) card.append(text('p', item.summary));
        grid.append(card);
      });
      section.append(grid);
    } catch (error) {
      section.replaceChildren(text('p', app().friendlyError?.(error) || '보낸 글을 불러오지 못했습니다.', 'message error'));
    }
  }

  async function openInformationRead() {
    const target = setPage('공지 확인', '공지', '현재 나에게 적용되는 공지를 확인합니다.');
    if (!target) return;
    const loading = text('p', '공지를 불러오고 있습니다.', 'message');
    target.append(loading);
    try {
      const items = arr(await app().rpc('get_my_notice_list', { p_limit: 100 }));
      loading.remove();
      const section = document.createElement('section');
      section.className = 'dashboard-section';
      section.append(text('h2', '공지'));
      const grid = document.createElement('div'); grid.className = 'phase-c-v2-grid';
      if (!items.length) grid.append(text('p', '현재 확인할 공지가 없습니다.', 'empty'));
      items.forEach(item => {
        const card = document.createElement('article'); card.className = 'dashboard-card';
        card.append(text('h3', item.title || '공지'), text('p', item.body_easy || ''));
        grid.append(card);
      });
      section.append(grid);
      target.append(section);
    } catch (error) {
      loading.textContent = app().friendlyError?.(error) || error.message || '공지를 불러오지 못했습니다.';
      loading.classList.add('error');
    }
  }

  function option(value, label) {
    const node = document.createElement('option'); node.value = value; node.textContent = label; return node;
  }

  function field(label, control, help = '') {
    const wrap = document.createElement('label'); wrap.append(text('span', label));
    if (help) wrap.append(text('small', help, 'field-help'));
    wrap.append(control); return wrap;
  }

  function informationForm(request = null) {
    const form = document.createElement('form');
    form.className = 'phase-c-board-form';
    form.addEventListener('submit', event => event.preventDefault());
    const category = document.createElement('select');
    Object.entries(noticeKinds).forEach(([value, label]) => category.append(option(value, label)));
    const importance = document.createElement('select');
    importance.append(option('normal', '일반'), option('important', '중요'), option('urgent', '긴급'));
    const title = document.createElement('input'); title.maxLength = 120;
    const body = document.createElement('textarea'); body.rows = 7; body.maxLength = 3000;
    const from = document.createElement('input'); from.type = 'date';
    const until = document.createElement('input'); until.type = 'date';
    const reason = document.createElement('textarea'); reason.rows = 2; reason.maxLength = 1000;

    form.append(field('분류', category), field('중요도', importance), field('제목', title), field('내용', body), field('적용 시작일', from), field('적용 종료일', until), field('상신 사유', reason));

    if (request) {
      category.value = request.category_code || category.value;
      importance.value = request.importance_code || 'normal';
      title.value = request.title || '';
      body.value = request.body_easy || '';
      from.value = request.effective_from || '';
      until.value = request.effective_until || '';
      reason.value = request.reason || '';
    }

    form.append(button(request ? '보완 후 다시 상신' : '운영총괄에게 상신', async () => {
      if (!title.value.trim() || !body.value.trim() || !reason.value.trim()) {
        window.alert('제목, 내용, 상신 사유를 입력해 주세요.');
        return;
      }
      try {
        await app().rpc('save_information_publication_request', {
          p_request_id: request?.id || null,
          p_information_kind: 'notice',
          p_category_code: category.value,
          p_importance_code: importance.value,
          p_title: title.value.trim(),
          p_summary_easy: null,
          p_body_easy: body.value.trim(),
          p_effective_from: from.value || null,
          p_effective_until: until.value || null,
          p_publish_start_at: null,
          p_reason: reason.value.trim()
        });
        informationEditingId = null;
        await openInformationHub();
      } catch (error) {
        window.alert(app().friendlyError?.(error) || error.message || '공지를 상신하지 못했습니다.');
      }
    }));
    return form;
  }

  async function reviewInformation(request, action) {
    let comment = null;
    if (action !== 'approve') {
      comment = window.prompt(action === 'changes_requested' ? '보완할 내용을 적어주세요.' : '반려 이유를 적어주세요.', '')?.trim();
      if (!comment) return;
    }
    try {
      await app().rpc('review_information_publication_request', { p_request_id: request.id, p_action: action, p_comment: comment });
      await openInformationHub();
    } catch (error) {
      window.alert(app().friendlyError?.(error) || error.message || '처리하지 못했습니다.');
    }
  }

  function informationRequestCard(request, isOperations) {
    const card = document.createElement('article');
    card.className = 'dashboard-card phase-c-v2-card';
    card.append(text('span', `공지 · ${requestStatusLabel[request.status] || request.status}`, 'status-label'));
    card.append(text('h3', request.title || '제목 없음'));
    if (request.requested_by_name) card.append(text('p', `상신자: ${request.requested_by_name}`, 'help'));
    card.append(text('p', request.body_easy || ''));
    if (request.decision_comment) card.append(text('p', `검토 의견: ${request.decision_comment}`, 'help'));
    const actions = document.createElement('div'); actions.className = 'quick-links';
    if (isOperations && request.status === 'pending') {
      actions.append(
        button('승인·게시', () => reviewInformation(request, 'approve')),
        button('보완 요청', () => reviewInformation(request, 'changes_requested'), true),
        button('반려', () => reviewInformation(request, 'reject'), true)
      );
    } else if (!isOperations && request.status === 'changes_requested') {
      actions.append(button('보완해서 다시 상신', () => { informationEditingId = request.id; openInformationHub(); }));
    }
    if (actions.childNodes.length) card.append(actions);
    return card;
  }

  async function openInformationHub() {
    const isOperations = route() === 'operations_manager';
    const target = setPage('공지 관리', '공지', isOperations
      ? '운영팀장이 상신한 공지를 검토하고 승인·게시합니다.'
      : '새 공지를 작성해 운영총괄에게 상신합니다. 운영팀장은 직접 게시할 수 없습니다.');
    if (!target) return;
    const loading = text('p', '공지 상신 내역을 불러오고 있습니다.', 'message');
    target.append(loading);
    try {
      const requests = arr(await app().rpc('list_information_publication_requests')).filter(item => item.information_kind === 'notice');
      loading.remove();
      if (!isOperations) {
        const edit = requests.find(item => item.id === informationEditingId && item.status === 'changes_requested');
        const composer = document.createElement('section'); composer.className = 'dashboard-section promotion-composer';
        composer.append(text('h2', edit ? '보완 후 다시 상신' : '새 공지 작성'), informationForm(edit || null));
        target.append(composer);
      }
      const section = document.createElement('section'); section.className = 'dashboard-section';
      section.append(text('h2', isOperations ? '승인·검토 목록' : '내 상신 목록'));
      const grid = document.createElement('div'); grid.className = 'phase-c-v2-grid';
      if (!requests.length) grid.append(text('p', '현재 등록된 공지 상신안이 없습니다.', 'empty'));
      requests.forEach(item => grid.append(informationRequestCard(item, isOperations)));
      section.append(grid);
      target.append(section);
    } catch (error) {
      loading.textContent = app().friendlyError?.(error) || error.message || '공지를 불러오지 못했습니다.';
      loading.classList.add('error');
    }
  }

  async function decorateReviewSubmitters() {
    if (route() !== 'promotion_lead') return;
    const target = main();
    if (!target) return;
    const cards = [...target.querySelectorAll('.phase-c-v2-grid .phase-c-v2-card')].slice(0, 20);
    if (!cards.length) return;
    try {
      const workspace = await app().rpc('get_my_promotion_workspace');
      const items = arr(workspace?.review_items).slice(0, cards.length);
      await Promise.all(items.map(async (item, index) => {
        const card = cards[index];
        if (!card || card.querySelector('[data-issue207-submitter]')) return;
        try {
          const info = await app().rpc('get_promotion_review_submitter', { p_content_id: item.content_id });
          const owner = info?.owner_name || info?.revision_author_name || info?.submitted_by_name;
          const submitter = info?.submitted_by_name;
          const label = owner && submitter && owner !== submitter ? `작성자: ${owner} · 현재 상신: ${submitter}` : `상신 직원: ${owner || submitter || '확인 필요'}`;
          const node = text('p', label, 'help'); node.dataset.issue207Submitter = '1';
          card.querySelector('h3')?.after(node);
        } catch { /* identity decoration is optional */ }
      }));
    } catch { /* review screen remains usable without decoration */ }
  }

  function scheduleReviewDecoration() {
    [120, 400, 900].forEach(delay => setTimeout(decorateReviewSubmitters, delay));
  }

  document.addEventListener('taejang-app-ready', scheduleNavigation);
  document.addEventListener('taejang-dashboard-refresh', scheduleNavigation);
  document.addEventListener('taejang-open-promotion-workspace', event => {
    scheduleNavigation();
    if (event.detail?.mode === 'write') scheduleWriteCleanup();
    if (event.detail?.mode === 'review') scheduleReviewDecoration();
  });
  window.addEventListener('pageshow', scheduleNavigation);

  window.TaejangIssue207Ux = { openSent, openInformationHub, openInformationRead, ensureNavigation, cleanupWriteScreen };
})();
