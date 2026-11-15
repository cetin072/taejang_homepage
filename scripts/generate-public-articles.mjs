// Produce crawlable, JS-independent article pages from the existing approved content.
// The single source of truth remains assets/js/content.js; no extra CMS is introduced.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const ORIGIN = 'https://taejang.co.kr';
const GROUPS = [
  { key: 'activities', page: 'activities.html', label: '태장의 활동' },
  { key: 'workplace', page: 'workplace.html', label: '우리의 일터' }
];

function htmlText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function xmlText(value) {
  return htmlText(value);
}

function replaceRequired(source, match, value, label) {
  if (!match.test(source)) throw new Error('Missing public SEO template marker: ' + label);
  return source.replace(match, value);
}

function imageUrl(value) {
  if (!value || typeof value !== 'string') return ORIGIN + '/images/og-taejang.png';
  const url = new URL(value.replace(/^\/+/, ''), ORIGIN + '/');
  if (url.protocol !== 'https:') return ORIGIN + '/images/og-taejang.png';
  return url.href;
}

function articlePath(group, item) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(item.id || '')) {
    throw new Error('Unsafe published content id in ' + group.key);
  }
  return group.key + '/' + item.id + '.html';
}

function sectionsFor(item) {
  if (Array.isArray(item.sections) && item.sections.length) return item.sections;
  if (!Array.isArray(item.body)) return [];
  return item.body.map((entry) => typeof entry === 'string'
    ? { paragraphs: [entry] } : entry);
}

function paragraphs(item) {
  return sectionsFor(item).map(section => {
    const heading = section?.heading ? '<h2>' + htmlText(section.heading) + '</h2>' : '';
    const parts = Array.isArray(section?.paragraphs) ? section.paragraphs : [];
    return heading + parts.filter(part => typeof part === 'string' && part.trim())
      .map(part => '<p>' + htmlText(part) + '</p>').join('');
  }).join('\n');
}

function renderResources(item) {
  const links = [];
  if (/^\d{9,15}$/.test(item.resources?.blogPost || '')) links.push('<a class="article-resource-card" href="https://blog.naver.com/taejang-official/' + item.resources.blogPost + '" target="_blank" rel="noopener noreferrer" aria-label="사진과 이야기 보기 (네이버 블로그, 새 탭)"><span class="article-resource-source">NAVER BLOG</span><strong>사진과 이야기 보기</strong><span>태장 공식 블로그 <span aria-hidden="true">↗</span> · 새 탭</span></a>');
  if (/^[A-Za-z0-9_-]{11}$/.test(item.resources?.youtubeId || '')) links.push('<a class="article-resource-card article-resource-card--video" href="https://www.youtube.com/watch?v=' + item.resources.youtubeId + '" target="_blank" rel="noopener noreferrer" aria-label="활동 영상 보기 (유튜브, 새 탭)"><span class="article-resource-source">YOUTUBE</span><strong>활동 영상 보기</strong><span>태장의 현장 영상 <span aria-hidden="true">↗</span> · 새 탭</span></a>');
  return links.length ? '<aside class="article-resources" aria-label="활동 관련 자료"><h2>사진과 영상으로 더 보기</h2><div class="article-resource-links">' + links.join('') + '</div></aside>' : '';
}

