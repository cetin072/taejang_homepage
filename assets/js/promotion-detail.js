(function () {
  'use strict';

  const target = document.querySelector('[data-promotion-detail]');
  if (!target) return;

  const params = new URLSearchParams(window.location.search);
  const id = params.get('id') || '';

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function formatDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value.replaceAll('-', '.')
      : '';
  }

  function unavailable(message) {
    const article = el('article', null, 'article article-empty');
    article.append(el('h1', '공개된 글을 찾을 수 없습니다'));
    article.append(el('p', message || '숨김 처리되었거나 삭제된 글일 수 있습니다.'));
    const back = el('a', '← 소식·기록으로', 'btn line');
    back.href = 'archive.html';
    article.append(back);
    target.replaceChildren(article);
    document.title = '글을 찾을 수 없습니다 | 태장';
  }

  function imageNode(url, alt, className) {
    if (!/^https:\/\//.test(url || '')) return null;
    const figure = el('figure', null, className || 'article-representative-media');
    const image = document.createElement('img');
    image.src = url;
    image.alt = alt || '태장 소식 사진';
    image.loading = 'lazy';
    image.decoding = 'async';
    figure.append(image);
    return figure;
  }

  function render(item) {
    document.title = `${item.title} | 태장`;
    const article = el('article', null, 'article');

    const back = el('a', '← 소식·기록으로', 'text-link');
    back.href = 'archive.html';
    article.append(back);

    const header = el('header', null, 'article-header');
    const eyebrow = item.content_type === 'press_release' ? '보도자료' : item.content_type === 'external_content' ? '외부 기사·콘텐츠' : '태장 소식';
    header.append(el('p', eyebrow, 'eyebrow'));
    header.append(el('h1', item.title));
    const meta = el('div', null, 'article-meta');
    const date = el('time', formatDate(item.published_date));
    date.dateTime = item.published_date || '';
    meta.append(date);
    if (item.byline) meta.append(el('span', item.byline));
    header.append(meta);
    if (item.summary) header.append(el('p', item.summary, 'lead'));
    article.append(header);

    const media = Array.isArray(item.public_media) ? item.public_media.filter(entry => /^https:\/\//.test(entry?.url || '')) : [];
    const heroUrl = /^https:\/\//.test(item.hero_image_url || '') ? item.hero_image_url : media[0]?.url;
    if (heroUrl) {
      const heroMatch = media.find(entry => entry.url === heroUrl);
      const hero = imageNode(heroUrl, heroMatch?.alt || `${item.title} 대표사진`, 'article-representative-media');
      if (hero) article.append(hero);
    }

    const body = el('div', null, 'article-body');
    const paragraphs = String(item.public_body || '')
      .split(/\n\s*\n/)
      .map(value => value.trim())
      .filter(Boolean);
    if (paragraphs.length) paragraphs.forEach(paragraph => body.append(el('p', paragraph)));
    else body.append(el('p', item.summary || '공개된 본문이 없습니다.'));
    article.append(body);

    const galleryItems = media.filter(entry => entry.url !== heroUrl);
    if (galleryItems.length) {
      const gallery = el('section', null, 'article-gallery');
      gallery.setAttribute('aria-label', '첨부 사진');
      galleryItems.forEach((entry, index) => {
        const figure = imageNode(entry.url, entry.alt || `첨부 사진 ${index + 1}`, 'article-gallery-item');
        if (figure) gallery.append(figure);
      });
      article.append(gallery);
    }

    if (/^https:\/\//.test(item.external_url || '')) {
      const external = el('a', '관련 원문 보기 ↗', 'btn line');
      external.href = item.external_url;
      external.target = '_blank';
      external.rel = 'noopener noreferrer';
      article.append(external);
    }

    target.replaceChildren(article);
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    unavailable('주소가 올바르지 않습니다.');
    return;
  }

  fetch(`/.netlify/functions/public-promotion-feed?id=${encodeURIComponent(id)}&format=json`, { cache: 'no-store' })
    .then(async response => {
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || '글을 불러오지 못했습니다.');
      if (!payload?.item) return unavailable();
      render(payload.item);
    })
    .catch(() => unavailable('잠시 후 다시 확인해 주세요.'));
}());
