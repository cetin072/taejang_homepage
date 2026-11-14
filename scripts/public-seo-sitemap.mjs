// Every published root content page has one crawlable canonical URL.
// Keep non-content response screens and the parameterized article shell out.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ORIGIN = 'https://taejang.co.kr';
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
    if (!/\bindex\b/i.test(robots) || /\bnoindex\b/i.test(robots) || !title || !description || canonical !== expected) {
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
