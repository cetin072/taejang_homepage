import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

// Reuse the browser's approved data selection/order, without executing a DOM or DB query.
export async function archiveItems(root, extra = []) {
  const context = { window: {}, document: { querySelector: selector => selector === '[data-hub-list][data-static-fallback="archive"]' ? {} : null } };
  for (const file of ['content', 'naver-blog-archive', 'external-content', 'official-channel-updates']) {
    vm.runInNewContext(await readFile(path.join(root, `assets/js/${file}.js`), 'utf8'), context, { timeout: 1000 });
  }
  const hub = context.window.TAEJANG_CONTENT.hub;
  const ids = new Set(hub.map(item => item.id));
  for (const item of extra) if (!ids.has(item.id)) { hub.push(item); ids.add(item.id); }
  vm.runInNewContext(await readFile(path.join(root, 'assets/js/content-hub.js'), 'utf8'), context, { timeout: 1000 });
  return JSON.parse(JSON.stringify(context.window.TAEJANG_CONTENT_HUB.orderedItems()));
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const labels = { homepage: '홈페이지', 'naver-blog': 'NAVER BLOG', youtube: 'YOUTUBE', press: '언론보도', instagram: 'INSTAGRAM', x: 'X' };
export async function generateArchiveSnapshot({ outputRoot, request = fetch, live = true }) {
  let extra = [];
  if (live) {
    try {
      // Only the existing anonymous, public-safe feed. No credentials or private rows.
      const response = await request('https://taejang.co.kr/.netlify/functions/public-promotion-feed?format=json', { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('public feed HTTP ' + response.status);
      const payload = await response.json();
      if (!Array.isArray(payload.items)) throw new Error('invalid public feed');
      extra = payload.items;
    } catch {
      console.warn('Archive live snapshot unavailable; using approved repository records. Runtime will retry and report its status.');
    }
  }
  const items = await archiveItems(outputRoot, extra);
  const file = path.join(outputRoot, 'archive.html');
  let html = await readFile(file, 'utf8');
  const cards = items.slice(0, 12).map(item => {
    const external = item.type === 'external';
    const href = external ? item.externalUrl : item.detailUrl;
    const cta = external ? (item.externalLabel || '원문 보기') + ' ↗' : '자세히 보기';
    return `<article class="card card--hub" data-source="${esc(item.source)}" data-category="${esc(item.category)}" data-static-fallback-card data-archive-id="${esc(item.id)}"><a class="card-link" href="${esc(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''} aria-label="${esc(item.title)}${external ? ' (새 탭에서 열림)' : ' 자세히 보기'}"><div class="card-media card-media--hub"><img src="${esc(item.thumbnail || 'images/og-taejang.png')}" alt="${esc(item.thumbnailAlt || item.title)}" loading="lazy" decoding="async"></div><div class="card-body"><div class="content-card-meta"><span class="source-badge source-badge--${esc(item.source)}">${esc(labels[item.source] || item.source)}</span><span class="tag tag--subtle">${esc(item.category)}</span></div><time class="card-date" datetime="${esc(item.publishedAt)}">${esc(item.publishedAt.replaceAll('-', '.'))}</time><h2>${esc(item.title)}</h2><p>${esc(item.summary)}</p><span class="text-link">${esc(cta)}</span></div></a></article>`;
  }).join('\n');
  html = html.replace(/(<div class="article-list"[^>]*data-static-fallback="archive"[^>]*>)[\s\S]*?(\n      <\/div>)/, (_, start, end) => start + '\n' + cards + end);
  for (const key of ['source', 'category']) {
    const values = ['all', ...new Set(items.map(item => item[key]).filter(Boolean))];
    const buttons = values.map((value, index) => `<button type="button" class="filter-btn ${index === 0 ? 'active' : ''}" data-${key}="${esc(value)}" aria-pressed="${index === 0}" disabled>${esc(value === 'all' ? '전체' : key === 'source' ? labels[value] || value : value)}</button>`).join('');
    html = html.replace(new RegExp(`(<div class="content-filter-buttons" data-hub-${key}-filters>)[\\s\\S]*?(</div>)`), (_, start, end) => start + buttons + end);
  }
  const years = [...new Set(items.map(item => item.publishedAt.slice(0, 4)))].sort().reverse();
  const controls = '<div class="archive-controls" data-archive-date-controls><div class="archive-control"><label for="archive-year">연도</label><select id="archive-year" disabled><option value="all">전체 연도</option>' + years.map(year => '<option value="' + esc(year) + '">' + esc(year) + '년</option>').join('') + '</select></div><div class="archive-control"><label for="archive-month">월</label><select id="archive-month" disabled><option value="all">전체 월</option>' + Array.from({length:12}, (_, i) => '<option value="' + String(i+1).padStart(2,'0') + '">' + (i+1) + '월</option>').join('') + '</select></div><div class="archive-result-count" aria-live="polite">총 ' + items.length + '건 중 12건 표시</div></div>';
  html = html.replace(/<div class="archive-controls" data-archive-date-controls>[\s\S]*?<\/div><\/div>/, '');
  html = html.replace('      <div class="article-list"', controls + '\n      <div class="article-list"');
  // JSON is data, not executable script; the exact same approved baseline hydrates JS.
  html = html.replace(/<script type="application\/json" id="archive-snapshot">[\s\S]*?<\/script>\n?/, '');
  html = html.replace('<script src="assets/js/content.js">', () => '<script type="application/json" id="archive-snapshot">' + JSON.stringify(items).replaceAll('<', '\\u003c') + '</script>\n<script src="assets/js/content.js">');
  await writeFile(file, html);
  return items;
}
