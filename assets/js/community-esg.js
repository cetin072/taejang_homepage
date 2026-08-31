(function () {
  'use strict';

  const list = document.querySelector('[data-community-esg-records]');
  const count = document.querySelector('[data-community-esg-count]');
  if (!list) return;

  const activities = Array.isArray(window.TAEJANG_CONTENT?.activities)
    ? window.TAEJANG_CONTENT.activities
    : [];
  const records = activities
    .filter((activity) => activity?.status === 'published' && activity.series === 'community-esg')
    .map((activity, index) => ({ activity, index }))
    .sort((left, right) => Date.parse(`${right.activity.date.replaceAll('.', '-')}T00:00:00Z`)
      - Date.parse(`${left.activity.date.replaceAll('.', '-')}T00:00:00Z`) || left.index - right.index);

  if (count) count.textContent = `현재 공개된 활동 ${records.length}건`;
  if (!records.length) {
    list.hidden = true;
    return;
  }

  records.forEach(({ activity }) => {
    const article = document.createElement('article');
    article.className = 'community-esg-record';
    const link = document.createElement('a');
    link.href = `activities.html?id=${encodeURIComponent(activity.id)}`;
    link.setAttribute('aria-label', `${activity.title} 자세히 보기`);

    const media = document.createElement('div');
    media.className = 'community-esg-record-media';
    const imageSource = activity.thumbnail || activity.hero || activity.thumb || '';
    if (imageSource) {
      const image = document.createElement('img');
      image.src = imageSource;
      image.alt = activity.thumbnailAlt || activity.alt?.hero || `${activity.title} 대표사진`;
      image.loading = 'lazy';
      image.decoding = 'async';
      if (activity.thumbnailObjectPosition) image.style.objectPosition = activity.thumbnailObjectPosition;
      media.append(image);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'community-esg-record-placeholder';
      placeholder.setAttribute('role', 'img');
      placeholder.setAttribute('aria-label', `${activity.title} 대표사진 준비 중`);
      const label = document.createElement('span');
      label.textContent = 'ACTIVITY RECORD';
      const title = document.createElement('strong');
      title.textContent = activity.title;
      placeholder.append(label, title);
      media.append(placeholder);
    }

    const body = document.createElement('div');
    body.className = 'community-esg-record-body';
    const meta = document.createElement('div');
    meta.className = 'community-esg-record-meta';
    const tag = document.createElement('span');
    tag.textContent = activity.category;
    const time = document.createElement('time');
    time.dateTime = activity.date.replaceAll('.', '-');
    time.textContent = activity.date;
    meta.append(tag, time);
    const heading = document.createElement('h3');
    heading.textContent = activity.title;
    const summary = document.createElement('p');
    summary.textContent = activity.summary;
    const more = document.createElement('span');
    more.className = 'text-link';
    more.textContent = '자세히 보기 →';
    body.append(meta, heading, summary, more);
    link.append(media, body);
    article.append(link);
    list.append(article);
  });
}());