function renderArticle(group, item, siblings) {
  const itemPath = articlePath(group, item);
  const listPage = item.series === 'community-esg' ? 'community-esg-records.html' : group.page;
  const listLabel = item.series === 'community-esg' ? '환경정비 활동' : group.label;
  const date = String(item.date || '');
  const isoDate = date.replaceAll('.', '-');
  const source = item.thumbnail || item.hero || item.thumb || '';
  const alt = item.thumbnailAlt || item.alt?.hero || item.alt?.thumb || item.title;
  const mode = item.thumbnailDetail === 'natural' ? 'natural' : 'cover';
  const photo = source
    ? '<figure class="article-representative-media article-representative-media--' + mode + '"><img src="' + htmlText(source) + '" alt="' + htmlText(alt) + '" loading="eager" decoding="async"></figure>'
    : '';
  const gallery = (Array.isArray(item.gallery) ? item.gallery : [])
    .filter(src => typeof src === 'string' && src)
    .map((src, index) => '<img src="' + htmlText(src) + '" alt="' +
      htmlText(item.alt?.gallery?.[index] || item.title) + '" loading="lazy" decoding="async">').join('');
  const related = siblings.filter(entry => entry.id !== item.id).slice(0, 2)
    .map(entry => '<a class="related-post" href="' + htmlText(articlePath(group, entry)) +
      '"><h3>' + htmlText(entry.title) + '</h3><p>' +
      htmlText(entry.summary) + '</p><span class="text-link">글 보기 →</span></a>').join('');
  const body = [
    '<main id="main-content">',
    '<section class="section"><div class="container">',
    '<a class="back-link" href="' + listPage + '">← ' + listLabel + ' 목록으로</a>',
    '<article class="article">',
    '<header class="article-header">',
    '<div class="article-meta"><span class="tag">' + htmlText(item.category) +
      '</span><time datetime="' + htmlText(isoDate) + '">' + htmlText(date) + '</time></div>',
    '<h1>' + htmlText(item.title) + '</h1>',
    '<p class="lead">' + htmlText(item.summary) + '</p>',
    '</header>',
    '<div class="article-body">' + photo + paragraphs(item) + renderResources(item) +
      (gallery ? '<div class="article-gallery">' + gallery + '</div>' : '') + '</div>',
    related ? '<section class="related-posts" aria-label="관련 이야기"><h2>다른 태장 이야기</h2><div class="related-posts-grid">' +
      related + '</div></section>' : '',
    '<a class="back-link back-link--bottom page-link" href="' + listPage + '">← 목록으로</a>',
    '</article></div></section>',
    '</main>'
  ].join('\n');
  return { path: itemPath, body, photo: imageUrl(source), isoDate };
}

// Keep the existing packing URL and content record; give this one job its own landing layout.
function renderPackingLanding(item) {
  const [intro, ...steps] = sectionsFor(item);
  const flow = steps.map((step, index) => `<li><span aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><div><h3>${htmlText(step.heading)}</h3>${step.paragraphs.map(text => `<p>${htmlText(text)}</p>`).join('')}</div></li>`).join('\n');
  return `<main id="main-content">
<div class="workplace-page packing-page">
<article class="article packing-article">
  <section class="page-hero">
    <div class="container"><a class="back-link" href="workplace.html">← 우리의 일터</a></div>
    <div class="container workplace-intro">
      <div><h1 class="title">${htmlText(item.title)}</h1>
        <p class="lead">${htmlText(intro.paragraphs.join(' '))}</p>
        <a class="btn line page-link" href="workplace/packing-care.html#packing-process">포장·검수 과정 보기 <span aria-hidden="true">↓</span></a>
      </div>
      <figure class="workplace-photo">
        <img src="assets/images/workplace/packing-tape-work.webp" width="1200" height="900" alt="상자 위에 테이프를 붙이는 태장 근로자의 손과 포장 도구" fetchpriority="high" decoding="async">
        <figcaption>상자 포장 작업 중인 태장 근로자</figcaption>
      </figure>
    </div>
  </section>
  <section class="section" aria-labelledby="packing-process">
    <div class="container workplace-method">
      <div><h2 class="title" id="packing-process">포장 작업은 이렇게 이어집니다</h2>
        <p class="lead">포장 작업은 자재를 준비하는 일에서 시작해, 완성된 포장 상태를 확인하는 일로 이어집니다.</p>
        <ol class="workplace-steps" role="list">${flow}</ol>
      </div>
      <figure class="workplace-illustration">
        <img src="assets/images/workplace/workplace-packing-watercolor.webp" alt="상자를 테이프로 포장하는 작업 수채화 일러스트" width="1200" height="900" loading="lazy" decoding="async">
        <figcaption>포장 작업을 표현한 일러스트</figcaption>
      </figure>
    </div>
  </section>
</article>
  <section class="section beige" aria-labelledby="packing-next-title">
    <div class="container workplace-support workplace-support--plain">
      <div><h2 id="packing-next-title">다른 일터도 만나보세요</h2><p>민화와 테라리움, 지역 환경정비까지. 태장에서는 다양한 작업을 함께 이어갑니다.</p></div>
      <a class="btn line page-link" href="workplace.html#workplace-jobs">우리의 일터로 돌아가기 <span aria-hidden="true">→</span></a>
    </div>
  </section>
</div>
</main>`;
}

