// Real Chromium regression using public fixtures only; no login or data writes.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(process.env.ARCHIVE_QA_ROOT || '.');
const output = path.resolve(process.env.ARCHIVE_QA_OUTPUT || 'admin-ui-qa-artifacts/archive-initial');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep)) throw new Error('path');
    res.setHeader('content-type', ({ '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' })[path.extname(file)] || 'text/html');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = process.env.ARCHIVE_QA_BASE || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
const metrics = [];
const fixture = { id: 'promotion-browser-fixture', type: 'external', source: 'naver-blog', category: '회사소식', title: '최신 브라우저 검수 기록', summary: '네트워크 fixture로만 표시', thumbnail: '/images/og-taejang.png', publishedAt: '2099-01-01', status: 'published', externalUrl: 'https://blog.naver.com/taejang-official/999999999999', externalLabel: '네이버 블로그에서 보기' };
try {
  for (const width of [390, 1440]) {
    for (const mode of ['normal', 'slow', 'failure', 'no-js', 'script-error', 'early']) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, javaScriptEnabled: mode !== 'no-js' });
      await context.route('https://fonts.**', route => route.abort());
      await context.route('https://taejang.co.kr/images/og-taejang.png', route => route.fulfill({ contentType: 'image/png', path: path.join(root, 'images/og-taejang.png') }));
      let releaseFeed; const feedReady = new Promise(resolve => { releaseFeed = resolve; });
      await context.route('**/.netlify/functions/public-promotion-feed*', async route => {
        if (mode === 'slow') await feedReady;
        if (mode === 'failure') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fixture"}' });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [fixture, { ...fixture, id: 'duplicate-same-link' }] }) });
      });
      let releaseHub; const hubReady = new Promise(resolve => { releaseHub = resolve; });
      await context.route('**/assets/js/content-hub.js', async route => {
        if (mode === 'script-error') return route.abort();
        if (mode === 'normal' || mode === 'early') await hubReady;
        return route.continue();
      });
      const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/archive.html', { waitUntil: 'commit' });
      await page.locator('[data-hub-list] article').first().waitFor();
      if (mode === 'normal' || mode === 'early') {
        // Exact HTML and hydrated view must use the same first record and controls.
        const first = page.locator('[data-hub-list] article').first();
        const title = await first.locator('h2').textContent();
        await page.screenshot({ path: path.join(output, `initial-${width}.png`), fullPage: false });
        await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); });
        const top = (await first.boundingBox()).y;

 
        releaseHub();
        await page.waitForFunction(() => window.TAEJANG_CONTENT_HUB && !document.querySelector('[data-archive-search-input]').disabled);
        assert.equal(await page.locator('[data-hub-list] article').first().locator('h2').textContent(), title);
        const shift = Math.abs((await page.locator('[data-hub-list] article').first().boundingBox()).y - top);
        metrics.push({ width, mode, firstCardTopShift: shift });
        assert.ok(shift <= 3, `first card moves ${shift}px at hydration`);
      }
      if (mode === 'no-js' || mode === 'script-error') {
        assert.equal(await page.locator('[data-static-fallback-card]').count(), 12);
        assert.match(await page.locator('[data-hub-list] article').first().locator('time').getAttribute('datetime'), /^2026-10/);
        const href = await page.locator('[data-hub-list] article a.card-link').first().getAttribute('href');
        assert.match(href, /^(https:\/\/blog.naver.com\/taejang-official\/|promotion.html\?id=)/);
      } else if (mode === 'failure') {
        await page.getByText('최신 소식을 불러오지 못했습니다.', { exact: false }).waitFor();
        assert.ok(await page.locator('[data-hub-list] article').count() >= 6);
      } else {
        const search = page.locator('[data-archive-search-input]');
        await search.fill('민화');
        await page.locator('[data-source="naver-blog"].filter-btn').click();
        await page.locator('[data-category="회사소식"].filter-btn').click();
        await page.locator('#archive-year').selectOption('2026');
        await page.locator('#archive-month').selectOption('10');
        const before = await page.locator('[data-hub-list] article h2').allTextContents();
        if (mode === 'slow') {
          const more = page.getByRole('button', { name: '더 보기', exact: true });
          if (await more.isVisible()) await more.click();
          await search.focus();
          const beforeArrival = await page.locator('[data-hub-list] article h2').allTextContents();
          const scroll = await page.evaluate(() => new Promise(resolve => {
            let last = scrollY, stable = 0;
            function frame() { const now = scrollY; stable = now === last ? stable + 1 : 0; last = now; if (stable >= 5) resolve(now); else requestAnimationFrame(frame); }
            requestAnimationFrame(frame);
          }));
          releaseFeed();
          await page.locator('[data-archive-apply-updates]').waitFor();
          assert.deepEqual(await page.locator('[data-hub-list] article h2').allTextContents(), beforeArrival);
          assert.ok(Math.abs(await page.evaluate(() => scrollY) - scroll) <= 2, `feed arrival scroll changed from ${scroll} to ${await page.evaluate(() => scrollY)}`);
          assert.equal(await search.evaluate(input => document.activeElement === input), true);
        }
        await page.locator('[data-archive-apply-updates]').click();
        assert.equal(await search.inputValue(), '민화');
        assert.equal(await page.locator('#archive-year').inputValue(), '2026');
        assert.equal(await page.locator('#archive-month').inputValue(), '10');
        assert.equal(await page.locator('.filter-btn[data-source="naver-blog"]').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('.filter-btn[data-category="회사소식"]').getAttribute('aria-pressed'), 'true');
        const after = await page.locator('[data-hub-list] article h2').allTextContents();
        assert.deepEqual(after.slice(0, before.length), before);
        await search.fill('絶対に一致しない検索');
        await page.getByRole('button', { name: '조건 초기화', exact: true }).click();
        const latest = page.locator('[data-hub-list] article').first();
        assert.equal(await latest.locator('h2').textContent(), fixture.title);
        assert.equal(await page.locator('[data-hub-list] article').filter({ hasText: fixture.title }).count(), 1);
        assert.equal(await latest.locator('a.card-link').getAttribute('href'), fixture.externalUrl);
        assert.equal(await latest.locator('a.card-link').getAttribute('target'), '_blank');
        const dates = await page.locator('[data-hub-list] time').evaluateAll(nodes => nodes.map(n => n.dateTime));
        assert.deepEqual(dates, [...dates].sort().reverse());
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(output, `${mode}-${width}.png`), fullPage: false });
      if (process.env.ARCHIVE_QA_ROOT || process.env.ARCHIVE_QA_BASE) {
        const firstImage = page.locator('[data-hub-list] article img').first();
        await firstImage.scrollIntoViewIfNeeded();
        await firstImage.evaluate(image => image.decode());
        assert.ok(await firstImage.evaluate(image => image.naturalWidth > 0));
        await page.screenshot({ path: path.join(output, `cards-${mode}-${width}.png`), fullPage: false });
      }
      await context.close();
      console.log(`PASS archive ${width}px ${mode}`);
    }
  }
  console.log('Hydration measurements:', JSON.stringify(metrics));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
