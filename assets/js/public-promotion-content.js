// Presentation only: approved RPC rows and approved static records remain the sources.
// Shared by the Edge HTML, public feed and browser fallback; never writes publication data.
(function (root) {
  'use strict';
  const ORIGIN = 'https://taejang.co.kr';
  const normalized = value => String(value || '').replace(/\s+/g, ' ').trim();
  const excerpt = value => /(?:\.{3}|…|\.\.\.)\s*$/.test(normalized(value));

  function source(item) {
    let url;
    try {
      url = new URL(item.external_url);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    } catch { return null; }
    if (url.origin === ORIGIN) return { url, official: true, label: '태장 홈페이지' };
    if (['blog.naver.com', 'm.blog.naver.com'].includes(url.hostname)
        && /^\/taejang-official\/\d+\/?$/.test(url.pathname)) {
      return { url, official: true, label: '태장 공식 블로그' };
    }
    if (['youtube.com', 'www.youtube.com', 'youtu.be'].includes(url.hostname)
        && item.link_source_type === 'taejang_youtube') {
      return { url, official: true, label: '태장 공식 유튜브' };
    }
    return { url, official: false, label: url.hostname };
  }

  function relatedRecord(origin, content) {
    if (!origin?.official) return null;
    const url = origin.url;
    const blog = /\/taejang-official\/(\d+)\/?$/.exec(url.pathname)?.[1];
    const video = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
    const record = (content?.activities || []).find(item => item.status === 'published'
      && ((blog && item.resources?.blogPost === blog) || (video && item.resources?.youtubeId === video)));
    if (!record || !/^[a-z0-9-]+$/.test(record.id)) return null;
    return { url: ORIGIN + '/activities/' + record.id + '.html', title: record.title, date: record.date, summary: record.summary };
  }

  function present(item, content = root.TAEJANG_CONTENT) {
    const origin = source(item);
    const body = String(item.public_body || '').trim();
    const summary = String(item.summary || '').trim();
    const same = normalized(body) === normalized(summary);
    // Remove repeated leads, not the approved body. A preview stays a preview.
    const lead = !body || same || normalized(body).startsWith(normalized(summary).replace(/(?:\.{3}|…)$/, '').trim())
      ? '' : summary;
    const preview = Boolean(origin && (!body || same || excerpt(body)));
    // Legacy source imports were sometimes stored as homepage_article. A third-party
    // link with no separate original text is not a Taejang-authored Article.
    const external = item.content_type === 'external_content'
      || Boolean(origin && !origin.official && item.content_type !== 'press_release');
    // Blog syndication and source-only introductions keep their working URLs, but
    // their originals (and complete static activity records) are the search targets.
    // Use fields available in BOTH approved feed and detail RPCs for sitemap parity.
    const sourceOnly = Boolean(origin && (origin.label !== '태장 공식 유튜브' || excerpt(summary)));
    const indexable = !external && !sourceOnly;
    return {
      lead, body: body || summary, preview, external, indexable,
      sourceLabel: origin?.label || '', sourceUrl: origin?.url.href || '',
      related: relatedRecord(origin, content),
      notice: preview ? '원문 미리보기입니다. 전체 내용은 아래 원문 링크에서 확인해 주세요.' : '',
      dateLabel: origin ? '홈페이지 등록일: ' : '게시일: '
    };
  }

  root.TAEJANG_PUBLIC_CONTENT = Object.freeze({ present, source });
}(globalThis));