function renderDocument(template, group, item, siblings) {
  const article = renderArticle(group, item, siblings);
  const canonical = ORIGIN + '/' + article.path;
  const articleTitle = item.title + ' | 농업회사법인 태장 주식회사';
  const description = String(item.summary || item.title);
  const meta = (attribute, value) => '<meta ' + attribute + ' content="' + htmlText(value) + '">';
  let output = replaceRequired(template, /<head>/, '<head>\n<base href="/">', 'head');
  output = replaceRequired(output, /<title>[^<]*<\/title>/, '<title>' + htmlText(articleTitle) + '</title>', 'title');
  output = replaceRequired(output, /<meta name="description" content="[^"]*">/, meta('name="description"', description), 'description');
  output = replaceRequired(output, /<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + canonical + '">', 'canonical');
  for (const [property, value] of [
    ['og:type', 'article'], ['og:title', articleTitle], ['og:description', description],
    ['og:url', canonical], ['og:image', article.photo], ['og:image:secure_url', article.photo],
    ['og:image:alt', item.thumbnailAlt || item.alt?.hero || item.title]
  ]) {
    const expression = new RegExp('<meta property="' + property + '" content="[^"]*">');
    output = replaceRequired(output, expression, meta('property="' + property + '"', value), property);
  }
  for (const [name, value] of [
    ['twitter:card', 'summary_large_image'], ['twitter:title', articleTitle],
    ['twitter:description', description], ['twitter:image', article.photo]
  ]) {
    const expression = new RegExp('<meta name="' + name + '" content="[^"]*">');
    output = replaceRequired(output, expression, meta('name="' + name + '"', value), name);
  }
  // Generic 1200x630 metadata describes the logo, not arbitrary article photography.
  output = output.replace(/<meta property="og:image:(?:type|width|height)" content="[^"]*">\s*/g, '');
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '홈', item: ORIGIN + '/' },
          { '@type': 'ListItem', position: 2, name: group.label, item: ORIGIN + '/' + group.page },
          { '@type': 'ListItem', position: 3, name: item.title, item: canonical }
        ]
      },
      {
        '@type': 'Article',
        mainEntityOfPage: canonical,
        headline: item.title,
        description,
        articleSection: item.category,
        ...( /^\d{4}-\d{2}-\d{2}$/.test(article.isoDate) ? { datePublished: article.isoDate } : {}),
        image: article.photo,
        author: { '@type': 'Organization', '@id': ORIGIN + '/#organization', name: '농업회사법인 태장 주식회사' },
        publisher: { '@type': 'Organization', '@id': ORIGIN + '/#organization', name: '농업회사법인 태장 주식회사', url: ORIGIN + '/' }
      }
    ]
  };
  const json = JSON.stringify(graph).replaceAll('<', '\\u003c');
  output = replaceRequired(output, /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    '<script type="application/ld+json">' + json + '</script>', 'structured data');
  output = replaceRequired(output, /<main id="main-content">[\s\S]*?<\/main>/,
    group.key === 'workplace' && item.id === 'packing-care' ? renderPackingLanding(item) : article.body, 'main');
  // A fragment alone resolves against <base href="/">, so include this article's path.
  output = output.replace('href="#main-content"', 'href="' + article.path + '#main-content"');
  output = output.replace(/<script src="assets\/js\/listing.js"><\/script>\s*/g, '');
  if (group.key === 'workplace') output = output.replace('<body data-content-type="workplace">',
    '<body data-content-type="workplace" class="workplace-detail-mode">');
  return output;
}

