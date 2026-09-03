(() => {
  'use strict';

  const PUBLIC_FIELDS = new Set([
    'content_id', 'revision_id', 'content_type', 'slug', 'title', 'summary',
    'public_body', 'external_url', 'byline', 'related_organization',
    'hero_image_url', 'public_media', 'requested_publish_date'
  ]);
  const PUBLIC_MEDIA_FIELDS = new Set(['url', 'slot', 'kind', 'alt']);
  const status = document.getElementById('status');
  const entriesRoot = document.getElementById('entries');
  const previewHost = location.hostname.startsWith('deploy-preview-') && location.hostname.endsWith('.netlify.app');
  const localHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const httpsUrl = value => typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value);

  const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
      : JSON.stringify(value);

  async function sha256(value) {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function validateMedia(media) {
    if (!media || typeof media !== 'object' || Array.isArray(media)) throw new Error('public_media 항목 형식이 올바르지 않습니다.');
    Object.keys(media).forEach(key => { if (!PUBLIC_MEDIA_FIELDS.has(key)) throw new Error(`공개 미디어 허용목록 밖 필드가 있습니다: ${key}`); });
    if (!httpsUrl(media.url)) throw new Error('공개 미디어 URL은 HTTPS여야 합니다.');
    if (media.slot && !/^(PHOTO (0[1-9]|1[01])|RECENT)$/.test(media.slot)) throw new Error('공개 미디어 슬롯 형식이 올바르지 않습니다.');
    if (media.kind && !['fixed', 'recent', 'selected'].includes(media.kind)) throw new Error('공개 미디어 종류가 올바르지 않습니다.');
    if (media.alt && (typeof media.alt !== 'string' || media.alt.length > 300)) throw new Error('공개 미디어 대체텍스트가 올바르지 않습니다.');
  }

  async function validate(candidate) {
    if (!candidate || candidate.schema_version !== 1 || !Array.isArray(candidate.entries)) throw new Error('공개 artifact 스키마가 올바르지 않습니다.');
    candidate.entries.forEach(entry => {
      Object.keys(entry).forEach(key => { if (!PUBLIC_FIELDS.has(key)) throw new Error(`공개 허용목록 밖 필드가 있습니다: ${key}`); });
      if (!entry.content_id || !entry.revision_id || !entry.slug || !entry.title) throw new Error('공개 artifact 필수값이 없습니다.');
      if (entry.external_url && !httpsUrl(entry.external_url)) throw new Error('외부 공개 링크는 HTTPS여야 합니다.');
      if (entry.hero_image_url && !httpsUrl(entry.hero_image_url)) throw new Error('대표 이미지 URL은 HTTPS여야 합니다.');
      if (entry.public_media !== undefined) {
        if (!Array.isArray(entry.public_media) || entry.public_media.length > 12) throw new Error('public_media 형식이 올바르지 않습니다.');
        const slots = new Set();
        entry.public_media.forEach(media => {
          validateMedia(media);
          if (media.slot) {
            if (slots.has(media.slot)) throw new Error('공개 미디어 슬롯이 중복되었습니다.');
            slots.add(media.slot);
          }
        });
      }
    });
    const expected = await sha256(canonical({ schema_version: candidate.schema_version, generated_at: candidate.generated_at, entries: candidate.entries }));
    if (candidate.checksum !== expected) throw new Error('공개 artifact checksum이 일치하지 않습니다.');
    return candidate;
  }

  function node(tag, value, className) {
    const element = document.createElement(tag);
    if (value) element.textContent = value;
    if (className) element.className = className;
    return element;
  }

  function renderEntry(entry) {
    const article = document.createElement('article');
    article.id = entry.slug;
    article.append(node('p', entry.content_type === 'press_release' ? '보도자료' : '홈페이지 콘텐츠', 'eyebrow'));
    article.append(node('h2', entry.title));
    if (entry.summary) article.append(node('p', entry.summary, 'meta'));
    if (entry.byline || entry.related_organization || entry.requested_publish_date) {
      const meta = node('p', [entry.byline, entry.related_organization, entry.requested_publish_date].filter(Boolean).join(' · '), 'meta');
      article.append(meta);
    }
    if (entry.hero_image_url) {
      const image = document.createElement('img');
      image.src = entry.hero_image_url;
      image.alt = `${entry.title} 대표 이미지`;
      image.loading = 'lazy';
      article.append(image);
    }
    if (entry.public_body) article.append(node('div', entry.public_body, 'body'));
    if (entry.external_url) {
      const link = document.createElement('a');
      link.href = entry.external_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '관련 공개 링크 열기';
      article.append(link);
    }
    if (Array.isArray(entry.public_media) && entry.public_media.length) {
      article.append(node('h3', '게시용 선별 사진'));
      const list = node('ul', '', 'media');
      entry.public_media.forEach((media, index) => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = media.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = media.slot || media.alt || `게시 사진 ${index + 1}`;
        item.append(link);
        list.append(item);
      });
      article.append(list);
    }
    return article;
  }

  async function start() {
    if (!previewHost && !localHost) {
      status.textContent = '이 검증 경로는 Deploy Preview에서만 콘텐츠를 표시합니다.';
      entriesRoot.replaceChildren();
      return;
    }
    try {
      const response = await fetch('artifact.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`artifact를 불러오지 못했습니다 (${response.status}).`);
      const candidate = await validate(await response.json());
      entriesRoot.replaceChildren(...candidate.entries.map(renderEntry));
      status.textContent = `검증 완료 · ${candidate.entries.length}건 · ${candidate.generated_at}`;
    } catch (error) {
      status.textContent = error.message;
      status.className = 'error';
      entriesRoot.replaceChildren();
    }
  }

  start();
})();
