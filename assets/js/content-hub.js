(function () {
  'use strict';

  const content = window.TAEJANG_CONTENT;
  const baseItems = Array.isArray(content?.hub) ? content.hub : [];
  const sampleXItem = {
    id: 'external-x-field-note',
    type: 'external',
    source: 'x',
    category: '회사소식',
    title: '태장 현장의 짧은 소식',
    summary: '태장의 현장 소식과 간단한 안내를 X 원문에서 확인합니다.',
    thumbnail: 'images/coaching.jpg',
    publishedAt: '2026-07-15',
    featured: false,
    status: 'published',
    externalUrl: 'https://example.com/taejang-x-field-note',
    externalLabel: 'X에서 보기',
    openInNewTab: true
  };
  const items = baseItems.some((item) => item.source === 'x')
    ? baseItems
    : [...baseItems, sampleXItem];

  const sourceLabels = {
    homepage: '홈페이지',
    'naver-blog': 'NAVER BLOG',
    instagram: 'INSTAGRAM',
    youtube: 'YOUTUBE',
    x: 'X',
    press: '언론보도'
  };
  const sourceFilters = ['all', 'homepage', 'naver-blog', 'instagram', 'youtube', 'x', 'press'];
  const categoryFilters = ['all', '회사소식', '장애인 일자리', '교육·행사', 'ESG·사회공헌', '농업·현장', '채용', '언론보도', '영상'];
  const desktopBatchSize = 18;
  const mobileBatchSize = 10;

  function injectEnhancementStyles() {
    if (document.getElementById('content-hub-enhancement-styles')) return;
    const style = document.createElement('style');
    style.id = 'content-hub-enhancement-styles';
    style.textContent = `
      .source-badge--homepage,.card--hub[data-source="homepage"] .text-link{color:#1b4332;border-color:#2d6a4f}
      .source-badge--homepage{background:#eaf3ee}
      .source-badge--naver-blog,.card--hub[data-source="naver-blog"] .text-link{color:#087f3d;border-color:#03a94d}
      .source-badge--naver-blog{background:#eefaf3}
      .source-badge--instagram,.card--hub[data-source="instagram"] .text-link{color:#a12a72;border-color:#c13584}
      .source-badge--instagram{background:#fff0f7}
      .source-badge--youtube,.card--hub[data-source="youtube"] .text-link{color:#c1121f;border-color:#ff0000}
      .source-badge--youtube{background:#fff1f1}
      .source-badge--x,.card--hub[data-source="x"] .text-link{color:#111;border-color:#111}
      .source-badge--x{background:#f2f2f2}
      .source-badge--press,.card--hub[data-source="press"] .text-link{color:#254f77;border-color:#3b6f9f}
      .source-badge--press{background:#eef4f9}
      .card--hub .text-link{border-bottom:1px solid currentColor;padding-bottom:2px}
      .content-filter-buttons .filter-btn[data-source="naver-blog"].active{background:#087f3d;border-color:#087f3d;color:#fff}
      .content-filter-buttons .filter-btn[data-source="instagram"].active{background:#a12a72;border-color:#a12a72;color:#fff}
      .content-filter-buttons .filter-btn[data-source="youtube"].active{background:#c1121f;border-color:#c1121f;color:#fff}
      .content-filter-buttons .filter-btn[data-source="x"].active{background:#111;border-color:#111;color:#fff}
      .content-filter-buttons .filter-btn[data-source="press"].active{background:#254f77;border-color:#254f77;color:#fff}
      .content-filter-buttons .filter-btn[data-source="homepage"].active{background:#2d6a4f;border-color:#2d6a4f;color:#fff}
      .archive-controls{display:flex;flex-wrap:wrap;align-items:end;gap:12px;margin:0 0 24px;padding:16px;border:1px solid var(--line);background:#fbfaf7}
      .archive-control{display:grid;gap:6px;min-width:150px}
      .archive-control label{font-size:12px;font-weight:800;color:var(--green-deep)}
      .archive-control select{min-height:42px;padding:8px 34px 8px 11px;border:1px solid var(--line);background:#fff;color:var(--ink);font:inherit}
      .archive-result-count{margin-left:auto;color:var(--ink-soft);font-size:13px}
      .archive-load-more-wrap{display:flex;justify-content:center;margin-top:28px}
      .archive-load-more{min-width:180px;min-height:46px;padding:10px 22px;border:1px solid var(--green);background:#fff;color:var(--green);font-weight:800}
      .archive-load-more:hover,.archive-load-more:focus-visible{background:var(--green);color:#fff}
      .article-list[data-hub-list]{grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
      .article-list[data-hub-list] .card-media--hub{aspect-ratio:16/10}
      .article-list[data-hub-list] .card--hub .card-body{min-height:205px;padding:18px}
      .article-list[data-hub-list] .card--hub p{-webkit-line-clamp:2;min-height:3.2em}
      @media (min-width:1280px){.article-list[data-hub-list]{grid-template-columns:repeat(4,minmax(0,1fr))}}
      @media (max-width:900px){.article-list[data-hub-list]{grid-template-columns:repeat(2,minmax(0,1fr))}.archive-result-count{width:100%;margin-left:0}}
      @media (max-width:620px){.article-list[data-hub-list]{grid-template-columns:1fr;gap:16px}.archive-controls{display:grid}.archive-control{min-width:0}.archive-result-count{width:auto}.archive-load-more{width:100%}}
    `;
    document.head.append(style);
  }

  function dateValue(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 0;
    return Date.parse(`${value}T00:00:00Z`) || 0;
  }

  function orderedItems() {
    return items
      .filter((item) => item.status === 'published')
      .slice()
      .sort((left, right) => Number(right.featured) - Number(left.featured)
        || dateValue(right.publishedAt) - dateValue(left.publishedAt));
  }

  function appendText(parent, tagName, text, className) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
  }

  function createMedia(item) {
    const media = document.createElement('div');
    media.className = 'card-media card-media--hub';
    if (item.thumbnail) {
      const image = document.createElement('img');
      image.src = item.thumbnail;
      image.alt = item.thumbnailAlt || `${item.title} 썸네일`;
      image.loading = 'lazy';
      media.append(image);
    } else {
      appendText(media, 'span', item.type === 'external' ? sourceLabels[item.source] : '공식 소식', 'notice-media-label');
    }
    return media;
  }

  function linkText(item) {
    if (item.type === 'internal') return '자세히 보기';
    return item.externalLabel || '원문 보기';
  }

  function createCard(item, headingTag) {
    const article = document.createElement('article');
    article.className = 'card card--hub';
    article.dataset.source = item.source;
    article.dataset.category = item.category;

    const link = document.createElement('a');
    link.className = 'card-link';
    if (item.type === 'external') {
      link.href = item.externalUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', `${item.externalLabel || '외부 원문 보기'}: ${item.title} (새 탭에서 열림)`);
    } else {
      link.href = item.detailUrl;
    }
    link.append(createMedia(item));

    const body = document.createElement('div');
    body.className = 'card-body';
    const meta = document.createElement('div');
    meta.className = 'content-card-meta';
    appendText(meta, 'span', sourceLabels[item.source] || item.source, `source-badge source-badge--${item.source}`);
    appendText(meta, 'span', item.category, 'tag tag--subtle');
    body.append(meta);

    const date = document.createElement('time');
    date.className = 'card-date';
    date.dateTime = item.publishedAt;
    date.textContent = item.publishedAt.replaceAll('-', '.');
    body.append(date);
    appendText(body, headingTag, item.title);
    appendText(body, 'p', item.summary);
    appendText(body, 'span', item.type === 'external' ? `${linkText(item)} ↗` : linkText(item), 'text-link');
    link.append(body);
    article.append(link);
    return article;
  }

  function createFilters(container, values, label, stateKey, onChange) {
    container.replaceChildren(...values.map((value, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `filter-btn ${index === 0 ? 'active' : ''}`;
      button.dataset[stateKey] = value;
      button.setAttribute('aria-pressed', String(index === 0));
      button.textContent = value === 'all' ? '전체' : (stateKey === 'source' ? sourceLabels[value] : value);
      button.addEventListener('click', () => {
        container.querySelectorAll('button').forEach((item) => {
          const selected = item === button;
          item.classList.toggle('active', selected);
          item.setAttribute('aria-pressed', String(selected));
        });
        onChange(value);
      });
      return button;
    }));
    container.setAttribute('aria-label', label);
  }

  function createDateControls(list, onChange) {
    const years = [...new Set(orderedItems().map((item) => item.publishedAt.slice(0, 4)))].sort().reverse();
    const controls = document.createElement('div');
    controls.className = 'archive-controls';

    const yearWrap = document.createElement('div');
    yearWrap.className = 'archive-control';
    const yearLabel = document.createElement('label');
    yearLabel.htmlFor = 'archive-year';
    yearLabel.textContent = '연도';
    const yearSelect = document.createElement('select');
    yearSelect.id = 'archive-year';
    yearSelect.innerHTML = '<option value="all">전체 연도</option>' + years.map((year) => `<option value="${year}">${year}년</option>`).join('');
    yearWrap.append(yearLabel, yearSelect);

    const monthWrap = document.createElement('div');
    monthWrap.className = 'archive-control';
    const monthLabel = document.createElement('label');
    monthLabel.htmlFor = 'archive-month';
    monthLabel.textContent = '월';
    const monthSelect = document.createElement('select');
    monthSelect.id = 'archive-month';
    monthSelect.innerHTML = '<option value="all">전체 월</option>' + Array.from({ length: 12 }, (_, index) => index + 1)
      .map((month) => `<option value="${String(month).padStart(2, '0')}">${month}월</option>`).join('');
    monthWrap.append(monthLabel, monthSelect);

    const resultCount = document.createElement('div');
    resultCount.className = 'archive-result-count';
    resultCount.setAttribute('aria-live', 'polite');
    controls.append(yearWrap, monthWrap, resultCount);
    list.before(controls);

    function emit() {
      onChange(yearSelect.value, monthSelect.value, resultCount);
    }
    yearSelect.addEventListener('change', emit);
    monthSelect.addEventListener('change', emit);
    return { resultCount };
  }

  function setupArchive() {
    const list = document.querySelector('[data-hub-list]');
    const sourceContainer = document.querySelector('[data-hub-source-filters]');
    const categoryContainer = document.querySelector('[data-hub-category-filters]');
    if (!list || !sourceContainer || !categoryContainer) return;

    let source = 'all';
    let category = 'all';
    let year = 'all';
    let month = 'all';
    let visibleCount = window.matchMedia('(max-width: 620px)').matches ? mobileBatchSize : desktopBatchSize;

    const loadMoreWrap = document.createElement('div');
    loadMoreWrap.className = 'archive-load-more-wrap';
    const loadMore = document.createElement('button');
    loadMore.type = 'button';
    loadMore.className = 'archive-load-more';
    loadMore.textContent = '더 보기';
    loadMoreWrap.append(loadMore);
    list.after(loadMoreWrap);

    const dateControls = createDateControls(list, (nextYear, nextMonth) => {
      year = nextYear;
      month = nextMonth;
      resetAndRender();
    });

    function filteredItems() {
      return orderedItems().filter((item) => {
        const [itemYear, itemMonth] = item.publishedAt.split('-');
        return (source === 'all' || item.source === source)
          && (category === 'all' || item.category === category)
          && (year === 'all' || itemYear === year)
          && (month === 'all' || itemMonth === month);
      });
    }

    function render() {
      const filtered = filteredItems();
      const visible = filtered.slice(0, visibleCount);
      list.replaceChildren(...visible.map((item) => createCard(item, 'h2')));
      dateControls.resultCount.textContent = `총 ${filtered.length}건 중 ${visible.length}건 표시`;
      if (!filtered.length) {
        const empty = document.createElement('p');
        empty.className = 'listing-empty';
        empty.setAttribute('role', 'status');
        empty.textContent = '선택한 조건의 콘텐츠가 없습니다.';
        list.append(empty);
      }
      loadMoreWrap.hidden = visible.length >= filtered.length || filtered.length === 0;
    }

    function resetAndRender() {
      visibleCount = window.matchMedia('(max-width: 620px)').matches ? mobileBatchSize : desktopBatchSize;
      render();
    }

    loadMore.addEventListener('click', () => {
      visibleCount += window.matchMedia('(max-width: 620px)').matches ? mobileBatchSize : desktopBatchSize;
      render();
      loadMore.focus();
    });

    createFilters(sourceContainer, sourceFilters, '출처별 콘텐츠 필터', 'source', (value) => {
      source = value;
      resetAndRender();
    });
    createFilters(categoryContainer, categoryFilters, '주제별 콘텐츠 필터', 'category', (value) => {
      category = value;
      resetAndRender();
    });
    render();
  }

  function setupHomePreviews() {
    document.querySelectorAll('[data-home-preview="hub"]').forEach((container) => {
      const count = Number.parseInt(container.dataset.homePreviewCount, 10) || 6;
      container.replaceChildren(...orderedItems().slice(0, count).map((item) => createCard(item, 'h3')));
    });
  }

  injectEnhancementStyles();
  setupArchive();
  setupHomePreviews();
}());
