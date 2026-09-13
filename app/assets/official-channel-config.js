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

  function safeUrl(value, base) {
    try { return new URL(String(value || '').trim(), base || window.location.href); }
    catch { return null; }
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

  function classifyUrl(value, metadata = {}) {
    const parsed = safeUrl(value);
    if (!parsed) return '';
    const host = parsed.hostname.toLowerCase();
    if (parsed.origin === window.location.origin || OFFICIAL_HOMEPAGE_HOSTS.has(host)) return 'taejang_homepage';
    if (isOfficialBlogUrl(parsed.toString())) return 'taejang_blog';
    if (isOfficialYouTubeIdentity(parsed.toString())) return 'taejang_youtube';
    if (YOUTUBE_HOSTS.has(host) && metadataIdentityUrls(metadata).some(isOfficialYouTubeIdentity)) return 'taejang_youtube';
    return 'external';
  }

  window.TaejangOfficialChannels = Object.freeze({
    links: LINKS,
    list: Object.freeze([LINKS.homepage, LINKS.blog, LINKS.youtube]),
    blogId: OFFICIAL_BLOG_ID,
    youtubeHandle: OFFICIAL_YOUTUBE_HANDLE,
    isOfficialBlogUrl,
    isOfficialYouTubeIdentity,
    classifyUrl
  });
})();
