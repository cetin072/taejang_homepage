(function () {
  'use strict';

  const content = window.TAEJANG_CONTENT;
  const contentHub = window.TAEJANG_CONTENT_HUB;

  function appendText(parent, tagName, text, className) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
  }

  function createActivityCard(item) {
    const article = document.createElement('article');
    article.className = 'card recent-activity-card';
    const link = document.createElement('a');
    link.className = 'card-link';
    const external = item.type === 'external';

    link.href = external ? item.externalUrl : item.detailUrl;
    if (external) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', `${item.externalLabel || '원문 보기'}: ${item.title} (새 탭에서 열림)`);
    }

    link.append(contentHub.createMedia(item, 'card-media recent-activity-media'));

    const body = document.createElement('div');
    body.className = 'card-body recent-activity-body';
    const meta = document.createElement('div');
    meta.className = 'content-card-meta';
    appendText(meta, 'span', contentHub.sourceLabel(item), `source-badge source-badge--${item.source || 'homepage'}`);
    appendText(meta, 'span', item.category || '활동', 'tag tag--subtle');
    body.append(meta);

    const date = document.createElement('time');
    date.className = 'card-date';
    date.dateTime = item.publishedAt || '';
    date.textContent = contentHub.formatPublishedDate(item.publishedAt);
    body.append(date);
    appendText(body, 'h3', item.title);
    link.append(body);
    article.append(link);
    return article;
  }

  function hideRecentActivities() {
    document.querySelectorAll('[data-recent-activities]').forEach((section) => {
      section.hidden = true;
    });
  }

  function renderRecentActivities() {
    const containers = document.querySelectorAll('[data-home-preview="hub"]');
    if (!containers.length) return;

    if (!content || !Array.isArray(content.hub) || !contentHub) {
      console.warn('최근 활동 콘텐츠 데이터를 사용할 수 없습니다.');
      hideRecentActivities();
      return;
    }

    try {
      const items = contentHub.orderedItems();
      containers.forEach((container) => {
        const requestedCount = Number.parseInt(container.dataset.homePreviewCount, 10) || 8;
        const visibleItems = items.slice(0, Math.min(Math.max(requestedCount, 1), 8));
        const section = container.closest('[data-recent-activities]');
        if (!visibleItems.length) {
          if (section) section.hidden = true;
          return;
        }
        container.replaceChildren(...visibleItems.map(createActivityCard));
        if (section) section.hidden = false;
      });
    } catch (error) {
      console.warn('최근 활동을 표시하지 않았습니다.', error);
      hideRecentActivities();
    }
  }

  renderRecentActivities();
}());
