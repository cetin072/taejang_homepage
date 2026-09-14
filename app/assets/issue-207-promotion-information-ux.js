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
  const can = code => app()?.hasCapabilityContract?.() ? app()?.can?.(code) === true : false;
  const lifecycleLabel = {
    draft: '작성 중', review_pending: '승인 대기', needs_revision: '보완 필요', approved: '승인 완료',
    scheduled: '게시 예정', published: '게시 완료', hidden: '숨김', archived: '보관'
  };
  const requestStatusLabel = { pending: '승인 대기', changes_requested: '보완 요청', rejected: '반려', approved: '승인 완료' };
  const sourceLabel = { homepage: '홈페이지', blog: '태장 블로그', 'naver-blog': '태장 블로그', youtube: '유튜브', press: '언론·외부', external: '외부' };
  const noticeKinds = {
    general: '일반공지', safety: '안전', working_hours: '근무시간', work_location: '근무장소', training: '교육',
    external_activity: '외부활동', holiday: '휴무', transport: '차량·이동', materials: '준비물', clothing: '복장', company_life: '회사생활'
  };
  const guidanceKinds = {
    working_hours: '근무시간', breaks_meals: '휴게·식사', places: '장소', safety: '안전', clothing_supplies: '복장·준비물',
    absence_contact: '결근·연락', pay_documents: '급여·서류', help_request: '도움 요청', company_life: '회사생활', other: '기타'
  };

  let navScheduled = false;
  let reviewDecorating = false;
  let currentInventory = null;
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

  function markCurrent(node) {
    const nav = document.getElementById('app-nav');
    if (!nav) return;
    [...nav.children].forEach(child => child.removeAttribute('aria-current'));
    node?.setAttribute('aria-current', 'page');
  }

  function navNode(label, run, key) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.dataset.issue207Nav = key;
    node.classList.add('app-nav-item');
    node.addEventListener('click', () => { markCurrent(node); run(); });
    return node;
  }

  function cleanLabel(node) {
    return String(node?.textContent || '').replace(/\s*·\s*점검중\s*$/, '').trim();
  }

  function findNav(labels) {
    const values = new Set(Array.isArray(labels) ? labels : [labels]);
    return [...(document.getElementById('app-nav')?.children || [])].find(node => values.has(cleanLabel(node))) || null;
  }

  function promotionOpen(mode) {
    document.dispatchEvent(new CustomEvent('taejang-open-promotion-workspace', { detail: { mode } }));
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

  function ensureNavigation() {
    navScheduled = false;
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

      [...nav.children].forEach(node => {
        if (['공지 확인', '자주 보는 안내'].includes(cleanLabel(node))) node.remove();
      });
      if (!nav.querySelector('[data-issue207-nav="information-read"]')) nav.append(navNode('공지·안내 확인', openInformationRead, 'information-read'));
      moveKnownToFront(nav, ['대시보드', '새 홍보글 작성', '보낸 글', '보완 요청받은 글', '공지·안내 확인']);
    }

    if (currentRoute === 'promotion_lead') {
      const review = nav.querySelector('[data-phase-c-v2-nav="review"]') || findNav(['홍보 검토', '홍보 관리', '승인·검토']);
      if (review) review.textContent = '승인·검토';
      const write = nav.querySelector('[data-phase-c-v2-nav="write"]') || findNav(['홍보 작성', '새 홍보글 작성']);
      if (write) write.textContent = '새 홍보글 작성';

      [...nav.children].forEach(node => {
        if (['홍보 글 관리', '공개글 관리', '미발행 글 삭제', '공지 관리', '상시 안내 관리'].includes(cleanLabel(node))) node.remove();
      });
      if (!nav.querySelector('[data-issue207-nav="inventory"]')) nav.append(navNode('기존 글 관리', openPublicContentInventory, 'inventory'));
      if (!nav.querySelector('[data-issue207-nav="information-manage"]')) nav.append(navNode('공지·안내 관리', openInformationHub, 'information-manage'));
      moveKnownToFront(nav, ['대시보드', '새 홍보글 작성', '승인·검토', '기존 글 관리', '홈페이지 내용 관리', '공지·안내 관리']);
    }

    if (currentRoute === 'operations_manager') {
      [...nav.children].forEach(node => {
        if (['공지 관리', '상시 안내 관리'].includes(cleanLabel(node))) node.remove();
      });
      if (!nav.querySelector('[data-issue207-nav="inventory"]')) nav.append(navNode('기존 글 관리', openPublicContentInventory, 'inventory'));
      if (!nav.querySelector('[data-issue207-nav="information-manage"]')) nav.append(navNode('공지·안내 관리', openInformationHub, 'information-manage'));
    }
  }

  function scheduleNavigation() {
    if (navScheduled) return;
    navScheduled = true;
    setTimeout(ensureNavigation, 0);
  }

  function cleanupWriteScreen() {
    const target = main();
    if (!target) return;
    const pageTitle = document.getElementById('desktop-page-title')?.textContent || '';
    if (!pageTitle.includes('홍보 작성') && !target.querySelector('.phase-c-board-composer')) return;
    [...target.querySelectorAll('.dashboard-section')].forEach(section => {
      const heading = section.querySelector('h2')?.textContent.trim();
      if (heading === '내 작성글' || heading === '내가 작성한 홍보자료') section.remove();
    });
    const introTitle = target.querySelector('.dashboard-intro h2');
    if (route() === 'promotion_lead' && introTitle && /새 홍보자료 작성|새 태장 소식 작성/.test(introTitle.textContent)) introTitle.textContent = '새 홍보글 작성';
  }

  function contentPreview(item) {
    const details = document.createElement('details');
    details.className = 'editor-card';
    details.append(text('summary', '내용 미리보기'));
    const box = document.createElement('div');
    if (item.summary) box.append(text('p', item.summary));
    if (item.public_body) box.append(text('p', item.public_body, 'promotion-preview-body'));
    details.append(box);
    return details;
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
      const grid = document.createElement('div');
      grid.className = 'phase-c-v2-grid';
      if (!items.length) grid.append(text('p', '아직 운영팀장에게 보낸 글이 없습니다.', 'empty'));
      items.forEach(item => {
        const card = document.createElement('article');
        card.className = 'dashboard-card phase-c-v2-card';
        card.append(text('span', lifecycleLabel[item.lifecycle] || item.lifecycle, 'status-label'), text('h3', item.title || '제목 없음'));
        if (item.submitted_at) card.append(text('p', `상신 ${new Date(item.submitted_at).toLocaleString('ko-KR')}`, 'help'));
        card.append(contentPreview(item));
        grid.append(card);
      });
      section.append(grid);
    } catch (error) {
      section.replaceChildren(text('p', app().friendlyError?.(error) || '보낸 글을 불러오지 못했습니다.', 'message error'));
    }
  }

  async function openInformationRead() {
    const target = setPage('공지·안내 확인', '확인', '중요공지와 평소 자주 보는 안내를 한 화면에서 확인합니다.');
    if (!target) return;
    const slot = text('p', '공지·안내를 불러오고 있습니다.', 'message');
    target.append(slot);
    const results = await Promise.allSettled([
      app().rpc('get_my_notice_list', { p_limit: 100 }),
      app().rpc('get_my_staff_guidance_list', { p_category: null, p_limit: 100 })
    ]);
    slot.remove();
    const noticeSection = document.createElement('section');
    noticeSection.className = 'dashboard-section';
    noticeSection.append(text('h2', '공지'));
    const notices = results[0].status === 'fulfilled' ? arr(results[0].value) : [];
    const noticeGrid = document.createElement('div'); noticeGrid.className = 'phase-c-v2-grid';
    if (!notices.length) noticeGrid.append(text('p', '현재 확인할 공지가 없습니다.', 'empty'));
    notices.forEach(item => {
      const card = document.createElement('article'); card.className = 'dashboard-card';
      card.append(text('span', item.importance === 'urgent' ? '긴급' : item.importance === 'important' ? '중요' : '공지', 'status-label'), text('h3', item.title), text('p', item.body_easy || ''));
      noticeGrid.append(card);
    });
    noticeSection.append(noticeGrid);

    const guidanceSection = document.createElement('section'); guidanceSection.className = 'dashboard-section'; guidanceSection.append(text('h2', '상시 안내'));
    const guides = results[1].status === 'fulfilled' ? arr(results[1].value) : [];
    const guideGrid = document.createElement('div'); guideGrid.className = 'phase-c-v2-grid';
    if (!guides.length) guideGrid.append(text('p', '현재 등록된 상시 안내가 없습니다.', 'empty'));
    guides.forEach(item => {
      const card = document.createElement('article'); card.className = 'dashboard-card';
      card.append(text('span', guidanceKinds[item.category] || '안내', 'status-label'), text('h3', item.title), text('p', item.summary_easy || item.body_easy || ''));
      guideGrid.append(card);
    });
    guidanceSection.append(guideGrid);
    target.append(noticeSection, guidanceSection);
  }

  function option(value, label) {
    const node = document.createElement('option'); node.value = value; node.textContent = label; return node;
  }

  function field(label, control, help) {
    const wrap = document.createElement('label'); wrap.append(text('span', label));
    if (help) wrap.append(text('small', help, 'field-help'));
    wrap.append(control); return wrap;
  }

  function informationForm(request = null) {
    const form = document.createElement('form'); form.className = 'phase-c-board-form'; form.addEventListener('submit', event => event.preventDefault());
    const kind = document.createElement('select'); kind.append(option('notice', '공지'), option('guidance', '상시 안내'));
    const category = document.createElement('select');
    const importance = document.createElement('select'); importance.append(option('normal','일반'), option('important','중요'), option('urgent','긴급'));
    const title = document.createElement('input'); title.maxLength = 120;
    const summary = document.createElement('textarea'); summary.rows = 2; summary.maxLength = 500;
    const body = document.createElement('textarea'); body.rows = 7; body.maxLength = 3000;
    const from = document.createElement('input'); from.type = 'date';
    const until = document.createElement('input'); until.type = 'date';
    const publish = document.createElement('input'); publish.type = 'datetime-local';
    const reason = document.createElement('textarea'); reason.rows = 2; reason.maxLength = 1000;

    const refreshCategories = () => {
      category.replaceChildren();
      Object.entries(kind.value === 'notice' ? noticeKinds : guidanceKinds).forEach(([value,label]) => category.append(option(value,label)));
      importance.closest('label')?.toggleAttribute('hidden', kind.value !== 'notice');
      summary.closest('label')?.toggleAttribute('hidden', kind.value !== 'guidance');
    };
    kind.addEventListener('change', refreshCategories);
    form.append(
      field('유형', kind), field('분류', category), field('중요도', importance), field('제목', title),
      field('짧은 설명', summary, '상시 안내에만 사용합니다.'), field('내용', body),
      field('적용 시작일', from), field('적용 종료일', until), field('게시 시작', publish, '비워두면 운영총괄 승인 시 게시합니다.'),
      field('상신 사유', reason)
    );
    refreshCategories();

    if (request) {
      kind.value = request.information_kind || 'notice'; refreshCategories();
      category.value = request.category_code || category.value;
      importance.value = request.importance_code || 'normal'; title.value = request.title || '';
      summary.value = request.summary_easy || ''; body.value = request.body_easy || '';
      from.value = request.effective_from || ''; until.value = request.effective_until || '';
      if (request.publish_start_at) {
        const date = new Date(request.publish_start_at); if (!Number.isNaN(date.getTime())) publish.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
      }
      reason.value = request.reason || '';
    }

    const submit = button(request ? '보완 후 다시 상신' : '운영총괄에게 상신', async () => {
      if (!title.value.trim() || !body.value.trim() || !reason.value.trim()) { window.alert('제목, 내용, 상신 사유를 입력해 주세요.'); return; }
      try {
        await app().rpc('save_information_publication_request', {
          p_request_id: request?.id || null,
          p_information_kind: kind.value,
          p_category_code: category.value,
          p_importance_code: kind.value === 'notice' ? importance.value : 'normal',
          p_title: title.value.trim(), p_summary_easy: summary.value.trim() || null, p_body_easy: body.value.trim(),
          p_effective_from: from.value || null, p_effective_until: until.value || null,
          p_publish_start_at: publish.value ? new Date(publish.value).toISOString() : null,
          p_reason: reason.value.trim()
        });
        informationEditingId = null;
        await openInformationHub();
      } catch (error) { window.alert(app().friendlyError?.(error) || error.message || '공지·안내를 상신하지 못했습니다.'); }
    });
    form.append(submit);
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
    } catch (error) { window.alert(app().friendlyError?.(error) || error.message || '처리하지 못했습니다.'); }
  }

  function informationRequestCard(request, isOperations) {
    const card = document.createElement('article'); card.className = 'dashboard-card phase-c-v2-card';
    card.append(text('span', `${request.information_kind === 'notice' ? '공지' : '상시 안내'} · ${requestStatusLabel[request.status] || request.status}`, 'status-label'));
    card.append(text('h3', request.title || '제목 없음'));
    if (request.requested_by_name) card.append(text('p', `상신자: ${request.requested_by_name}`, 'help'));
    card.append(text('p', request.summary_easy || request.body_easy || ''));
    if (request.decision_comment) card.append(text('p', `검토 의견: ${request.decision_comment}`, 'phase-c-review-note'));
    const actions = document.createElement('div'); actions.className = 'quick-links';
    if (isOperations && request.status === 'pending') {
      actions.append(button('승인·게시', () => reviewInformation(request, 'approve')), button('보완 요청', () => reviewInformation(request, 'changes_requested'), true), button('반려', () => reviewInformation(request, 'reject'), true));
    } else if (!isOperations && request.status === 'changes_requested') {
      actions.append(button('보완해서 다시 상신', () => { informationEditingId = request.id; openInformationHub(); }));
    }
    if (actions.childNodes.length) card.append(actions);
    return card;
  }

  async function openInformationHub() {
    const currentRoute = route();
    const isOperations = currentRoute === 'operations_manager';
    const target = setPage('공지·안내 관리', '공지·안내', isOperations ? '홍보팀장이 상신한 공지와 상시 안내를 한 화면에서 검토하고 승인·게시합니다.' : '공지와 상시 안내를 한 화면에서 작성하고 운영총괄에게 상신합니다. 홍보팀장은 직접 게시할 수 없습니다.');
    if (!target) return;
    const loading = text('p', '공지·안내 상신 내역을 불러오고 있습니다.', 'message'); target.append(loading);
    try {
      const requests = arr(await app().rpc('list_information_publication_requests'));
      loading.remove();
      if (!isOperations) {
        const edit = requests.find(item => item.id === informationEditingId && item.status === 'changes_requested');
        const composer = document.createElement('section'); composer.className = 'dashboard-section promotion-composer';
        composer.append(text('h2', edit ? '보완 후 다시 상신' : '새 공지·안내 작성'), informationForm(edit || null));
        target.append(composer);
      }
      const section = document.createElement('section'); section.className = 'dashboard-section';
      section.append(text('h2', isOperations ? '승인·검토 목록' : '내 상신 목록'));
      const grid = document.createElement('div'); grid.className = 'phase-c-v2-grid';
      if (!requests.length) grid.append(text('p', '현재 등록된 공지·안내 상신안이 없습니다.', 'empty'));
      requests.forEach(item => grid.append(informationRequestCard(item, isOperations)));
      section.append(grid); target.append(section);
    } catch (error) {
      loading.textContent = app().friendlyError?.(error) || error.message || '공지·안내를 불러오지 못했습니다.'; loading.classList.add('error');
    }
  }

  function loadArchiveInventory() {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.hidden = true; frame.tabIndex = -1; frame.src = `../archive.html?admin_inventory=${Date.now()}`;
      const timer = setTimeout(() => { frame.remove(); reject(new Error('ARCHIVE_INVENTORY_TIMEOUT')); }, 15000);
      frame.addEventListener('load', () => {
        setTimeout(() => {
          try {
            const ordered = frame.contentWindow?.TAEJANG_CONTENT_HUB?.orderedItems?.();
            const items = JSON.parse(JSON.stringify(arr(ordered)));
            clearTimeout(timer); frame.remove(); resolve(items);
          } catch (error) { clearTimeout(timer); frame.remove(); reject(error); }
        }, 120);
      }, { once: true });
      frame.addEventListener('error', () => { clearTimeout(timer); frame.remove(); reject(new Error('ARCHIVE_INVENTORY_LOAD_FAILED')); }, { once: true });
      document.body.append(frame);
    });
  }

  function promotionId(item) {
    const match = String(item?.id || '').match(/^promotion-([0-9a-f-]{36})$/i);
    return match ? match[1] : null;
  }

  function isRecent(publishedAt) {
    if (!publishedAt) return false;
    const time = new Date(publishedAt).getTime();
    return Number.isFinite(time) && time > Date.now() - 24 * 60 * 60 * 1000;
  }

  async function requestDelete(contentId, title) {
    const reason = window.prompt(`“${title}” 삭제 요청 사유를 적어주세요.`, '')?.trim();
    if (!reason) return;
    try { await app().rpc('request_promotion_deletion', { p_content_id: contentId, p_reason: reason }); window.alert('운영총괄에게 삭제 요청을 보냈습니다.'); await openPublicContentInventory(); }
    catch (error) { window.alert(app().friendlyError?.(error) || error.message || '삭제 요청을 보내지 못했습니다.'); }
  }

  async function directArchive(contentId, title) {
    const reason = window.prompt(`“${title}” 글을 24시간 내 정리하는 이유를 적어주세요.`, '')?.trim();
    if (!reason || !window.confirm('공개 목록에서 내립니다. 원문과 감사기록은 복구 가능하게 보존됩니다. 계속할까요?')) return;
    try { await app().rpc('lead_archive_recent_promotion_content', { p_content_id: contentId, p_reason: reason }); await openPublicContentInventory(); }
    catch (error) { window.alert(app().friendlyError?.(error) || error.message || '글을 정리하지 못했습니다.'); }
  }

  async function fetchPublicPromotionDetail(contentId) {
    try {
      const response = await fetch(`../.netlify/functions/public-promotion-feed?id=${encodeURIComponent(contentId)}&format=json`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return null;
      const data = await response.json(); return data?.item || null;
    } catch { return null; }
  }

  async function openPublicChangeForm(item, adminItem, direct) {
    const contentId = promotionId(item);
    const target = setPage(direct ? '기존 글 수정' : '기존 글 수정 요청', '소식·기록 관리', direct ? '공개 후 24시간 이내 글은 홍보팀장이 수정할 수 있습니다. 수정 이력과 감사기록은 보존됩니다.' : '24시간이 지난 글이나 정적 아카이브 글은 운영총괄에게 수정 요청으로 상신합니다.');
    if (!target) return;
    let detail = null;
    if (contentId) detail = await fetchPublicPromotionDetail(contentId);
    const section = document.createElement('section'); section.className = 'dashboard-section promotion-composer';
    const form = document.createElement('form'); form.className = 'phase-c-board-form'; form.addEventListener('submit', event => event.preventDefault());
    const title = document.createElement('input'); title.value = detail?.title || item.title || ''; title.maxLength = 500;
    const summary = document.createElement('textarea'); summary.rows = 4; summary.value = detail?.summary || item.summary || ''; summary.maxLength = 4000;
    const body = document.createElement('textarea'); body.rows = 10; body.value = detail?.public_body || ''; body.maxLength = 30000;
    const reason = document.createElement('textarea'); reason.rows = 3; reason.maxLength = 1000;
    form.append(field('제목', title), field('요약', summary), field('본문', body, item.type === 'external' ? '외부 콘텐츠는 원문 전체를 복사하지 말고 태장 측 설명만 작성하세요.' : ''), field('수정 사유', reason));
    form.append(button(direct ? '수정 반영' : '운영총괄에게 수정 요청', async () => {
      if (!reason.value.trim()) { window.alert('수정 사유를 적어주세요.'); return; }
      try {
        if (direct && contentId) {
          await app().rpc('lead_update_recent_promotion_content', {
            p_content_id: contentId, p_title: title.value.trim(), p_summary: summary.value.trim() || null,
            p_public_body: body.value.trim() || null, p_reason: reason.value.trim()
          });
        } else {
          await app().rpc('create_public_content_change_request', {
            p_target_kind: contentId ? 'promotion' : 'archive', p_target_key: contentId || String(item.id),
            p_current_title: item.title || null, p_current_summary: item.summary || null,
            p_proposed_title: title.value.trim() || null, p_proposed_summary: summary.value.trim() || null,
            p_proposed_body: body.value.trim() || null, p_reason: reason.value.trim(),
            p_published_at: adminItem?.published_at || (item.publishedAt ? `${item.publishedAt.length === 7 ? `${item.publishedAt}-01` : item.publishedAt}T00:00:00Z` : null)
          });
        }
        await openPublicContentInventory();
      } catch (error) { window.alert(app().friendlyError?.(error) || error.message || '수정 내용을 저장하지 못했습니다.'); }
    }), button('목록으로', openPublicContentInventory, true));
    section.append(form); target.append(section);
  }

  async function reviewPublicChange(request, action) {
    let comment = null;
    if (action !== 'approve') {
      comment = window.prompt(action === 'changes_requested' ? '보완할 내용을 적어주세요.' : '반려 이유를 적어주세요.', '')?.trim();
      if (!comment) return;
    }
    try {
      const result = await app().rpc('review_public_content_change_request', { p_request_id: request.id, p_action: action, p_comment: comment });
      if (result?.requires_code_apply) window.alert('승인했습니다. 이 글은 정적 아카이브 원본이므로 코드 반영 단계가 필요합니다. 요청 기록은 보존됩니다.');
      await openPublicContentInventory();
    } catch (error) { window.alert(app().friendlyError?.(error) || error.message || '수정 요청을 처리하지 못했습니다.'); }
  }

  function changeRequestCard(request) {
    const card = document.createElement('article'); card.className = 'dashboard-card phase-c-v2-card';
    card.append(text('span', `${request.target_kind === 'promotion' ? 'DB 홍보글' : '정적 아카이브'} · ${requestStatusLabel[request.status] || request.status}`, 'status-label'));
    card.append(text('h3', request.current_title || request.target_key));
    if (request.requested_by_name) card.append(text('p', `요청자: ${request.requested_by_name}`, 'help'));
    card.append(text('p', `수정 사유: ${request.reason || ''}`));
    if (request.proposed_title) card.append(text('p', `새 제목: ${request.proposed_title}`));
    if (request.proposed_summary) card.append(text('p', `새 요약: ${request.proposed_summary}`));
    if (request.requires_code_apply) card.append(text('p', '승인됨 · 정적 원본 코드 반영 필요', 'message'));
    if (route() === 'operations_manager' && request.status === 'pending') {
      const actions = document.createElement('div'); actions.className = 'quick-links';
      actions.append(button('승인', () => reviewPublicChange(request, 'approve')), button('보완 요청', () => reviewPublicChange(request, 'changes_requested'), true), button('반려', () => reviewPublicChange(request, 'reject'), true));
      card.append(actions);
    }
    return card;
  }

  function inventoryCard(item, adminMap) {
    const card = document.createElement('article'); card.className = 'dashboard-card phase-c-v2-card';
    const contentId = promotionId(item); const adminItem = contentId ? adminMap.get(contentId) : null;
    const label = sourceLabel[item.source] || item.publisher || item.source || '홈페이지';
    card.dataset.issue207Source = item.source || 'homepage'; card.dataset.issue207Category = item.category || '기타';
    card.append(text('span', `${label} · ${item.category || '기타'}`, 'status-label'), text('h3', item.title || '제목 없음'));
    if (item.publishedAt) card.append(text('p', `공개일 ${item.publishedAt}`, 'help'));
    if (item.summary) card.append(text('p', item.summary));
    const actions = document.createElement('div'); actions.className = 'quick-links';
    const href = item.externalUrl || item.detailUrl;
    if (href) {
      const link = document.createElement('a'); link.href = href.startsWith('http') ? href : `../${href}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'button button-quiet'; link.textContent = '공개 화면'; actions.append(link);
    }
    if (route() === 'promotion_lead') {
      if (contentId && adminItem && isRecent(adminItem.published_at)) {
        actions.append(button('수정', () => openPublicChangeForm(item, adminItem, true), true), button('24시간 내 삭제', () => directArchive(contentId, item.title), true));
      } else {
        actions.append(button('수정 요청', () => openPublicChangeForm(item, adminItem, false), true));
        if (contentId && adminItem?.published_at && !isRecent(adminItem.published_at)) actions.append(button('삭제 요청', () => requestDelete(contentId, item.title), true));
      }
    }
    card.append(actions); return card;
  }

  function renderInventoryItems(section, items, adminMap) {
    const controls = document.createElement('div'); controls.className = 'phase-c-board-row';
    const category = document.createElement('select'); category.append(option('all','전체 목차'));
    [...new Set(items.map(item => item.category).filter(Boolean))].sort().forEach(value => category.append(option(value,value)));
    const source = document.createElement('select'); source.append(option('all','전체 출처'));
    [...new Set(items.map(item => item.source).filter(Boolean))].sort().forEach(value => source.append(option(value,sourceLabel[value] || value)));
    controls.append(field('목차', category), field('출처', source));
    const grid = document.createElement('div'); grid.className = 'phase-c-v2-grid';
    const draw = () => {
      const filtered = items.filter(item => (category.value === 'all' || item.category === category.value) && (source.value === 'all' || item.source === source.value));
      grid.replaceChildren();
      if (!filtered.length) grid.append(text('p', '조건에 맞는 공개 글이 없습니다.', 'empty'));
      filtered.forEach(item => grid.append(inventoryCard(item, adminMap)));
    };
    category.addEventListener('change', draw); source.addEventListener('change', draw); draw();
    section.append(controls, grid);
  }

  async function openPublicContentInventory() {
    const target = setPage('기존 글 관리', '소식·기록', '현재 공개 소식·기록에 보이는 글을 목차와 출처별로 찾아 관리합니다. 본인이 쓴 글, 직원 상신 글, 정적/ChatGPT 반영 글, 블로그·유튜브·언론 연결글을 함께 확인합니다.');
    if (!target) return;
    const loading = text('p', '공개 글 목록을 불러오고 있습니다.', 'message'); target.append(loading);
    try {
      const [inventoryResult, publicationResult, changeResult] = await Promise.allSettled([
        loadArchiveInventory(), app().rpc('get_promotion_publication_admin'), app().rpc('list_public_content_change_requests')
      ]);
      const items = inventoryResult.status === 'fulfilled' ? inventoryResult.value : [];
      const publication = publicationResult.status === 'fulfilled' ? publicationResult.value : {};
      const changeRequests = changeResult.status === 'fulfilled' ? arr(changeResult.value) : [];
      currentInventory = items;
      loading.remove();

      if (route() === 'operations_manager' && changeRequests.length) {
        const pendingSection = document.createElement('section'); pendingSection.className = 'dashboard-section';
        pendingSection.append(text('h2', `수정 요청 ${changeRequests.filter(item => item.status === 'pending').length}건`));
        const pendingGrid = document.createElement('div'); pendingGrid.className = 'phase-c-v2-grid';
        changeRequests.forEach(request => pendingGrid.append(changeRequestCard(request)));
        pendingSection.append(pendingGrid); target.append(pendingSection);
      }

      const section = document.createElement('section'); section.className = 'dashboard-section';
      section.append(text('h2', `공개 소식·기록 ${items.length}건`));
      const adminMap = new Map(arr(publication?.items).map(item => [item.content_id, item]));
      if (!items.length) section.append(text('p', '공개 아카이브 목록을 불러오지 못했습니다. 공개 홈페이지는 그대로 유지됩니다.', 'message error'));
      else renderInventoryItems(section, items, adminMap);
      target.append(section);
    } catch (error) {
      loading.textContent = error.message || '공개 글 목록을 불러오지 못했습니다.'; loading.classList.add('error');
    }
  }

  async function decorateReviewSubmitters() {
    if (reviewDecorating || route() !== 'promotion_lead') return;
    const target = main();
    if (!target) return;
    const title = document.getElementById('desktop-page-title')?.textContent || '';
    if (!/홍보 검토|승인·검토/.test(title)) return;
    const cards = [...target.querySelectorAll('.phase-c-v2-grid .phase-c-v2-card')];
    if (!cards.length || cards.every(card => card.querySelector('[data-issue207-submitter]'))) return;
    reviewDecorating = true;
    try {
      const workspace = await app().rpc('get_my_promotion_workspace');
      const items = arr(workspace?.review_items);
      for (let index = 0; index < Math.min(items.length, cards.length); index += 1) {
        const card = cards[index]; if (card.querySelector('[data-issue207-submitter]')) continue;
        try {
          const info = await app().rpc('get_promotion_review_submitter', { p_content_id: items[index].content_id });
          const owner = info?.owner_name || info?.revision_author_name || info?.submitted_by_name;
          const submitter = info?.submitted_by_name;
          const label = owner && submitter && owner !== submitter ? `작성자: ${owner} · 현재 상신: ${submitter}` : `상신 직원: ${owner || submitter || '확인 필요'}`;
          const node = text('p', label, 'help'); node.dataset.issue207Submitter = '1';
          card.querySelector('h3')?.after(node);
        } catch { /* optional identity decoration; review remains usable */ }
      }
    } finally { reviewDecorating = false; }
  }

  function injectStyles() {
    if (document.querySelector('style[data-issue207-ux]')) return;
    const style = document.createElement('style'); style.dataset.issue207Ux = '1';
    style.textContent = `
      [data-issue207-nav] { font-weight:750; }
      .phase-c-v2-grid details.editor-card { margin-top:8px; }
      .phase-c-v2-grid details.editor-card > div { padding:10px 0 0; white-space:pre-wrap; }
      .dashboard-section .phase-c-board-row { margin-bottom:14px; }
    `;
    document.head.append(style);
  }

  let bodyObserver = null;
  function onUiMutation() {
    scheduleNavigation();
    cleanupWriteScreen();
    setTimeout(decorateReviewSubmitters, 50);
  }

  function start() {
    injectStyles();
    scheduleNavigation();
    if (!bodyObserver && document.body) {
      bodyObserver = new MutationObserver(onUiMutation);
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    }
    setTimeout(onUiMutation, 100);
  }

  document.addEventListener('taejang-app-ready', start);
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(onUiMutation, 50));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();

  window.TaejangIssue207Ux = { openSent, openPublicContentInventory, openInformationHub, openInformationRead, ensureNavigation, cleanupWriteScreen };
})();
