// Shared presentation policy; inputs come from approved public RPCs.
(function (root) {
  'use strict';
  const DEFAULT_IMAGE = 'https://taejang.co.kr/images/og-taejang.png';
  function persistent(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.port) return false;
      return (u.origin === 'https://taejang.co.kr' && /^\/(?:images|assets\/images)\//.test(u.pathname))
        || (u.origin === 'https://media.taejang.co.kr' && /^\/v1\/[0-9a-f-]{36}\/[a-f0-9]{64}$/.test(u.pathname))
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
  async function resolve(item, storageOrigin, probes = new Map()) {
    const signal = AbortSignal.timeout(2000);
    // Probe only until the first usable approved photo. Remaining approved
    // attachments are browser error fallbacks, not eager network requests.
    const urls = candidates(item).filter(url => url === DEFAULT_IMAGE ||
      new URL(url).origin === 'https://taejang.co.kr' || new URL(url).origin === 'https://media.taejang.co.kr' || new URL(url).origin === storageOrigin);
    for (let index = 0; index < urls.length; index++) {
      const url = urls[index];
      // R2 performs the current-public check on the actual GET. A speculative
      // HEAD would repeat that DB check for SSR/feed + browser, without making
      // the later GET safer. Keep browser error fallback; never cache approval.
      if (new URL(url).origin === 'https://media.taejang.co.kr') {
        return { url, alt: alt(item, url), candidates: urls.slice(index) };
      }
      if (url !== DEFAULT_IMAGE && !probes.has(url)) {
        probes.set(url, (async () => {
          try {
            const response = await fetch(url, { method: 'HEAD', redirect: 'error', signal });
            return response.ok && /^image\//i.test(response.headers.get('content-type') || '');
          } catch { return false; }
        })());
      }
      if (url === DEFAULT_IMAGE || await probes.get(url)) {
        return { url, alt: alt(item, url), candidates: urls.slice(index) };
      }
    }
  }
  root.TAEJANG_PUBLIC_MEDIA = Object.freeze({ DEFAULT_IMAGE, persistent, candidates, alt, bind, resolve });
}(globalThis));
