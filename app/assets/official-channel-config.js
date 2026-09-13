(() => {
  'use strict';

  const LINKS = Object.freeze({
    homepage: Object.freeze({ id: 'homepage', label: '홈페이지', href: '../index.html' }),
    blog: Object.freeze({ id: 'blog', label: '공식 블로그', href: 'https://blog.naver.com/taejang-official' }),
    youtube: Object.freeze({ id: 'youtube', label: '공식 유튜브', href: 'https://youtube.com/@taejangofficial' })
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
          response.clone().json().then(payload => rememberMetadata(requestedUrl, payload)).catch(() => {});
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
