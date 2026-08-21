(function () {
  'use strict';

  const type = document.body.dataset.contentType;
  const rawData = window.TAEJANG_CONTENT?.[type] || [];
  const hubItems = Array.isArray(window.TAEJANG_CONTENT?.hub) ? window.TAEJANG_CONTENT.hub : [];
  const data = rawData.filter((item) => item && item.status !== 'draft');
  const list = document.querySelector('[data-list]');
  const filters = document.querySelector('[data-filters]');
  const listing = document.querySelector('[data-listing]');
  const detail = document.querySelector('[data-detail]');
  const pageHero = document.querySelector('[data-page-hero]');
  const workplaceOverview = document.querySelector('[data-workplace-overview]');
  const workplaceRoles = document.querySelector('[data-workplace-roles]');
  const workplaceProcess = document.querySelector('[data-workplace-process]');
  const detailTarget = detail?.querySelector('.container') || detail;
  const pageConfig = {
    workplace: {
      page: 'workplace.html',
      backLabel: '← 일터 이야기 목록으로',
      relatedTitle: '다른 일터 이야기',
      emptyTitle: '일터 이야기를 준비하고 있습니다',
      emptyText: '사진과 내용을 확인한 뒤 공개할 일터 이야기를 차례로 등록하겠습니다.'
    },
    activities: {
      page: 'activities.html',
      backLabel: '← 태장의 활동 목록으로',
      relatedTitle: '다른 태장 소식',
      emptyTitle: '공개할 활동 소식을 확인하고 있습니다',
      emptyText: '사실관계와 사진 공개 여부를 확인한 소식부터 차례로 등록하겠습니다.'
    }
  };
  const config = pageConfig[type];

  if (!list || !listing || !detail || !detailTarget || !config) return;

  function dateValue(value) {
    if (typeof value !== 'string' || !/^\d{4}\.\d{2}(?:\.\d{2})?$/.test(value)) return null;
    const [year, month, providedDay] = value.split('.').map(Number);
    const day = providedDay || 1;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date.getTime();
  }

  function dateTimeValue(value) {
    return typeof value === 'string' ? value.replaceAll('.', '-') : '';
  }

  function latestFirst(items) {
    return items
      .map((item, index) => ({ item, index, timestamp: dateValue(item.date) }))
      .sort((left, right) => {
        if (left.timestamp === null && right.timestamp === null) return left.index - right.index;
        if (left.timestamp === null) return 1;
        if (right.timestamp === null) return -1;
        return right.timestamp - left.timestamp || left.index - right.index;
      })
      .map((entry) => entry.item);
  }

  const orderedData = latestFirst(data);

  function hubItemFor(item) {
    return hubItems.find((candidate) => candidate?.type === 'internal'
      && candidate.detailUrl === `${config.page}?id=${item.id}`);
  }

  function representativeMedia(item) {
    const hubItem = hubItemFor(item);
    const source = hubItem?.thumbnail || item.thumbnail || item.hero || item.thumb || '';
    const alt = hubItem?.thumbnailAlt || item.thumbnailAlt || item.alt?.hero || item.alt?.thumb || `${item.title} 대표사진`;
    const objectPosition = hubItem?.thumbnailObjectPosition || item.thumbnailObjectPosition || 'center';
    const detailMode = hubItem?.thumbnailDetail || item.thumbnailDetail || 'cover';
    return { source, alt, objectPosition, detailMode };
  }

  function contentPhoto(item, variant = 'card') {
    const title = item.photo?.title || item.listingPhoto?.title || item.title;
    return `<div class="content-photo-slot content-photo-slot--${variant}" role="img" aria-label="CONTENT PHOTO: ${title}">
      <span class="content-photo-slot-label">CONTENT PHOTO</span>
      <strong>${title}</strong>
    </div>`;
  }

  function cardMedia(item) {
    const media = representativeMedia(item);
    if (media.source) {
      return `<div class="card-media"><img src="${media.source}" alt="${media.alt}" style="object-position:${media.objectPosition}" loading="lazy" decoding="async"></div>`;
    }
    return `<div class="card-media">${contentPhoto(item, 'card')}</div>`;
  }

  function card(item) {
    return `<article class="card" data-category="${item.category}">
      <a class="card-link" href="${config.page}?id=${encodeURIComponent(item.id)}" aria-label="${item.title} 자세히 보기">
        ${cardMedia(item)}
        <div class="card-body">
          <span class="tag tag--subtle">${item.category}</span>
          <time class="card-date" datetime="${dateTimeValue(item.date)}">${item.date}</time>
          <h2>${item.title}</h2>
          <p>${item.summary}</p>
          <span class="text-link">자세히 보기 →</span>
        </div>
      </a>
    </article>`;
  }

  function emptyState(title, text, resetFilter) {
    const action = resetFilter
      ? '<button class="btn line listing-reset" type="button" data-reset-filter>전체 보기</button>'
      : '<a class="btn line" href="index.html#contact">태장에 문의하기</a>';
    return `<div class="listing-empty listing-empty--panel" role="status">
      <strong>${title}</strong>
      <p>${text}</p>
      ${action}
    </div>`;
  }

  function setFilterState(active) {
    filters?.querySelectorAll('[data-filter]').forEach((button) => {
      const selected = button.dataset.filter === active;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  function render(filter = '전체') {
    if (!orderedData.length) {
      if (filters) filters.hidden = true;
      list.innerHTML = emptyState(config.emptyTitle, config.emptyText, false);
      return;
    }

    const items = orderedData.filter((item) => filter === '전체' || item.category === filter);
    list.innerHTML = items.length
      ? items.map(card).join('')
      : emptyState('선택한 분류의 게시물이 없습니다', '다른 분류를 선택하거나 전체 게시물을 확인해 주세요.', true);
    setFilterState(filter);
  }

  function bodySections(item) {
    if (Array.isArray(item.sections) && item.sections.length) {
      return item.sections
        .map((section) => ({
          heading: typeof section.heading === 'string' ? section.heading.trim() : '',
          paragraphs: Array.isArray(section.paragraphs)
            ? section.paragraphs.filter((text) => typeof text === 'string' && text.trim())
            : []
        }))
        .filter((section) => section.paragraphs.length);
    }

    if (!Array.isArray(item.body)) return [];
    return item.body
      .map((entry, index) => {
        if (typeof entry === 'string') {
          return {
            heading: index === 1 && item.bodyHeading ? item.bodyHeading : '',
            paragraphs: [entry]
          };
        }
        return {
          heading: typeof entry?.heading === 'string' ? entry.heading.trim() : '',
          paragraphs: Array.isArray(entry?.paragraphs)
            ? entry.paragraphs.filter((text) => typeof text === 'string' && text.trim())
            : (typeof entry?.text === 'string' && entry.text.trim() ? [entry.text] : [])
        };
      })
      .filter((section) => section.paragraphs.length);
  }

  function renderBody(item) {
    return bodySections(item).map((section) => {
      const heading = section.heading ? `<h2>${section.heading}</h2>` : '';
      return `${heading}${section.paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('')}`;
    }).join('');
  }

  function relatedItems(item) {
    const otherItems = orderedData.filter((entry) => entry.id !== item.id);
    const sameCategory = otherItems.filter((entry) => entry.category === item.category);
    const otherCategories = otherItems.filter((entry) => entry.category !== item.category);
    const selectedIds = new Set([...sameCategory, ...otherCategories].slice(0, 2).map((entry) => entry.id));
    return orderedData.filter((entry) => selectedIds.has(entry.id));
  }

  function relatedPosts(item) {
    const items = relatedItems(item);
    if (!items.length) return '';
    return `<section class="related-posts" aria-labelledby="related-posts-title">
      <h2 id="related-posts-title">${config.relatedTitle}</h2>
      <div class="related-posts-grid">
        ${items.map((related) => `<a class="related-post" href="${config.page}?id=${encodeURIComponent(related.id)}">
          <span class="related-post-meta"><span class="tag tag--subtle">${related.category}</span><time datetime="${dateTimeValue(related.date)}">${related.date}</time></span>
          <h3>${related.title}</h3>
          <p>${related.summary}</p>
          <span class="text-link">글 보기 →</span>
        </a>`).join('')}
      </div>
    </section>`;
  }

  const categories = ['전체', ...new Set(data.map((item) => item.category).filter(Boolean))];
  if (filters) {
    if (categories.length <= 2) {
      filters.hidden = true;
    } else {
      filters.innerHTML = categories.map((category, index) =>
        `<button class="filter-btn ${index === 0 ? 'active' : ''}" type="button" data-filter="${category}" aria-pressed="${index === 0 ? 'true' : 'false'}">${category}</button>`
      ).join('');
    }

    filters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      render(button.dataset.filter);
    });
  }

  list.addEventListener('click', (event) => {
    const reset = event.target.closest('[data-reset-filter]');
    if (!reset) return;
    render('전체');
    filters?.querySelector('[data-filter="전체"]')?.focus();
  });

  render();

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (!id) return;

  listing.hidden = true;
  detail.hidden = false;
  if (pageHero) pageHero.hidden = true;
  if (type === 'workplace') {
    document.body.classList.add('workplace-detail-mode');
    [workplaceOverview, workplaceRoles, workplaceProcess].forEach((section) => {
      if (section) section.hidden = true;
    });
  }

  const item = data.find((entry) => entry.id === id);
  if (!item) {
    document.title = '글을 찾을 수 없습니다 | 태장';
    detailTarget.innerHTML = `<article class="article article-empty">
      <h1>요청한 글을 찾을 수 없습니다</h1>
      <p>주소가 변경되었거나 공개되지 않은 게시물입니다.</p>
      <a class="btn line" href="${config.page}">${config.backLabel}</a>
    </article>`;
    return;
  }

  document.title = `${item.title} | 태장`;
  const detailRepresentative = representativeMedia(item);
  const detailMedia = detailRepresentative.source
    ? `<figure class="article-representative-media article-representative-media--${detailRepresentative.detailMode}"><img src="${detailRepresentative.source}" alt="${detailRepresentative.alt}" style="object-position:${detailRepresentative.objectPosition}" loading="eager" decoding="async"></figure>`
    : contentPhoto(item, 'detail');
  const gallery = item.gallery?.length
    ? `<div class="article-gallery">${item.gallery.map((src, index) => `<img src="${src}" alt="${item.alt?.gallery?.[index] || item.title}" loading="lazy" decoding="async">`).join('')}</div>`
    : '';

  detailTarget.innerHTML = `<a class="back-link" href="${config.page}">${config.backLabel}</a>
    <article class="article">
      <header class="article-header">
        <div class="article-meta"><span class="tag">${item.category}</span><time datetime="${dateTimeValue(item.date)}">${item.date}</time></div>
        <h1>${item.title}</h1>
        <p class="lead">${item.summary}</p>
      </header>
      <div class="article-body">${detailMedia}${renderBody(item)}${gallery}</div>
      ${relatedPosts(item)}
      <a class="back-link back-link--bottom" href="${config.page}">${config.backLabel}</a>
    </article>`;
}());
