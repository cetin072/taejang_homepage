(function () {
  'use strict';

  const content = window.TAEJANG_CONTENT;
  const items = Array.isArray(content?.hub) ? content.hub : [];
  const sourceLabels = {
    homepage: '홈페이지',
    'naver-blog': 'NAVER BLOG',
    instagram: 'INSTAGRAM',
    youtube: 'YOUTUBE',
    press: '언론보도'
  };
  const sourceFilters = ['all', 'homepage', 'naver-blog', 'instagram', 'youtube', 'press'];
  const categoryFilters = ['all', '회사소식', '장애인 일자리', '교육·행사', 'ESG·사회공헌', '농업·현장', '채용', '언론보도', '영상'];

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

  function createFilters(container, values, label, stateKey, render) {
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
        render(value);
      });
      return button;
    }));
    container.setAttribute('aria-label', label);
  }

  function setupArchive() {
    const list = document.querySelector('[data-hub-list]');
    const sourceContainer = document.querySelector('[data-hub-source-filters]');
    const categoryContainer = document.querySelector('[data-hub-category-filters]');
    if (!list || !sourceContainer || !categoryContainer) return;

    let source = 'all';
    let category = 'all';

    function render() {
      const filtered = orderedItems().filter((item) => (
        (source === 'all' || item.source === source)
        && (category === 'all' || item.category === category)
      ));
      list.replaceChildren(...filtered.map((item) => createCard(item, 'h2')));
      if (!filtered.length) {
        const empty = document.createElement('p');
        empty.className = 'listing-empty';
        empty.textContent = '선택한 조건의 콘텐츠가 없습니다.';
        list.append(empty);
      }
    }

    createFilters(sourceContainer, sourceFilters, '출처별 콘텐츠 필터', 'source', (value) => {
      source = value;
      render();
    });
    createFilters(categoryContainer, categoryFilters, '주제별 콘텐츠 필터', 'category', (value) => {
      category = value;
      render();
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
