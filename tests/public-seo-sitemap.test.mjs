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
    ['terrarium.html', /창원 테라리움.*DIY 키트/, /일반인 모집은 아직 시작하지 않았습니다/],
    ['minhwa-gallery.html', /창원 민화 초급반 상시 모집/, /매주 수요일·금요일/],
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

test('Changwon minhwa beginner signup has the confirmed schedule and reuses the existing form', async () => {
  const html = await readFile('minhwa-gallery.html', 'utf8');
  const catalog = await readFile('resources.html', 'utf8');
  const card = html.match(/<article[^>]+id="mh-beginner">[\s\S]*?<\/article>/)?.[0];
  assert.match(card, /상시 모집[\s\S]*창원 민화 초급반[\s\S]*매주 수요일·금요일/);
  for (const time of ['09:00', '12:00', '13:00', '16:00']) assert.ok(card.includes('datetime="' + time + '"'));
  assert.match(card, /회당 3시간/);
  assert.match(card, /href="#mh-contact" data-home-inquiry-open[^>]*>초급반 신청 문의/);
  assert.match(html, /href="#mh-beginner"/);
  assert.match(catalog, /id="resource-minhwa-status">초급반 상시 모집/);
  assert.doesNotMatch(html, /일반인 민화 초급반과 굿즈는 준비 중|일반인 모집 일정, 수업 장소와 참가비는 확정 후/);
});
