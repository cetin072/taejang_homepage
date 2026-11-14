// Selected editorial stories. This is presentation configuration, not publication state.
// Only currently published, first-party promotion records from the approved feed can appear.
(function (root) {
  'use strict';
  const editorial = Object.freeze([
    { id: 'e584c9eb-21bb-4777-8752-f0d36d79cd8d', mirror: 'https://blog.naver.com/taejang-official/224472724117', summary: '네 기업이 함께 만든 태장의 일터와 민화·포장 작업, 지역사회 활동을 소개합니다.' }
  ]);

  function isPinned(item) {
    if (!item || item.status !== 'published' || item.type !== 'internal' || item.source !== 'homepage') return false;
    return editorial.some(entry => item.id === 'promotion-' + entry.id
      && item.detailUrl === 'promotion.html?id=' + entry.id);
  }

  function selectPinned(items, maxCount) {
    const limit = Math.min(4, Math.max(0, Number(maxCount) || 0));
    if (!limit || !Array.isArray(items)) return [];
    const eligible = new Map(items.filter(isPinned).map(item => [item.id, item]));
    return editorial.map(entry => eligible.get('promotion-' + entry.id)).filter(Boolean).slice(0, limit);
  }

  function selectHome(items, maxCount) {
    if (!Array.isArray(items)) return [];
    const limit = Math.max(1, Number(maxCount) || 3);
    const chosen = selectPinned(items, 1);
    const chosenIds = new Set(chosen.map(item => item.id));
    const mirrors = new Set(editorial
      .filter(entry => chosenIds.has('promotion-' + entry.id))
      .map(entry => entry.mirror)
      .filter(Boolean));
    return chosen.concat(items.filter(item => item && item.status === 'published'
      && !chosenIds.has(item.id) && !mirrors.has(item.externalUrl)).slice(0, limit - chosen.length));
  }

  root.TAEJANG_FEATURED_STORIES = Object.freeze({ isPinned, selectPinned, selectHome });

  if (typeof document === 'undefined') return;
  const panel = document.querySelector('[data-featured-stories]');
  const slot = panel && panel.querySelector('[data-featured-stories-list]');
  if (!panel || !slot) return;

  function renderArchiveFeatures() {
    const hub = root.TAEJANG_CONTENT_HUB;
    const feed = root.TAEJANG_ARCHIVE_FEED;
    if (!hub || !feed || feed.status === 'loading') return;
    const anchor = document.querySelector('[data-archive-search]');
    const anchorTop = anchor?.getBoundingClientRect().top;
    const preservePosition = root.scrollY > 0 && anchorTop < innerHeight;
    function restorePosition() {
      if (preservePosition) root.scrollBy(0, anchor.getBoundingClientRect().top - anchorTop);
    }
    // Fail closed: never expose a stale pinned story when the live approval feed fails.
    const items = feed && feed.status === 'ready' && Array.isArray(feed.items) ? feed.items : [];
    const selected = selectPinned(items, 4);
    if (!hub || !selected.length) {
      panel.hidden = true;
      slot.replaceChildren();
      restorePosition();
      return;
    }
    const cards = selected.map(item => {
      const entry = editorial.find(entry => item.id === 'promotion-' + entry.id);
      const card = hub.createCard({ ...item, summary: entry.summary || item.summary }, 'h3');
      card.classList.add('featured-story-card');
      const ribbon = document.createElement('span');
      ribbon.className = 'featured-story-ribbon';
      ribbon.textContent = '기획기사';
      card.querySelector('.card-body')?.prepend(ribbon);
      return card;
    });
    panel.dataset.featuredCount = String(selected.length);
    slot.replaceChildren(...cards);
    panel.hidden = false;
    restorePosition();
  }

  document.addEventListener('taejang-live-promotion-ready', renderArchiveFeatures);
  renderArchiveFeatures();
}(typeof window !== 'undefined' ? window : globalThis));
