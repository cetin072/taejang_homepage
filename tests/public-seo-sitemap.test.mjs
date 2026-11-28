import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPublicSitemap } from '../scripts/generate-public-articles.mjs';

const page = (name, robots = 'index, follow') => `<!doctype html><html><head><meta name="robots" content="${robots}"><meta name="description" content="태장의 공개 안내"><title>태장 안내 ${name}</title><link rel="canonical" href="https://taejang.co.kr/${name === 'index.html' ? '' : name}"></head></html>`;
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taejang-seo-'));
  const out = path.join(root, 'dist'); await mkdir(out);
  for (const name of ['index.html', 'new-page.html', '404.html', 'thanks.html', 'promotion.html']) {
    await writeFile(path.join(root, name), page(name));
    await writeFile(path.join(out, name), page(name));
  }
  return { root, out, files: ['index.html', 'new-page.html', '404.html', 'thanks.html', 'promotion.html'] };
}
test('published page automatically enters sitemap while non-content screens remain excluded', async () => {
  const { root, out, files } = await fixture();
  try {
    await buildPublicSitemap({ repoRoot: root, outputRoot: out, publicFiles: files });
    const xml = await readFile(path.join(out, 'sitemap.xml'), 'utf8');
    assert.match(xml, /<loc>https:\/\/taejang\.co\.kr\/new-page\.html<\/loc>/);
    assert.doesNotMatch(xml, /404\.html|thanks\.html|promotion\.html/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('accidental noindex or an unclassified new root page blocks publishing', async () => {
  const { root, out, files } = await fixture();
  try {
    await writeFile(path.join(out, 'new-page.html'), page('new-page.html', 'noindex, nofollow'));
    await assert.rejects(buildPublicSitemap({ repoRoot: root, outputRoot: out, publicFiles: files }), /Public SEO metadata needs review: new-page.html/);
    await writeFile(path.join(out, 'new-page.html'), page('new-page.html', 'index, nofollow'));
    await assert.rejects(buildPublicSitemap({ repoRoot: root, outputRoot: out, publicFiles: files }), /Public SEO metadata needs review: new-page.html/);
    await writeFile(path.join(out, 'new-page.html'), page('new-page.html'));
    await writeFile(path.join(root, 'forgotten.html'), page('forgotten.html'));
    await assert.rejects(buildPublicSitemap({ repoRoot: root, outputRoot: out, publicFiles: files }), /Classify root HTML before publishing: forgotten.html/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('product landings identify themselves consistently and are linked from the public catalog', async () => {
  const catalog = await readFile('resources.html', 'utf8');
  const sitemap = await readFile('sitemap.xml', 'utf8');
  const expected = [
    ['new-zealand-salt.html', /5kg·10kg·25kg 납품/, /Grade 27 Fine Solar Salt/],
    ['terrarium.html', /DIY 키트/, /외부 DIY 키트·클래스·출강은 준비 중/],
    ['minhwa-gallery.html', /갤러리·굿즈·클래스·출강/, /굿즈와 일반인 초급반은 준비 중/],
  ];
  for (const [filename, intent, visibleFact] of expected) {
    const html = await readFile(filename, 'utf8');
    const [head, body] = html.split('</head>');
    const title = head.match(/<title>([^<]+)<\/title>/)?.[1];
    assert.match(title, intent, filename);
    assert.equal(head.match(/<meta property="og:title" content="([^"]+)"/)?.[1], title);
    assert.equal(head.match(/<meta name="twitter:title" content="([^"]+)"/)?.[1], title);
    const canonical = 'https://taejang.co.kr/' + filename;
    assert.equal(head.match(/<link rel="canonical" href="([^"]+)"/)?.[1], canonical);
    const crumbs = JSON.parse(head.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1]);
    assert.equal(crumbs['@type'], 'BreadcrumbList');
    assert.deepEqual(crumbs.itemListElement.map(item => item.item), [
      'https://taejang.co.kr/', 'https://taejang.co.kr/resources.html', canonical,
    ]);
    const main = body.match(/<main\b[\s\S]*?<\/main>/)?.[0];
    assert.match(main, visibleFact, filename);
    assert.ok(catalog.includes('href="' + filename + '"'), filename);
    assert.ok(sitemap.includes('<loc>' + canonical + '</loc>'), filename);
  }
});
