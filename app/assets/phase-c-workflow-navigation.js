(() => {
  'use strict';

  let promotionMode = 'review';
  let syncing = false;
  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value || '';
    if (className) node.className = className;
    return node;
  };
  const button = (label, handler, quiet = true) => {
    const node = text('button', label, `button${quiet ? ' button-quiet' : ''}`);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  };
  const array = value => Array.isArray(value) ? value : [];

  function loadStyles() {
    if (document.querySelector('link[data-phase-c-workflow-navigation]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'assets/phase-c-workflow-navigation.css';
    link.dataset.phaseCWorkflowNavigation = '1';
    document.head.append(link);
  }

  function closeSidebar() {
    const shell = document.getElementById('desktop-app-shell');
    shell?.classList.remove('sidebar-open');
    document.getElementById('sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  }

  function openPromotion(mode) {
    closeSidebar();
    document.dispatchEvent(new CustomEvent('taejang-open-promotion-workspace', { detail: { mode } }));
  }

  function navButton(label, handler, key) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.dataset.phaseCNav = key;
    node.addEventListener('click', handler);
    return node;
  }

  function insertBeforeHomepage(nav, node) {
    const homepage = [...nav.querySelectorAll('a')].find(link => link.textContent.trim() === '홈페이지');
    if (homepage) nav.insertBefore(node, homepage);
    else nav.append(node);
  }

  function openHomepageContent() {
    closeSidebar();
    if (window.TaejangHomepageContent?.open) window.TaejangHomepageContent.open();
    else document.dispatchEvent(new Event('taejang-open-homepage-content'));
    setTimeout(enhanceHomepageCatalog, 220);
  }

  function openScheduleCalendar() {
    closeSidebar();
    document.dispatchEvent(new Event('taejang-dashboard-refresh'));
    setTimeout(() => {
      const calendar = document.querySelector('[data-pilot-calendar]');
      calendar?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 420);
  }

  function syncNavigation() {
    const nav = document.getElementById('app-nav');
    const currentRoute = route();
    if (!nav || !currentRoute) return;

    [...nav.querySelectorAll('button')].forEach(node => {
      if (node.textContent.trim() === '신규 사업 기획') node.remove();
    });
    [...document.querySelectorAll('.quick-links button')].forEach(node => {
      if (node.textContent.trim() === '신규 사업 기획') node.remove();
    });

    if (currentRoute === 'promotion_staff') {
      if (!nav.querySelector('[data-phase-c-nav="revision"]')) {
        const write = [...nav.querySelectorAll('button')].find(node => node.textContent.trim() === '홍보 작성');
        const revision = navButton('수정·보완 요청', () => openPromotion('revision'), 'revision');
        if (write) nav.insertBefore(revision, write); else insertBeforeHomepage(nav, revision);
      }
    }

    if (currentRoute === 'promotion_lead') {
      if (!nav.querySelector('[data-phase-c-nav="publication"]')) insertBeforeHomepage(nav, navButton('발행 대기', openPublication, 'publication'));
      if (!nav.querySelector('[data-phase-c-nav="calendar"]')) insertBeforeHomepage(nav, navButton('일정 캘린더', openScheduleCalendar, 'calendar'));
    }

    if (currentRoute === 'operations_manager') {
      if (!nav.querySelector('[data-phase-c-nav="publication"]')) insertBeforeHomepage(nav, navButton('발행 대기', openPublication, 'publication'));
      if (!nav.querySelector('[data-phase-c-nav="calendar"]')) insertBeforeHomepage(nav, navButton('일정 캘린더', openScheduleCalendar, 'calendar'));
    }

    if (currentRoute === 'ceo') {
      if (!nav.querySelector('[data-phase-c-nav="calendar"]')) insertBeforeHomepage(nav, navButton('일정 캘린더', openScheduleCalendar, 'calendar'));
    }

    if (['promotion_lead', 'operations_manager'].includes(currentRoute)) {
      const existing = [...nav.querySelectorAll('button')].find(node => node.textContent.trim() === '홈페이지 내용 관리');
      if (existing && !existing.dataset.phaseCHomepageRebound) {
        const replacement = navButton('홈페이지 내용 관리', openHomepageContent, 'homepage-content');
        existing.replaceWith(replacement);
      } else if (!existing && !nav.querySelector('[data-phase-c-nav="homepage-content"]')) {
        insertBeforeHomepage(nav, navButton('홈페이지 내용 관리', openHomepageContent, 'homepage-content'));
      }
    }
  }

  function sectionByHeading(target, heading) {
    return [...target.querySelectorAll('.dashboard-section')]
      .find(section => section.querySelector(':scope > h2')?.textContent.trim() === heading) || null;
  }

  async function applyPromotionMode() {
    const target = main();
    const currentRoute = route();
    if (!target || !['promotion_staff', 'promotion_lead'].includes(currentRoute)) return;
    const intro = target.querySelector(':scope > .dashboard-intro');
    if (!intro) return;
    const composer = target.querySelector('[data-promotion-composer]');
    const review = target.querySelector('[data-core-promotion-review]');
    const pilotReview = target.querySelector('[data-pilot-review-section]');
    const myContent = sectionByHeading(target, '내가 작성한 콘텐츠');
    const publication = sectionByHeading(target, '홈페이지 발행 대기');
    const heading = intro.querySelector('h2');
    const copy = [...intro.querySelectorAll(':scope > p')].at(-1);
    const topTitle = document.getElementById('desktop-page-title');
    if (publication) publication.hidden = true;

    let workspace = null;
    try { workspace = await app().rpc('get_my_promotion_workspace'); } catch { workspace = null; }

    if (promotionMode === 'review' && currentRoute === 'promotion_lead') {
      if (composer) composer.hidden = true;
      if (review) review.hidden = false;
      if (pilotReview) pilotReview.hidden = false;
      if (myContent) myContent.hidden = true;
      if (heading) heading.textContent = '홍보 검토';
      if (copy) copy.textContent = '홍보직원이 올린 승인 요청과 운영총괄이 다시 내려보낸 보완 요청만 확인합니다.';
      if (topTitle) topTitle.textContent = '홍보 업무';
      await refineReviewCards(workspace || {});
      return;
    }

    if (promotionMode === 'revision' && currentRoute === 'promotion_staff') {
      if (composer) composer.hidden = true;
      if (myContent) myContent.hidden = false;
      if (heading) heading.textContent = '수정·보완 요청';
      if (copy) copy.textContent = '보완 요청을 받은 건만 표시합니다. 카드에서 보완 내용을 확인하고 수정본을 작성하세요.';
      if (topTitle) topTitle.textContent = '홍보 업무';
      const items = array(workspace?.my_items);
      const cards = [...(myContent?.querySelectorAll('.promotion-card') || [])];
      let visible = 0;
      cards.forEach((card, index) => {
        const show = items[index]?.lifecycle === 'needs_revision';
        card.hidden = !show;
        if (show) visible += 1;
      });
      myContent?.querySelector('[data-phase-c-revision-empty]')?.remove();
      if (!visible && myContent) {
        const empty = text('p', '현재 수정·보완 요청이 없습니다.', 'empty');
        empty.dataset.phaseCRevisionEmpty = '1';
        myContent.append(empty);
      }
      return;
    }

    if (promotionMode === 'write') {
      if (composer) composer.hidden = false;
      if (review) review.hidden = true;
      if (pilotReview) pilotReview.hidden = true;
      if (myContent) myContent.hidden = false;
      if (heading) heading.textContent = '홍보 작성';
      if (copy) copy.textContent = '새 홍보자료 작성과 일반 작성본 관리 화면입니다. 보완 요청 건은 별도 메뉴에서 처리합니다.';
      if (topTitle) topTitle.textContent = '홍보 업무';
      if (currentRoute === 'promotion_staff') {
        const items = array(workspace?.my_items);
        [...(myContent?.querySelectorAll('.promotion-card') || [])].forEach((card, index) => {
          card.hidden = items[index]?.lifecycle === 'needs_revision';
        });
      }
    }
  }

  async function refineReviewCards(workspace) {
    const currentRoute = route();
    const section = main()?.querySelector('[data-pilot-review-section]');
    if (!section) return;
    section.classList.add('phase-c-review-grid');
    const cards = [...section.querySelectorAll('.pilot-review-card')];
    const items = array(workspace.review_items);

    for (let index = 0; index < Math.min(cards.length, items.length); index += 1) {
      const card = cards[index];
      const item = items[index];
      if (card.dataset.phaseCReviewRefined) continue;
      card.dataset.phaseCReviewRefined = '1';

      if (currentRoute === 'promotion_lead') {
        let handoff = null;
        try { handoff = await app().rpc('get_promotion_review_handoff', { p_content_id: item.content_id }); } catch { handoff = null; }
        const source = text('span', handoff ? '운영총괄 보완 요청' : '홍보직원 승인 요청', `phase-c-workflow-source${handoff ? ' operations-return' : ''}`);
        card.prepend(source);
        if (handoff?.comment) {
          const note = text('p', `운영총괄 보완 의견\n${handoff.comment}`, 'pilot-review-note');
          source.after(note);
        }
        if (handoff) {
          [...card.querySelectorAll('button')].forEach(node => {
            if (node.textContent.includes('게시일 확인 후 승인') || node.textContent.includes('운영총괄 상신')) node.hidden = true;
          });
          const changeButton = [...card.querySelectorAll('button')].find(node => node.textContent.trim() === '보완 요청');
          if (changeButton) {
            const replacement = button('홍보직원에게 보완 전달', async () => {
              const comment = window.prompt('홍보직원에게 전달할 보완 내용을 확인해 주세요.', handoff.comment || '');
              if (!comment?.trim()) return;
              try {
                await app().rpc('review_promotion_revision', {
                  p_content_id: item.content_id,
                  p_action: 'changes_requested',
                  p_comment: comment.trim(),
                  p_revisit_at: null
                });
                openPromotion('review');
              } catch (error) { window.alert(app().friendlyError(error)); }
            }, true);
            changeButton.replaceWith(replacement);
          }
        }
      }

      if (currentRoute === 'operations_manager') {
        const changeButton = [...card.querySelectorAll('button')].find(node => node.textContent.trim() === '보완 요청');
        if (changeButton) {
          const replacement = button('홍보팀장에게 보완 요청', async () => {
            const comment = window.prompt('홍보팀장에게 내려보낼 보완 내용을 구체적으로 적어주세요.', '');
            if (!comment?.trim()) return;
            try {
              await app().rpc('request_promotion_changes_via_lead', {
                p_content_id: item.content_id,
                p_comment: comment.trim()
              });
              openPromotion('review');
            } catch (error) { window.alert(app().friendlyError(error)); }
          }, true);
          changeButton.replaceWith(replacement);
        }
      }
    }
  }

  function scheduleValue(raw) {
    if (!raw?.trim()) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) throw new Error('게시 예약일을 YYYY-MM-DD 형식으로 입력해 주세요.');
    return `${raw.trim()}T00:00:00+09:00`;
  }

  async function openPublication() {
    closeSidebar();
    const target = main();
    const currentRoute = route();
    if (!target || !['promotion_lead', 'operations_manager'].includes(currentRoute)) return;
    document.getElementById('desktop-page-title').textContent = '발행 대기';
    target.replaceChildren(text('p', '발행 대기 목록을 불러오고 있습니다.', 'message'));
    try {
      const items = array(await app().rpc('get_promotion_publication_overview'));
      const intro = document.createElement('header');
      intro.className = 'dashboard-intro';
      intro.append(
        text('p', '홈페이지 발행', 'eyebrow'),
        text('h2', '최종 승인 · 발행 대기'),
        text('p', currentRoute === 'promotion_lead'
          ? '최종 승인된 콘텐츠를 확인하고 발행 대기함 또는 예약 상태를 관리합니다.'
          : '최종 승인된 콘텐츠와 현재 발행 대기 상태를 조회합니다. 운영총괄은 이 화면에서 발행 상태를 변경하지 않습니다.')
      );
      target.replaceChildren(intro);
      const section = document.createElement('section');
      section.className = 'dashboard-section';
      section.append(text('h2', `발행 대상 ${items.length}건`));
      const grid = document.createElement('div');
      grid.className = 'phase-c-workflow-grid';
      if (!items.length) grid.append(text('p', '현재 최종 승인된 발행 대상이 없습니다.', 'empty'));
      items.forEach(item => {
        const card = document.createElement('article');
        card.className = 'dashboard-card phase-c-publication-card';
        card.append(text('span', item.queue_status === 'queued' ? '발행 대기함' : item.lifecycle === 'scheduled' ? '예약됨' : '최종 승인', 'status-label'));
        card.append(text('h3', item.title || '제목 없음'));
        if (item.hero_image_url) {
          const image = document.createElement('img');
          image.src = item.hero_image_url;
          image.alt = `${item.title || '콘텐츠'} 대표 이미지`;
          image.loading = 'lazy';
          card.append(image);
        }
        if (item.summary) card.append(text('p', item.summary));
        const meta = document.createElement('div');
        meta.className = 'phase-c-publication-meta';
        meta.append(text('span', item.requested_publish_date ? `게시 희망일 ${item.requested_publish_date}` : '게시 희망일 미정'));
        if (item.scheduled_for) meta.append(text('span', `예약 ${item.scheduled_for}`));
        card.append(meta);
        if (currentRoute === 'promotion_lead' && !item.queue_status) {
          card.append(button('발행 대기함에 넣기', async () => {
            const raw = window.prompt('게시 예약일이 있으면 YYYY-MM-DD로 입력하세요. 바로 대기함에 넣으려면 비워두세요.', '');
            if (raw === null) return;
            try {
              await app().rpc('queue_promotion_revision', {
                p_content_id: item.content_id,
                p_scheduled_for: scheduleValue(raw)
              });
              openPublication();
            } catch (error) { window.alert(app().friendlyError(error)); }
          }, false));
        }
        grid.append(card);
      });
      section.append(grid);
      target.append(section);
    } catch (error) {
      target.replaceChildren(text('p', app().friendlyError(error), 'message error'));
    }
  }

  async function syncDashboard() {
    const target = main();
    const currentRoute = route();
    if (!target || !['promotion_staff', 'promotion_lead', 'operations_manager'].includes(currentRoute)) return;
    const heading = target.querySelector('.dashboard-intro h2')?.textContent || '';
    if (!heading.includes('대시보드')) return;

    if (currentRoute === 'promotion_staff') {
      const card = [...target.querySelectorAll('.dashboard-card')].find(node => node.querySelector('h3')?.textContent.trim() === '수정·보완 요청');
      const action = card ? [...card.querySelectorAll('button')].find(node => node.textContent.includes('보완')) : null;
      if (action && !action.dataset.phaseCRevisionDashboard) {
        const replacement = button(action.textContent, () => openPromotion('revision'), true);
        replacement.dataset.phaseCRevisionDashboard = '1';
        action.replaceWith(replacement);
      }
      return;
    }

    const grid = target.querySelector('.dashboard-grid');
    if (!grid || grid.querySelector('[data-phase-c-publication-dashboard]')) return;
    try {
      const items = array(await app().rpc('get_promotion_publication_overview'));
      const card = document.createElement('article');
      card.className = 'dashboard-card';
      card.dataset.phaseCPublicationDashboard = '1';
      card.append(text('span', '현재 정보', 'status-label'), text('h3', '최종 승인 · 발행 대기'));
      card.append(text('p', `${items.length}건`, 'dashboard-value'));
      card.append(text('p', items.length ? '최종 승인이 끝나 발행을 기다리는 콘텐츠가 있습니다.' : '현재 발행 대기 콘텐츠가 없습니다.'));
      card.append(button('발행 대기 확인', openPublication, true));
      grid.append(card);
    } catch { /* dashboard core remains usable */ }
  }

  const homepageCatalog = {
    '메인 페이지': ['첫 화면 소개', '태장 소개 요약', '지금 태장이 하는 일', '태장의 일터', '활동 기록', '협력 안내', '문의'],
    '태장 소개': ['페이지 상단 소개', '태장 한눈에 보기', '태장이라는 이름', '대표 인사말', '태장이 일하는 기준', '태장의 발걸음', '협력·문의 안내'],
    '하는 일': ['페이지 상단 소개', '현재 운영 사업', '협력 검토 흐름', '개발 중인 사업'],
    '우리의 일터': ['페이지 상단 소개', '직무와 작업 방식', '일터 이야기'],
    '소식·기록': ['페이지 상단 소개', '기록 목록 안내'],
    '협력·문의': ['페이지 상단 소개', '함께 출발한 기업', '함께하는 방법', '지역사회공헌·ESG 협력', '자주 묻는 협력 질문', '협력 문의']
  };

  function enhanceHomepageCatalog() {
    const target = main();
    if (!target || target.querySelector('[data-phase-c-homepage-catalog]')) return;
    const heading = target.querySelector('.dashboard-intro h2')?.textContent || '';
    if (!['글·사진 수정 요청', '홈페이지 수정 최종 승인'].includes(heading)) return;
    const section = document.createElement('section');
    section.className = 'dashboard-section phase-c-homepage-catalog';
    section.dataset.phaseCHomepageCatalog = '1';
    section.append(text('h2', '관리 가능한 홈페이지 영역'));
    section.append(text('p', '홈페이지 전체 구조를 편집하는 CMS가 아니라, 아래에 정해진 페이지·섹션의 글과 사진만 수정 요청할 수 있습니다.', 'help'));
    const grid = document.createElement('div');
    grid.className = 'phase-c-workflow-grid';
    Object.entries(homepageCatalog).forEach(([page, sections]) => {
      const card = document.createElement('article');
      card.className = 'dashboard-card';
      card.append(text('h3', page));
      const list = document.createElement('ul');
      sections.forEach(name => list.append(text('li', name)));
      card.append(list);
      grid.append(card);
    });
    section.append(grid);
    const intro = target.querySelector(':scope > .dashboard-intro');
    intro?.after(section);
  }

  async function syncAll() {
    if (syncing) return;
    syncing = true;
    try {
      syncNavigation();
      await syncDashboard();
      await applyPromotionMode();
      enhanceHomepageCatalog();
    } finally { syncing = false; }
  }

  loadStyles();
  document.addEventListener('taejang-app-ready', () => setTimeout(syncAll, 260));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(syncAll, 320));
  document.addEventListener('taejang-open-promotion-workspace', event => {
    promotionMode = event.detail?.mode || 'review';
    setTimeout(syncAll, 420);
  });
  document.addEventListener('taejang-open-homepage-content', () => setTimeout(syncAll, 280));

  const observer = new MutationObserver(() => setTimeout(syncAll, 80));
  const start = () => {
    const target = main();
    if (target) observer.observe(target, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
