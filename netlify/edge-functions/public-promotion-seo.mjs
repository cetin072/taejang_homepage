// Search-readable responses for the EXISTING approved public promotion RPCs.
// No service-role credentials, private tables, or independent publication states.
const ORIGIN = 'https://taejang.co.kr';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_IMAGE = ORIGIN + '/images/og-taejang.png';
const HEADERS = { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };

function escapeHtml(input) {
  return String(input ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function fail(status = 404) {
  const message = status === 404 ? '공개된 글을 찾을 수 없습니다.' : '잠시 후 다시 확인해 주세요.';
  return new Response(message, {
    status,
    headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' }
  });
}

function imageFor(item) {
  const media = Array.isArray(item.public_media) ? item.public_media : [];
  const selected = media.find(entry => typeof entry?.url === 'string' && /^https:\/\//.test(entry.url));
  if (selected) return { url: selected.url, alt: selected.alt || item.title, media };
  const stored = String(item.link_source_type || 'none') === 'none'
    && /^https:\/\//.test(item.hero_image_url || '') ? item.hero_image_url : '';
  return { url: stored || DEFAULT_IMAGE, alt: item.title, media };
}

function publicLink(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

async function approvedRows(name, parameters) {
  const base = globalThis.Netlify?.env?.get('SUPABASE_URL');
  const key = globalThis.Netlify?.env?.get('SUPABASE_PUBLISHABLE_KEY');
  if (!base || !key || !/^https:\/\//.test(base)) throw new Error('PUBLIC_SEO_CONFIG_UNAVAILABLE');
  const url = new URL('/rest/v1/rpc/' + name, base);
  const response = await fetch(url, {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(parameters || {}),
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error('PUBLIC_SEO_READ_FAILED');
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('PUBLIC_SEO_INVALID_RESPONSE');
  return rows;
}

function metadata(html, field, marker, value) {
  const escaped = escapeHtml(value);
  const tag = '<meta ' + field + '="' + marker + '" content="' + escaped + '">';
  const re = new RegExp('<meta ' + field + '="' + marker + '" content="[^"]*">');
  if (!re.test(html)) throw new Error('Missing public SEO template tag: ' + marker);
  return html.replace(re, tag);
}

function articleHtml(item) {
  const id = item.content_id;
  const canonical = ORIGIN + '/promotion.html?id=' + encodeURIComponent(id);
  const title = String(item.title || '태장 소식');
  const summary = String(item.summary || title);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(item.published_date || '') ? item.published_date : '';
  const image = imageFor(item);
  const media = image.media.filter(entry => publicLink(entry?.url));
  const leadImage = publicLink(image.url);
  const picture = leadImage && leadImage !== DEFAULT_IMAGE
    ? '<figure class="article-representative-media"><img src="' + escapeHtml(leadImage) +
      '" alt="' + escapeHtml(image.alt) + '" loading="eager" decoding="async"></figure>' : '';
  const body = String(item.public_body || '').split(/\n\s*\n/).map(text => text.trim()).filter(Boolean)
    .map(text => '<p>' + escapeHtml(text).replace(/\n/g, '<br>') + '</p>').join('\n');
  const gallery = media.filter(entry => entry.url !== leadImage)
    .map(entry => '<figure class="article-gallery-item"><img src="' + escapeHtml(entry.url) +
      '" alt="' + escapeHtml(entry.alt || title) + '" loading="lazy" decoding="async"></figure>').join('');
  const external = publicLink(item.external_url);
  const sourceLabel = item.link_source_type === 'taejang_blog' ? '태장 공식 블로그에서 보기 ↗'
    : item.link_source_type === 'taejang_youtube' ? '태장 공식 유튜브에서 보기 ↗' : '원문 보기 ↗';
  const externalLink = external
    ? '<a class="btn line" href="' + escapeHtml(external) +
      '" target="_blank" rel="noopener noreferrer">' + sourceLabel + '</a>' : '';
  const article = [
    '<article class="article" data-seo-promotion-id="' + escapeHtml(id) + '">',
    '<a class="back-link" href="archive.html">← 소식·기록으로</a>',
    '<header class="article-header">',
    '<div class="article-meta">' + (date ? '<time datetime="' + date + '">' + date.replaceAll('-', '.') + '</time>' : '') +
      (item.byline ? '<span>' + escapeHtml(item.byline) + '</span>' : '') + '</div>',
    '<h1>' + escapeHtml(title) + '</h1>',
    '<p class="lead">' + escapeHtml(summary) + '</p>',
    '</header>',
    '<div class="article-body">' + picture + (body || '<p>' + escapeHtml(summary) + '</p>') + '</div>',
    gallery ? '<section class="article-gallery" aria-label="첨부 사진">' + gallery + '</section>' : '',
    externalLink,
    '</article>'
  ].join('\n');
  return { id, title, summary, date, image, article, canonical };
}

function renderPage(template, item) {
  const data = articleHtml(item);
  let html = template;
  const titleText = data.title + ' | 농업회사법인 태장 주식회사';
  html = html.replace(/<title>[^<]*<\/title>/, '<title>' + escapeHtml(titleText) + '</title>');
  html = metadata(html, 'name', 'description', data.summary);
  html = metadata(html, 'property', 'og:title', titleText);
  html = metadata(html, 'property', 'og:description', data.summary);
  html = metadata(html, 'property', 'og:image', data.image.url);
  if (!/<article class="article article-empty">[\s\S]*?<\/article>/.test(html)) {
    throw new Error('Missing promotion detail fallback marker');
  }
  html = html.replace(/<article class="article article-empty">[\s\S]*?<\/article>/, data.article);
  const entry = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    mainEntityOfPage: data.canonical,
    headline: data.title,
    description: data.summary,
    ...(data.date ? { datePublished: data.date } : {}),
    ...(data.image.url !== DEFAULT_IMAGE ? { image: data.image.url } : {}),
    author: { '@type': 'Organization', name: '농업회사법인 태장 주식회사' },
    publisher: { '@type': 'Organization', name: '농업회사법인 태장 주식회사', url: ORIGIN + '/' }
  };
  const json = JSON.stringify(entry).replaceAll('<', '\\u003c');
  const externalSource = item.content_type === 'external_content';
  const extras = [
    '<link rel="canonical" href="' + escapeHtml(data.canonical) + '">',
    '<meta property="og:url" content="' + escapeHtml(data.canonical) + '">',
    '<meta property="og:image:alt" content="' + escapeHtml(data.image.alt) + '">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="' + escapeHtml(titleText) + '">',
    '<meta name="twitter:description" content="' + escapeHtml(data.summary) + '">',
    '<meta name="twitter:image" content="' + escapeHtml(data.image.url) + '">',
    externalSource ? '<meta name="robots" content="noindex, follow">' : '',
    externalSource ? '' : '<script type="application/ld+json">' + json + '</script>'
  ].filter(Boolean).join('\n');
  html = html.replace('</head>', extras + '\n</head>');
  if (externalSource) html = html.replace('<meta name="robots" content="index, follow">', '');
  return html;
}

function sitemapResponse(rows) {
  const links = rows
    .filter(row => row && UUID.test(row.content_id || '') && row.content_type !== 'external_content')
    .map(row => ORIGIN + '/promotion.html?id=' + encodeURIComponent(row.content_id));
  const unique = [...new Set(links)].sort();
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    unique.map(url => '  <url><loc>' + escapeHtml(url) + '</loc></url>').join('\n') + '\n</urlset>\n';
  return new Response(xml, { status: 200, headers: { ...HEADERS, 'Content-Type': 'application/xml; charset=utf-8' } });
}

export default async function publicPromotionSeo(request, context) {
  if (request.method !== 'GET') return context.next();
  const route = new URL(request.url);
  if (route.pathname === '/sitemap-promotions.xml') {
    try {
      return sitemapResponse(await approvedRows('list_public_promotion_feed', {}));
    } catch {
      return fail(503);
    }
  }
  if (route.pathname !== '/promotion.html') return context.next();
  const id = route.searchParams.get('id');
  if (!id) return context.next();
  if (!UUID.test(id)) return fail(404);
  try {
    const rows = await approvedRows('get_public_promotion_content', { p_content_id: id });
    if (!rows.length || rows[0]?.content_id !== id) return fail(404);
    const source = await context.next();
    if (!source.ok) return source;
    const html = renderPage(await source.text(), rows[0]);
    const headers = new Headers(source.headers);
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Cache-Control', 'no-store, max-age=0');
    headers.delete('Content-Length');
    return new Response(html, { status: 200, headers });
  } catch {
    return fail(503);
  }
}

export const config = { path: ['/promotion.html', '/sitemap-promotions.xml'], method: 'GET' };
