// Shared presentation policy; inputs come from approved public RPCs.
(function (root) {
  'use strict';
  const DEFAULT_IMAGE = 'https://taejang.co.kr/images/og-taejang.png';
  function persistent(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.port) return false;
      return (u.origin === 'https://taejang.co.kr' && /^\/(?:images|assets\/images)\//.test(u.pathname))
        || (/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname) && u.pathname.startsWith('/storage/v1/object/public/promotion-media/'));
    } catch { return false; }
  }
  function candidates(item) {
    const media = (Array.isArray(item?.public_media) ? item.public_media : []).filter(entry => persistent(entry?.url));
    const hero = media.find(entry => entry.url === item.hero_image_url);
    // Imported standalone og:image is never evidence of publication approval.
    return [...new Set([hero?.url, ...media.map(entry => entry.url), DEFAULT_IMAGE].filter(Boolean))];
  }
  function alt(item, url) {
    return url === DEFAULT_IMAGE ? '농업회사법인 태장 주식회사'
      : item.public_media?.find(entry => entry.url === url)?.alt || `${item.title || '태장 소식'} 대표사진`;
  }
  function bind(image, urls = []) {
    const queue = [...new Set([...urls, DEFAULT_IMAGE].filter(Boolean))];
    let index = Math.max(0, queue.indexOf(image.getAttribute('src')));
    function next() {
      if (index + 1 >= queue.length) return;
      image.src = queue[++index];
      if (image.src === DEFAULT_IMAGE) image.alt = '농업회사법인 태장 주식회사';
    }
    image.addEventListener('error', next);
    if (image.complete && image.naturalWidth === 0) next();
  }
  async function resolve(item, storageOrigin) {
    const urls = candidates(item);
    const usable = await Promise.all(urls.map(async url => {
      if (url === DEFAULT_IMAGE) return true;
      // Never probe arbitrary origins or send storage credentials.
      if (new URL(url).origin !== 'https://taejang.co.kr' && new URL(url).origin !== storageOrigin) return false;
      try {
        const response = await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(2000) });
        return response.ok && /^image\//i.test(response.headers.get('content-type') || '');
      } catch { return false; }
    }));
    const valid = urls.filter((_, index) => usable[index]);
    return { url: valid[0], alt: alt(item, valid[0]), candidates: valid };
  }
  root.TAEJANG_PUBLIC_MEDIA = Object.freeze({ DEFAULT_IMAGE, persistent, candidates, alt, bind, resolve });
}(globalThis));
