(() => {
  'use strict';

  const BUCKET = 'notice-media';
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const MAX_PHOTOS = 10;
  const MIME_EXTENSIONS = Object.freeze({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  });

  function app() {
    if (!window.TaejangApp?.getConfig || !window.TaejangApp?.getSession) {
      throw new Error('NOTICE_MEDIA_APP_NOT_READY');
    }
    return window.TaejangApp;
  }

  function encodedPath(path) {
    return String(path || '').split('/').map(segment => encodeURIComponent(segment)).join('/');
  }

  function validateFile(file) {
    if (!file) throw new Error('NOTICE_MEDIA_FILE_REQUIRED');
    if (!MIME_EXTENSIONS[file.type]) throw new Error('NOTICE_MEDIA_TYPE_INVALID');
    if (file.size > MAX_FILE_BYTES) throw new Error('NOTICE_MEDIA_TOO_LARGE');
    return true;
  }

  async function requestStorage(path, options = {}) {
    const current = app();
    const config = current.getConfig();
    const session = current.getSession();
    if (!config?.url || !config?.publishableKey || !session?.access_token) {
      throw new Error('NOTICE_MEDIA_AUTH_REQUIRED');
    }
    const response = await fetch(`${config.url}${path}`, {
      ...options,
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${session.access_token}`,
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.message || payload?.error || `NOTICE_MEDIA_HTTP_${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function upload(noticeId, file) {
    validateFile(file);
    if (!/^[0-9a-f-]{36}$/i.test(String(noticeId || ''))) throw new Error('NOTICE_MEDIA_NOTICE_REQUIRED');
    const extension = MIME_EXTENSIONS[file.type];
    const name = `${noticeId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    await requestStorage(`/storage/v1/object/${BUCKET}/${encodedPath(name)}`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        'Cache-Control': '3600',
        'x-upsert': 'false',
      },
      body: file,
    });
    return { storage_path: name, mime_type: file.type };
  }

  async function remove(storagePath) {
    if (!storagePath) return;
    await requestStorage(`/storage/v1/object/${BUCKET}/${encodedPath(storagePath)}`, {
      method: 'DELETE',
    });
  }

  async function signedUrl(storagePath, expiresIn = 3600) {
    if (!storagePath) return null;
    const current = app();
    const config = current.getConfig();
    const payload = await requestStorage(`/storage/v1/object/sign/${BUCKET}/${encodedPath(storagePath)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn }),
    });
    const raw = payload?.signedURL || payload?.signedUrl;
    if (!raw) throw new Error('NOTICE_MEDIA_SIGN_FAILED');
    return /^https?:\/\//i.test(raw) ? raw : `${config.url}${raw.startsWith('/') ? '' : '/'}${raw}`;
  }

  async function resolve(items) {
    const list = Array.isArray(items) ? items : [];
    return Promise.all(list.map(async item => ({
      ...item,
      signed_url: await signedUrl(item.storage_path).catch(() => null),
    })));
  }

  function openLightbox(url, altText) {
    if (!url) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'notice-photo-dialog';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'button button-quiet';
    close.textContent = '닫기';
    close.addEventListener('click', () => dialog.close());
    const image = document.createElement('img');
    image.src = url;
    image.alt = altText || '공지 사진';
    dialog.append(close, image);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }

  async function renderGallery(container, items, { compact = false } = {}) {
    if (!container) return;
    container.replaceChildren();
    const resolved = await resolve(items);
    resolved.filter(item => item.signed_url).forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = compact ? 'notice-photo-thumb is-compact' : 'notice-photo-thumb';
      button.setAttribute('aria-label', `${item.alt_text || '공지 사진'} 크게 보기`);
      const image = document.createElement('img');
      image.src = item.signed_url;
      image.alt = item.alt_text || '공지 사진';
      image.loading = 'lazy';
      button.append(image);
      button.addEventListener('click', () => openLightbox(item.signed_url, item.alt_text));
      container.append(button);
    });
    container.hidden = container.childElementCount === 0;
  }

  window.TaejangNoticeMedia = {
    BUCKET,
    MAX_FILE_BYTES,
    MAX_PHOTOS,
    validateFile,
    upload,
    remove,
    signedUrl,
    resolve,
    renderGallery,
    openLightbox,
  };
})();
