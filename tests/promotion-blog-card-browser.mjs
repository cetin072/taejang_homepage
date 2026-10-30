// Isolated public renderer regression: no login, Storage writes or publication.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import feed from '../netlify/functions/public-promotion-feed.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd();
const source = 'https://blog.naver.com/taejang-official/224451317599';
const rows = [
  { content_id: '11111111-1111-4111-8111-111111111111', title: '직원 블로그 소식', external_url: source, link_source_type: 'taejang_blog' },
  { content_id: '22222222-2222-4222-8222-222222222222', title: '홈페이지 자체 소식' },
  { content_id: '5afa2df3-d796-4dba-aa2a-26bd68308b4a', title: '기존 경남공감 소식', external_url: 'https://www.gyeongnam.go.kr/gonggam/index.gyeong?ggSeq=41900' }
].map(row => ({ ...row, content_type: 'homepage_article', summary: '공개 카드 이동 검수', public_media: [], published_date: '2099-01-01' }));
const previous = { fetch: globalThis.fetch, Netlify: globalThis.Netlify };
let script;
try {
  globalThis.Netlify = { env: { get: name => name === 'SUPABASE_URL' ? 'https://public-example.supabase.co' : 'fixture-key' } };
  globalThis.fetch = async () => Response.json(rows);
  script = await (await feed(new Request('https://preview.example/.netlify/functions/public-promotion-feed'))).text();
} finally { Object.assign(globalThis, previous); }
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/.netlify/functions/public-promotion-feed') {
      res.setHeader('content-type', 'text/javascript'); res.end(script); return;
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) throw new Error('path');
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
    res.setHeader('content-type', types[path.extname(file)] || 'text/html');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) });
const output = process.env.PROMOTION_QA_OUTPUT || '/tmp/promotion-blog-card-qa';
await mkdir(output, { recursive: true });
try {
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.route('https://taejang.co.kr/images/og-taejang.png', route => route.fulfill({ contentType: 'image/png', path: path.join(root, 'images/og-taejang.png') }));
    await context.route('https://blog.naver.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>원문 목적지</h1>' }));
    await context.route('https://www.gyeongnam.go.kr/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>기사 원문 목적지</h1>' }));
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/archive.html');
    const card = page.locator('[data-hub-list] article').filter({ hasText: '직원 블로그 소식' });
    const link = card.locator('a.card-link');
    await link.waitFor();
    await link.locator('img').scrollIntoViewIfNeeded();
    await link.locator('img').evaluate(image => image.decode());
    assert.equal(await link.getAttribute('href'), source);
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.match(await link.getAttribute('rel'), /noopener noreferrer/);
    assert.match(await link.getAttribute('aria-label'), /새 탭에서 열림/);
    assert.match(await card.innerText(), /NAVER BLOG/);
    // Compact mobile cards hide the existing CTA, while retaining the source
    // badge and the accessible label on the same full-card link.
    assert.match(await card.locator('.text-link').textContent(), /네이버 블로그에서 보기/);
    assert.equal(await link.locator('a').count(), 0, 'no nested links');
    assert.equal(await page.locator('[data-hub-list] article').filter({ hasText: '홈페이지 자체 소식' }).locator('a.card-link').getAttribute('href'), 'promotion.html?id=' + rows[1].content_id);
    for (const action of ['image', 'title', 'keyboard']) {
      const opened = page.waitForEvent('popup');
      if (action === 'keyboard') await link.press('Enter');
      else await link.locator(action === 'image' ? 'img' : 'h2').click();
      const popup = await opened; await popup.waitForLoadState();
      assert.equal(popup.url(), source, `${width}: ${action} must open blog directly`);
      await popup.close();
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await card.screenshot({ path: path.join(output, `blog-card-${width}.png`) });
    await page.locator('[data-archive-search-input]').fill('경남공감');
    const gonggam = page.locator('[data-hub-list] a.card-link[href*="ggSeq=41900"]');
    assert.equal(await gonggam.count(), 1, 'existing published record must not duplicate the article');
    assert.match(await gonggam.textContent(), /경남공감 2026년 10월호/);
    assert.match(await gonggam.locator('.text-link').textContent(), /경남공감 기사 바로 보기/);
    assert.match(await gonggam.locator('img').getAttribute('src'), /gonggam-taejang-team-960.webp$/);
    await gonggam.locator('img').scrollIntoViewIfNeeded();
    await gonggam.locator('img').evaluate(image => image.decode());
    const articleOpened = page.waitForEvent('popup');
    await gonggam.locator('img').click();
    const articlePopup = await articleOpened; await articlePopup.waitForLoadState();
    assert.equal(new URL(articlePopup.url()).searchParams.get('ggSeq'), '41900');
    await articlePopup.close();
    await gonggam.screenshot({ path: path.join(output, `gonggam-card-${width}.png`) });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${width}px: blog navigation; internal detail; Gonggam photo/source link and single card`);
  }
  const staticContext = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await staticContext.newPage();
  await staticPage.goto(base + '/archive.html');
  assert.equal(await staticPage.locator('[data-hub-list] a[href*="ggSeq=41900"]').count(), 1, 'article link remains available without JavaScript');
  await staticContext.close();
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
