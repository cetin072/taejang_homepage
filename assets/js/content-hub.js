(function () {
  'use strict';

  const content = window.TAEJANG_CONTENT;
  const baseItems = Array.isArray(content?.hub) ? content.hub : [];
  const sourceLabels = {
    homepage: '홈페이지',
    'naver-blog': 'NAVER BLOG',
    instagram: 'INSTAGRAM',
    youtube: 'YOUTUBE',
    x: 'X',
    press: '언론보도'
  };
  const desktopBatchSize = 12;
  const mobileBatchSize = 6;

  function isUsableItem(item) {
    if (!item || item.status !== 'published') return false;
    if (item.type === 'external') {
      return typeof item.externalUrl === 'string'
        && /^https?:\/\//.test(item.externalUrl)
        && !/example\.com/i.test(item.externalUrl);
    }
    return typeof item.detailUrl === 'string' && item.detailUrl.trim().length > 0;
  }

  function dateValue(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 0;
    return Date.parse(`${value}T00:00:00Z`) || 0;
  }

  function orderedItems() {
    return baseItems
      .filter(isUsableItem)
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
      image.decoding = 'async';
      media.append(image);
    } else {
      const slot = document.createElement('div');
      slot.className = 'content-photo-slot';
      slot.setAttribute('role', 'img');
      slot.setAttribute('aria-label', `CONTENT PHOTO: ${item.title}`);
      appendText(slot, 'span', 'CONTENT PHOTO', 'content-photo-slot-label');
      appendText(slot, 'strong', item.title);
      media.append(slot);
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
      link.setAttribute('aria-label', `${item.title} 자세히 보기`);
    }
    link.append(createMedia(item));

    const body = document.createElement('div');
    body.className = 'card-body';
    const meta = document.createElement('div');
    meta.className = 'content-card-meta';
    appendText(meta, 'span', sourceLabels[item.source] || item.source || '홈페이지', `source-badge source-badge--${item.source || 'homepage'}`);
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

  function filterValues(items, key) {
    return ['all', ...new Set(items.map((item) => item[key]).filter(Boolean))];
  }

  function createFilters(container, values, label, stateKey, onChange) {
    const group = container.closest('.content-filter-group');
    if (values.length <= 2) {
      if (group) group.hidden = true;
      container.replaceChildren();
      return;
    }

    if (group) group.hidden = false;
    container.replaceChildren(...values.map((value, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `filter-btn ${index === 0 ? 'active' : ''}`;
      button.dataset[stateKey] = value;
      button.setAttribute('aria-pressed', String(index === 0));
      button.textContent = value === 'all' ? '전체' : (stateKey === 'source' ? sourceLabels[value] || value : value);
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

  function createDateControls(list, items, onChange) {
    const years = [...new Set(items.map((item) => item.publishedAt.slice(0, 4)))].sort().reverse();
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
    return { controls, resultCount };
  }

  function createEmptyState(title, text) {
    const panel = document.createElement('div');
    panel.className = 'listing-empty listing-empty--panel';
    panel.setAttribute('role', 'status');
    appendText(panel, 'strong', title);
    appendText(panel, 'p', text);
    const link = document.createElement('a');
    link.className = 'btn line';
    link.href = 'activities.html';
    link.textContent = '태장의 활동 보기';
    panel.append(link);
    return panel;
  }

  function setupArchive() {
    const list = document.querySelector('[data-hub-list]');
    const sourceContainer = document.querySelector('[data-hub-source-filters]');
    const categoryContainer = document.querySelector('[data-hub-category-filters]');
    if (!list || !sourceContainer || !categoryContainer) return;

    const allItems = orderedItems();
    let source = 'all';
    let category = 'all';
    let year = 'all';
    let month = 'all';
    let visibleCount = window.matchMedia('(max-width: 620px)').matches ? mobileBatchSize : desktopBatchSize;

    if (!allItems.length) {
      sourceContainer.closest('.content-hub-filters')?.setAttribute('hidden', '');
      list.replaceChildren(createEmptyState('공개할 콘텐츠를 확인하고 있습니다', '공식 홈페이지 글과 실제 원문 링크가 확인된 콘텐츠부터 차례로 등록하겠습니다.'));
      return;
    }

    const loadMoreWrap = document.createElement('div');
    loadMoreWrap.className = 'archive-load-more-wrap';
    const loadMore = document.createElement('button');
    loadMore.type = 'button';
    loadMore.className = 'archive-load-more';
    loadMore.textContent = '더 보기';
    loadMoreWrap.append(loadMore);
    list.after(loadMoreWrap);

    const dateControls = createDateControls(list, allItems, (nextYear, nextMonth) => {
      year = nextYear;
      month = nextMonth;
      resetAndRender();
    });

    function filteredItems() {
      return allItems.filter((item) => {
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
      if (visible.length) {
        list.replaceChildren(...visible.map((item) => createCard(item, 'h2')));
      } else {
        list.replaceChildren(createEmptyState('선택한 조건의 콘텐츠가 없습니다', '다른 출처·주제·기간을 선택해 주세요.'));
      }
      dateControls.resultCount.textContent = visible.length < filtered.length
        ? `총 ${filtered.length}건 중 ${visible.length}건 표시`
        : `총 ${filtered.length}건`;
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

    createFilters(sourceContainer, filterValues(allItems, 'source'), '출처별 콘텐츠 필터', 'source', (value) => {
      source = value;
      resetAndRender();
    });
    createFilters(categoryContainer, filterValues(allItems, 'category'), '주제별 콘텐츠 필터', 'category', (value) => {
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

  setupArchive();
  setupHomePreviews();
}());