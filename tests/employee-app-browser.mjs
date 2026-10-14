import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve('dist');
const output = process.env.EMPLOYEE_APP_QA_OUTPUT || path.join(os.tmpdir(), 'taejang-employee-app-qa');
await fs.mkdir(output, { recursive: true });

const types = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'], ['.png', 'image/png'],
  ['.webp', 'image/webp'], ['.svg', 'image/svg+xml']
]);
const server = http.createServer(async (req, res) => {
  try {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = requested === '/' ? '/index.html' : requested;
    const file = path.resolve(root, '.' + relative);
    if (!file.startsWith(root + path.sep)) throw new Error('invalid path');
    const body = await fs.readFile(file);
    res.setHeader('Content-Type', types.get(path.extname(file)) || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await playwright.chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' })
  });
  for (const [name, width, height, expectedColumns] of [
    ['pc', 1440, 900, 2],
    ['mobile', 390, 844, 1],
    ['narrow', 320, 720, 1]
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(base + '/employee-app.html', { waitUntil: 'domcontentloaded' });
    assert.equal(response?.status(), 200, name + ': HTML route must resolve');
    await page.locator('#developer-notes .employee-app-note').last().waitFor();
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.locator('.employee-app-feature').count(), 3);
    assert.equal(await page.locator('.employee-app-note').count(), 2);
    const metric = await page.evaluate(() => {
      const notes = document.querySelector('.employee-app-notes-grid');
      return {
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        columns: getComputedStyle(notes).gridTemplateColumns.trim().split(/\s+/).length,
        stylesLoaded: getComputedStyle(notes).display === 'grid',
        motion: getComputedStyle(document.documentElement).scrollBehavior,
        overflow: [...document.querySelectorAll('main *, header *, footer *')]
          .filter(el => { const box = el.getBoundingClientRect(); return box.width > 0 && (box.right > innerWidth + 1 || box.left < -1); })
          .slice(0, 6).map(el => el.tagName + '.' + el.className)
      };
    });
    assert.ok(metric.document <= metric.viewport + 1, name + ': horizontal overflow: ' + JSON.stringify(metric));
    assert.deepEqual(metric.overflow, [], name + ': elements off-screen: ' + JSON.stringify(metric));
    assert.equal(metric.stylesLoaded, true, name + ': styles must load');
    assert.equal(metric.columns, expectedColumns, name + ': responsive note layout');
    assert.equal(metric.motion, 'auto', name + ': reduced-motion preference');
    assert.deepEqual(errors, [], name + ': uncaught browser errors');
    await page.screenshot({ path: path.join(output, 'employee-app-' + width + '.png'), fullPage: true });
    if (width < 1000) {
      const menu = page.locator('[data-menu-button]');
      await menu.click();
      assert.equal(await menu.getAttribute('aria-expanded'), 'true', name + ': mobile menu expands');
      assert.equal(await page.locator('#mobile-nav').isVisible(), true);
      await menu.click();
      assert.equal(await menu.getAttribute('aria-expanded'), 'false', name + ': mobile menu closes');
    }
    await page.locator('a[href="#developer-notes"]').click();
    assert.equal(new URL(page.url()).hash, '#developer-notes', name + ': developer notes jump link works');
    console.log('PASS employee app landing: ' + name + ', width=' + width + ', notes=' + metric.columns + ' columns');
    await context.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
