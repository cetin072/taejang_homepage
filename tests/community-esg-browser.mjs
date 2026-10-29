import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const root = path.resolve('dist');
const output = process.env.ESG_QA_OUTPUT || path.join(os.tmpdir(), 'taejang-esg-qa');
await fs.mkdir(output, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.webp': 'image/webp', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) throw Error('Invalid path');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CI ? { channel: 'chrome' } : {}) });
const order = ['fifth', 'fourth', 'third', 'second', 'first'];
try {
  for (const width of [320, 390, 1440]) {
    for (const mode of ['runtime', 'no-js', 'missing-data']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: mode !== 'no-js' });
      await context.route('https://**/*', route => route.abort());
      if (mode === 'missing-data') await context.route('**/assets/js/content.js', route => route.fulfill({ body: 'window.TAEJANG_CONTENT = { activities: [] };', contentType: 'text/javascript' }));
      const page = await context.newPage();
      for (const [file, expected] of [['community-esg.html', order.slice(0, 3)], ['community-esg-records.html', order]]) {
        await page.goto(`${origin}/${file}`, { waitUntil: 'load' });
        const cards = page.locator('.community-esg-record');
        assert.equal(await cards.count(), expected.length);
        const links = await cards.locator('a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
        assert.deepEqual(links, expected.map(id => `activities/environment-cleanup-${id}.html`));
        // Lazy images outside Chrome's current loading distance are deliberately
        // not fetched yet. Bring each into view before checking actual decoding.
        for (const image of await cards.locator('img').all()) {
          await image.scrollIntoViewIfNeeded();
          if (mode === 'no-js') {
            // Full Chrome can leave decode() promises pending with scripting off;
            // the completed navigation already waits for these non-lazy images.
            assert.ok(await image.evaluate(img => img.complete && img.naturalWidth > 0));
          } else {
            await image.evaluate(img => img.decode(), undefined, { timeout: 15000 });
          }
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${file} ${width}px ${mode}: no overflow`);
        if (file === 'community-esg.html') {
          assert.equal(await page.getByRole('link', { name: '환경정비 활동 더보기', exact: false }).count(), 2);
          if (width === 1440) {
            const tops = await cards.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
            assert.ok(Math.max(...tops) - Math.min(...tops) < 1, 'latest three appear on one desktop row');
          }
        }
        await cards.first().scrollIntoViewIfNeeded();
        if (mode === 'runtime') await page.screenshot({ path: path.join(output, `${file}-${width}.png`) });
        console.log(`PASS ${width}px ${mode} ${file}`);
      }
      await context.close();
    }
  }
  const page = await browser.newPage();
  await page.route('https://**/*', route => route.abort());
  await page.goto(`${origin}/community-esg.html`);
  await page.getByRole('link', { name: '환경정비 활동 더보기', exact: false }).first().click();
  assert.match(page.url(), /community-esg-records\.html$/);
  for (const word of ['fifth', 'fourth']) {
    await page.locator(`.community-esg-record a[href="activities/environment-cleanup-${word}.html"]`).click();
    const image = page.locator('.article-representative-media img');
    await image.evaluate(img => img.decode());
    assert.equal(await image.getAttribute('src'), `assets/images/archive/environment-cleanup-${word}.webp`);
    await page.locator('.back-link--bottom').click();
    assert.match(page.url(), /community-esg-records\.html$/);
  }
  console.log('PASS: 320/390/1440px; runtime/no-JS/missing-data; latest 3/full 5; both more links; both new details and return links; images load; desktop row; no overflow');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
