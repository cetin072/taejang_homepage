(function () {
  'use strict';

  const content = window.TAEJANG_CONTENT;
  if (!content) return;

  const pageByType = {
    workplace: 'workplace.html',
    activities: 'activities.html'
  };
  const sourceLabels = {
    homepage: '홈페이지',
    'naver-blog': 'NAVER BLOG',
    instagram: 'INSTAGRAM',
    youtube: 'YOUTUBE',
    press: '언론보도'
  };

  function stableLatestFirst(items) {
    return items
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        const leftDate = Date.parse((left.item.publishedAt || left.item.date || '').replaceAll('.', '-'));
        const rightDate = Date.parse((right.item.publishedAt || right.item.date || '').replaceAll('.', '-'));
        const safeLeft = Number.isNaN(leftDate) ? Number.NEGATIVE_INFINITY : leftDate;
        const safeRight = Number.isNaN(rightDate) ? Number.NEGATIVE_INFINITY : rightDate;
        return Number(right.item.featured) - Number(left.item.featured)
          || safeRight - safeLeft
          || left.index - right.index;
      })
      .map((entry) => entry.item);
  }

  function appendText(parent, tagName, text, className) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
  }

  function createLegacyMedia(item) {
    if (item.thumb) {
      const media = document.createElement('div');
      media.className = 'card-media';
      const image = document.createElement('img');
      image.src = item.thumb;
      image.alt = item.alt?.thumb || '';
      image.loading = 'lazy';
      media.append(image);
      return media;
    }

    const media = document.createElement('div');
    media.className = 'card-media card-media--notice';
    appendText(media, 'span', item.category, 'tag');
    appendText(media, 'span', '공식 소식', 'notice-media-label');
    return media;
  }

  function createLegacyCard(item, type) {
    const article = document.createElement('article');
    article.className = 'card';
    const link = document.createElement('a');
    link.className = 'card-link';
    link.href = `${pageByType[type]}?id=${encodeURIComponent(item.id)}`;
    link.append(createLegacyMedia(item));

    const body = document.createElement('div');
    body.className = 'card-body';
    appendText(body, 'span', item.category, 'tag tag--subtle');
    appendText(body, 'div', item.date, 'card-date');
    appendText(body, 'h3', item.title);
    appendText(body, 'p', item.summary);
    appendText(body, 'span', '글 읽기 →', 'text-link');
    link.append(body);
    article.append(link);
    return article;
  }

  function createHubCard(item) {
    const article = document.createElement('article');
    article.className = 'card card--hub';
    const link = document.createElement('a');
    link.className = 'card-link';
    const external = item.type === 'external';

    link.href = external ? item.externalUrl : item.detailUrl;
    if (external) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', `${item.externalLabel}: ${item.title} (새 탭에서 열림)`);
    }

    const media = document.createElement('div');
    media.className = 'card-media card-media--hub';
    if (item.thumbnail) {
      const image = document.createElement('img');
      image.src = item.thumbnail;
      image.alt = item.thumbnailAlt || `${item.title} 썸네일`;
      image.loading = 'lazy';
      media.append(image);
    } else {
      appendText(media, 'span', sourceLabels[item.source] || item.source, 'notice-media-label');
    }
    link.append(media);

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
    appendText(body, 'h3', item.title);
    appendText(body, 'p', item.summary);
    appendText(body, 'span', external ? `${item.externalLabel} ↗` : '자세히 보기', 'text-link');
    link.append(body);
    article.append(link);
    return article;
  }

  document.querySelectorAll('[data-home-preview]').forEach((container) => {
    const type = container.dataset.homePreview;
    const count = Number.parseInt(container.dataset.homePreviewCount, 10) || 3;

    if (type === 'hub' && Array.isArray(content.hub)) {
      const items = stableLatestFirst(content.hub.filter((item) => item.status === 'published')).slice(0, count);
      if (items.length) container.replaceChildren(...items.map(createHubCard));
      return;
    }

    if (!pageByType[type] || !Array.isArray(content[type])) return;
    const items = stableLatestFirst(content[type]).slice(0, count);
    if (items.length) container.replaceChildren(...items.map((item) => createLegacyCard(item, type)));
  });
}());
