(function () {
  'use strict';

  const content = window.TAEJANG_CONTENT;
  const sourceLabels = {
    homepage: '홈페이지',
    'naver-blog': 'NAVER BLOG',
    instagram: 'INSTAGRAM',
    youtube: 'YOUTUBE',
    x: 'X',
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

  function createPhotoSlot(item, slotNumber) {
    const slot = document.createElement('div');
    const label = String(slotNumber).padStart(2, '0');
    slot.className = 'photo-slot photo-slot--4-3';
    slot.dataset.photoSlot = label;
    slot.setAttribute('role', 'img');
    slot.setAttribute('aria-label', `PHOTO ${label} 최근 활동 대표사진: ${item.title}, 권장 비율 4:3`);
    appendText(slot, 'span', `PHOTO ${label}`, 'photo-slot-number');
    appendText(slot, 'strong', '최근 활동 대표사진');
    appendText(slot, 'span', item.title);
    appendText(slot, 'small', '권장 비율 4:3');
    return slot;
  }

  function createActivityCard(item, index) {
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

    const media = document.createElement('div');
    media.className = 'card-media recent-activity-media';
    media.append(createPhotoSlot(item, 9 + index));
    link.append(media);

    const body = document.createElement('div');
    body.className = 'card-body recent-activity-body';
    appendText(body, 'span', item.category || sourceLabels[item.source] || '활동', 'tag tag--subtle');

    const date = document.createElement('time');
    date.className = 'card-date';
    date.dateTime = item.publishedAt || '';
    date.textContent = (item.publishedAt || '').replaceAll('-', '.');
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

    if (!content || !Array.isArray(content.hub)) {
      console.warn('최근 활동 콘텐츠 데이터를 사용할 수 없습니다.');
      hideRecentActivities();
      return;
    }

    try {
      const items = stableLatestFirst(content.hub.filter((item) => item && item.status === 'published'));
      containers.forEach((container) => {
        const count = Number.parseInt(container.dataset.homePreviewCount, 10) || 3;
        const visibleItems = items.slice(0, Math.min(count, 3));
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
