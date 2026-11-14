import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve('dist');
const output = process.env.BUTTONS_QA_OUTPUT || '/tmp/public-buttons-qa';
await fs.mkdir(output, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    let pathname = new URL(req.url, 'http://localhost').pathname;
    if (!path.extname(pathname)) pathname += '.html';
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) throw Error('path');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const pages = [];
for (const name of await fs.readdir(root)) {
  if (name.endsWith('.html') && (await fs.readFile(path.join(root, name), 'utf8')).includes('page-link')) pages.push(name);
}
pages.push('workplace/packing-care.html', 'workplace/work-together.html', 'activities/environment-cleanup-first.html');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) });
try {
  for (const width of [320, 390, 768, 1440]) {
    // Navigation remains usable even if the optional page scripts fail.
    const context = await browser.newContext({ javaScriptEnabled: false, reducedMotion: 'reduce', viewport: { width, height: 900 } });
    await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const page = await context.newPage();
    for (const name of pages) {
      await page.goto(`${base}/${name}`, { waitUntil: 'load' });
      const links = await page.locator('main a.page-link').evaluateAll(es => es.map(e => {
        const r = e.getBoundingClientRect(), s = getComputedStyle(e);
        return { text: e.textContent.trim(), href: e.getAttribute('href'), x: r.x, right: r.right, height: r.height, width: r.width, border: s.borderTopWidth, radius: s.borderRadius, color: s.color, bg: s.backgroundColor, overflow: e.scrollWidth > e.clientWidth + 1 };
      }));
      assert.ok(links.length, `${name}: explicit navigation exists`);
      for (const link of links.filter(l => l.width)) {
        assert.ok(link.height >= 47.5 && link.height < 120, `${name} ${width}: touch height ${JSON.stringify(link)}`);
        assert.ok(link.x >= -1 && link.right <= width + 1 && !link.overflow, `${name} ${width}: unclipped ${JSON.stringify(link)}`);
        assert.equal(link.border, '1px', `${name}: border`);
        assert.equal(link.radius, '8px', `${name}: radius`);
        assert.equal(link.color, 'rgb(45, 106, 79)', `${name}: green text`);
        assert.equal(link.bg, 'rgb(255, 255, 255)', `${name}: white surface`);
        assert.ok(link.href && !link.href.startsWith('javascript:'), `${name}: actual href`);
      }
      assert.equal(await page.locator('header .page-link, footer .page-link, a.card-link .page-link, a.resource-card .page-link').count(), 0, `${name}: no boxed menus or nested actions`);
      if ([390, 1440].includes(width) && ['index.html', 'workplace.html', 'certifications.html', 'business.html', 'terrarium.html', 'minhwa-gallery.html', 'partnership.html'].includes(name)) {
        await page.screenshot({ path: path.join(output, `${name.replace('.html', '')}-${width}.png`), fullPage: true });
      }
    }
    await page.goto(`${base}/workplace.html`);
    const link = page.getByRole('link', { name: '포장·검수 과정 보기' });
    await link.focus();
    assert.equal(await link.evaluate(e => getComputedStyle(e).outlineStyle), 'solid');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/workplace/packing-care.html');
    console.log(`PASS ${width}px: ${pages.length} pages, compact targets, contrast, no clipping, focus and JS-off navigation`);
    await context.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