export async function generatePublicArticles({ repoRoot, outputRoot }) {
  const context = { window: {} };
  const source = await readFile(path.join(repoRoot, 'assets/js/content.js'), 'utf8');
  vm.runInNewContext(source, context, { timeout: 1000 });
  const content = context.window.TAEJANG_CONTENT;
  if (!content) throw new Error('Approved public content unavailable');
  const urls = [];
  const legacyRedirects = [];
  for (const group of GROUPS) {
    const template = await readFile(path.join(repoRoot, group.page), 'utf8');
    const entries = Array.isArray(content[group.key]) ? content[group.key] : [];
    const approved = entries.filter(item => item?.status === 'published');
    approved.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    for (const item of approved) {
      const relative = articlePath(group, item);
      const html = renderDocument(template, group, item, approved);
      const dest = path.join(outputRoot, relative);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, html, 'utf8');
      urls.push(ORIGIN + '/' + relative);
      // Preserve known approved legacy ?id= links without indexing a duplicate detail URL.
      legacyRedirects.push(`/${group.page} id=${item.id} /${relative} 301!`);
    }
  }
  // Netlify _redirects precede netlify.toml and only redirect approved IDs.
  await writeFile(path.join(outputRoot, '_redirects'), legacyRedirects.join('\n') + '\n', 'utf8');
  const sitemapPath = path.join(outputRoot, 'sitemap.xml');
  let sitemap = await readFile(sitemapPath, 'utf8');
  const missing = urls.filter(url => !sitemap.includes('<loc>' + xmlText(url) + '</loc>'));
  const additions = missing.map(url => '  <url><loc>' + xmlText(url) + '</loc></url>').join('\n');
  sitemap = replaceRequired(sitemap, /<\/urlset>/, (additions ? additions + '\n' : '') + '</urlset>', 'sitemap urlset');
  await writeFile(sitemapPath, sitemap, 'utf8');
  return { pages: urls.length, urls };
}

const NON_CONTENT = new Set(['404.html', 'thanks.html', 'promotion.html']);

function attr(tag, name) {
  return tag.match(new RegExp('\\b' + name + '\\s*=\\s*(["\'])(.*?)\\1', 'i'))?.[2] || '';
}

export async function buildPublicSitemap({ repoRoot, outputRoot, publicFiles }) {
  const publishedHtml = publicFiles.filter(file => /^[^/]+\.html$/.test(file));
  const rootHtml = (await readdir(repoRoot)).filter(file => file.endsWith('.html'));
  const unclassified = rootHtml.filter(file => !publishedHtml.includes(file));
  if (unclassified.length) {
    throw new Error('Classify root HTML before publishing: ' + unclassified.join(', '));
  }
  const urls = [];
  const titles = new Set();
  for (const file of publishedHtml) {
    if (NON_CONTENT.has(file)) continue;
    const html = await readFile(path.join(outputRoot, file), 'utf8');
    const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0]);
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => match[0]);
    const robots = attr(metas.find(tag => attr(tag, 'name').toLowerCase() === 'robots') || '', 'content');
    const title = html.match(/<title>\s*([^<]+?)\s*<\/title>/i)?.[1];
    const description = attr(metas.find(tag => attr(tag, 'name').toLowerCase() === 'description') || '', 'content');
    const canonical = attr(links.find(tag => attr(tag, 'rel').toLowerCase() === 'canonical') || '', 'href');
    const expected = ORIGIN + (file === 'index.html' ? '/' : '/' + file);
    if (!/\bindex\b/i.test(robots) || /\bnoindex\b/i.test(robots) || !/\bfollow\b/i.test(robots) || /\bnofollow\b/i.test(robots) || !title || !description || canonical !== expected) {
      throw new Error('Public SEO metadata needs review: ' + file + ' (index, title, description, canonical)');
    }
    if (titles.has(title.trim().toLowerCase())) throw new Error('Duplicate public page title: ' + file);
    titles.add(title.trim().toLowerCase());
    urls.push(canonical);
  }
  if (new Set(urls).size !== urls.length) throw new Error('Duplicate public sitemap canonical URL');
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(url => '  <url><loc>' + url.replaceAll('&', '&amp;') + '</loc></url>').join('\n') + '\n</urlset>\n';
  await writeFile(path.join(outputRoot, 'sitemap.xml'), xml, 'utf8');
  return urls;
}
