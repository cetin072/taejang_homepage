// Produce crawlable, JS-independent article pages from the existing approved content.
// The single source of truth remains assets/js/content.js; no extra CMS is introduced.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
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

function renderArticle(group, item, siblings) {
  const itemPath = articlePath(group, item);
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
    '<a class="back-link" href="' + group.page + '">← ' + group.label + ' 목록으로</a>',
    '<article class="article">',
    '<header class="article-header">',
    '<div class="article-meta"><span class="tag">' + htmlText(item.category) +
      '</span><time datetime="' + htmlText(isoDate) + '">' + htmlText(date) + '</time></div>',
    '<h1>' + htmlText(item.title) + '</h1>',
    '<p class="lead">' + htmlText(item.summary) + '</p>',
    '</header>',
    '<div class="article-body">' + photo + paragraphs(item) +
      (gallery ? '<div class="article-gallery">' + gallery + '</div>' : '') + '</div>',
    related ? '<section class="related-posts" aria-label="관련 이야기"><h2>다른 태장 이야기</h2><div class="related-posts-grid">' +
      related + '</div></section>' : '',
    '<a class="back-link back-link--bottom" href="' + group.page + '">← 목록으로</a>',
    '</article></div></section>',
    '</main>'
  ].join('\n');
  return { path: itemPath, body, photo: imageUrl(source), isoDate };
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
        datePublished: article.isoDate,
        image: article.photo,
        author: { '@type': 'Organization', name: '농업회사법인 태장 주식회사' },
        publisher: { '@type': 'Organization', name: '농업회사법인 태장 주식회사', url: ORIGIN + '/' }
      }
    ]
  };
  const json = JSON.stringify(graph).replaceAll('<', '\\u003c');
  output = replaceRequired(output, /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    '<script type="application/ld+json">' + json + '</script>', 'structured data');
  output = replaceRequired(output, /<main id="main-content">[\s\S]*?<\/main>/,
    article.body, 'main');
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
    }
  }
  const sitemapPath = path.join(outputRoot, 'sitemap.xml');
  let sitemap = await readFile(sitemapPath, 'utf8');
  const missing = urls.filter(url => !sitemap.includes('<loc>' + xmlText(url) + '</loc>'));
  const additions = missing.map(url => '  <url><loc>' + xmlText(url) + '</loc></url>').join('\n');
  sitemap = replaceRequired(sitemap, /<\/urlset>/, (additions ? additions + '\n' : '') + '</urlset>', 'sitemap urlset');
  await writeFile(sitemapPath, sitemap, 'utf8');
  return { pages: urls.length, urls };
}
