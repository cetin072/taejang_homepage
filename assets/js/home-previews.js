(function () {
  'use strict';

  const content = window.TAEJANG_CONTENT;
  if (!content) return;

  const pageByType = {
    workplace: 'workplace.html',
    activities: 'activities.html'
  };

  function stableLatestFirst(items) {
    return items
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        const leftDate = Date.parse((left.item.date || '').replaceAll('.', '-'));
        const rightDate = Date.parse((right.item.date || '').replaceAll('.', '-'));
        const safeLeft = Number.isNaN(leftDate) ? Number.NEGATIVE_INFINITY : leftDate;
        const safeRight = Number.isNaN(rightDate) ? Number.NEGATIVE_INFINITY : rightDate;
        return safeRight - safeLeft || left.index - right.index;
      })
      .map(entry => entry.item);
  }

  function appendText(parent, tagName, text, className) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
  }

  function createPhotoGuide(item) {
    const guide = item.listingPhoto || item.photo;
    const media = document.createElement('div');
    media.className = 'card-media dev-photo-placeholder';
    media.setAttribute('role', 'note');
    media.setAttribute('aria-label', `개발 검토용 ${guide.title} 사진자료 필요 안내`);
    appendText(media, 'span', '개발 검토용 · 사진자료 필요', 'dev-review-badge');
    appendText(media, 'strong', guide.title);
    const filename = appendText(media, 'p', '');
    const code = appendText(filename, 'code', guide.filename);
    code.insertAdjacentText('afterend', ` · ${guide.orientation}`);
    if (guide.note) appendText(media, 'p', guide.note);
    return media;
  }

  function createNoticeMedia(item) {
    const media = document.createElement('div');
    media.className = 'card-media card-media--notice';
    appendText(media, 'span', item.category, 'tag');
    appendText(media, 'span', '공식 소식', 'notice-media-label');
    return media;
  }

  function createImageMedia(item) {
    const media = document.createElement('div');
    media.className = 'card-media';
    const image = document.createElement('img');
    image.src = item.thumb;
    image.alt = item.alt && item.alt.thumb ? item.alt.thumb : '';
    media.append(image);
    return media;
  }

  function createCard(item, type) {
    const article = document.createElement('article');
    article.className = 'card';
    const link = document.createElement('a');
    link.className = 'card-link';
    link.href = `${pageByType[type]}?id=${encodeURIComponent(item.id)}`;

    if (item.thumb) link.append(createImageMedia(item));
    else if (item.listingPhoto || item.photo) link.append(createPhotoGuide(item));
    else link.append(createNoticeMedia(item));

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

  document.querySelectorAll('[data-home-preview]').forEach(container => {
    const type = container.dataset.homePreview;
    const count = Number.parseInt(container.dataset.homePreviewCount, 10) || 3;
    if (!pageByType[type] || !Array.isArray(content[type])) return;

    const items = stableLatestFirst(content[type]).slice(0, count);
    if (!items.length) return;
    container.replaceChildren(...items.map(item => createCard(item, type)));
  });
}());
