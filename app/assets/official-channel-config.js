(() => {
  'use strict';

  const LINKS = Object.freeze({
    homepage: Object.freeze({ id: 'homepage', label: '홈페이지', href: '../index.html' }),
    blog: Object.freeze({ id: 'blog', label: '공식 블로그', href: 'https://blog.naver.com/taejang-official', icon: 'data:image/png;base64,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' }),
    youtube: Object.freeze({ id: 'youtube', label: '공식 유튜브', href: 'https://youtube.com/@taejangofficial', icon: 'data:image/png;base64,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' })
  });

  const OFFICIAL_BLOG_ID = 'taejang-official';
  const OFFICIAL_YOUTUBE_HANDLE = '@taejangofficial';
  const OFFICIAL_HOMEPAGE_HOSTS = new Set(['taejang.co.kr', 'www.taejang.co.kr']);
  const NAVER_BLOG_HOSTS = new Set(['blog.naver.com', 'm.blog.naver.com']);
  const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
  const metadataCache = new Map();

  function safeUrl(value, base) {
    try { return new URL(String(value || '').trim(), base || window.location.href); }
    catch { return null; }
  }

  function normalizedUrl(value) {
    return safeUrl(value)?.toString() || String(value || '').trim();
  }

  function isOfficialBlogUrl(value) {
    const parsed = safeUrl(value);
    if (!parsed || !NAVER_BLOG_HOSTS.has(parsed.hostname.toLowerCase())) return false;
    const path = parsed.pathname.toLowerCase();
    const firstPathSegment = path.split('/').filter(Boolean)[0] || '';
    const queryBlogId = String(parsed.searchParams.get('blogId') || '').toLowerCase();
    return firstPathSegment === OFFICIAL_BLOG_ID || queryBlogId === OFFICIAL_BLOG_ID;
  }

  function isOfficialYouTubeIdentity(value) {
    const parsed = safeUrl(value);
    if (!parsed || !YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) return false;
    return parsed.pathname.toLowerCase().includes(OFFICIAL_YOUTUBE_HANDLE);
  }

  function metadataIdentityUrls(metadata = {}) {
    return [
      metadata.channel_url,
      metadata.author_url,
      metadata.publisher_url,
      metadata.canonical_channel_url
    ].filter(Boolean);
  }

  function rememberMetadata(requestedUrl, metadata = {}) {
    if (!metadata || typeof metadata !== 'object') return;
    const keys = [requestedUrl, metadata.url].map(normalizedUrl).filter(Boolean);
    keys.forEach(key => metadataCache.set(key, metadata));
    document.dispatchEvent(new CustomEvent('taejang-external-meta-observed', {
      detail: { requestedUrl: normalizedUrl(requestedUrl), metadata }
    }));
  }

  function metadataFor(value) {
    return metadataCache.get(normalizedUrl(value)) || null;
  }

  function classifyUrl(value, metadata = null) {
    const parsed = safeUrl(value);
    if (!parsed) return '';
    const host = parsed.hostname.toLowerCase();
    const observed = metadata || metadataFor(parsed.toString()) || {};
    if (parsed.origin === window.location.origin || OFFICIAL_HOMEPAGE_HOSTS.has(host)) return 'taejang_homepage';
    if (isOfficialBlogUrl(parsed.toString())) return 'taejang_blog';
    if (isOfficialYouTubeIdentity(parsed.toString())) return 'taejang_youtube';
    if (YOUTUBE_HOSTS.has(host) && metadataIdentityUrls(observed).some(isOfficialYouTubeIdentity)) return 'taejang_youtube';
    return 'external';
  }

  function installExternalMetaObserver() {
    if (window.fetch?.__taejangOfficialChannelObserver) return;
    const original = window.fetch.bind(window);
    const wrapped = async (input, init) => {
      const response = await original(input, init);
      try {
        const requestUrl = typeof input === 'string' ? input : input?.url;
        const isMetaEndpoint = String(requestUrl || '').includes('/.netlify/functions/external-content-meta');
        if (isMetaEndpoint && response.ok) {
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
          const requestedUrl = body?.url;
          const payload = await response.clone().json();
          rememberMetadata(requestedUrl, payload);
        }
      } catch {
        // Passive observation must never change the original fetch result.
      }
      return response;
    };
    wrapped.__taejangOfficialChannelObserver = true;
    window.fetch = wrapped;
  }

  installExternalMetaObserver();

  window.TaejangOfficialChannels = Object.freeze({
    links: LINKS,
    list: Object.freeze([LINKS.homepage, LINKS.blog, LINKS.youtube]),
    blogId: OFFICIAL_BLOG_ID,
    youtubeHandle: OFFICIAL_YOUTUBE_HANDLE,
    isOfficialBlogUrl,
    isOfficialYouTubeIdentity,
    rememberMetadata,
    metadataFor,
    classifyUrl
  });
})();
