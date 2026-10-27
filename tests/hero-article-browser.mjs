import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(process.env.HERO_QA_ROOT || 'dist');
const output = process.env.HERO_QA_OUTPUT || path.join(os.tmpdir(), 'taejang-hero-qa');
await fs.mkdir(output, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.webp': 'image/webp', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = process.env.HERO_QA_BASE || `http://127.0.0.1:${server.address().port}`;
const articleUrl = 'https://www.gyeongnam.go.kr/gonggam/index.gyeong?menuCd=DOM_000001514000000000&ggSeq=41900&gg_depth1=12&gg_depth2=02&ggVolumeAndNewOldStatus=163%3ANEW#snsClose';
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) });
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    // Test the actual click and iframe lifecycle without depending on third-party
    // article/YouTube transport. This does not claim live video/audio playback.
    await context.route('https://www.youtube-nocookie.com/**', route => route.fulfill({ body: '<title>Isolated video transport</title>', contentType: 'text/html' }));
    await context.route('https://www.gyeongnam.go.kr/**', route => route.fulfill({ body: '<title>Article link destination fixture</title>', contentType: 'text/html' }));
    const page = await context.newPage();
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    const slider = page.locator('[data-hero-video-slider]');
    const article = slider.locator('.hero-article-link');
    const photo = article.locator('img');
    await photo.evaluate(img => img.decode());
    assert.equal(await slider.getAttribute('data-hero-video-active'), '0');
    assert.equal(await article.isVisible(), true);
    assert.equal(await article.getAttribute('href'), articleUrl);
    assert.match(await article.getAttribute('rel'), /noopener/);
    assert.equal(await slider.locator('a a').count(), 0);
    const geometry = await photo.evaluate(img => ({ width: img.width, height: img.height, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }));
    assert.ok(Math.abs(geometry.width / geometry.height - geometry.naturalWidth / geometry.naturalHeight) < .02, 'photo retains full uncropped aspect ratio');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow');
    if (width > 760) {
      const heroBox = await page.locator('.hero--neutral').boundingBox();
      const factsBox = await page.locator('.hero-facts').boundingBox();
      const sliderBox = await slider.boundingBox();
      assert.ok(Math.abs(heroBox.y + heroBox.height - factsBox.y - factsBox.height - 32) < 1,
        'desktop facts retain 32px of green space before the next section');
      assert.ok(factsBox.y >= sliderBox.y + sliderBox.height,
        'desktop facts do not overlap the article or video slider');
    }
    const caption = article.locator('figcaption');
    assert.equal(await caption.evaluate(el => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1), true);
    await article.focus();
    assert.equal(await article.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    await page.screenshot({ path: path.join(output, `hero-${width}.png`), fullPage: false });
    for (const target of [photo, article.locator('strong')]) {
      const opened = context.waitForEvent('page');
      await target.click();
      const popup = await opened;
      await popup.waitForURL(articleUrl, { waitUntil: 'domcontentloaded' });
      await popup.waitForLoadState('domcontentloaded');
      assert.equal(popup.url(), articleUrl);
      await popup.close();
    }
    const initialHeight = (await slider.boundingBox()).height;
    await page.screenshot({ path: path.join(output, `hero-${width}.png`), fullPage: false });
    for (const [indicator, id] of [[1, 'FbEOcteBSJ4'], [2, '8x7yg5YBK9g']]) {
      await slider.locator(`[data-hero-video-indicator="${indicator}"]`).click();
      const active = slider.locator(`[data-youtube-video="${id}"]`);
      assert.equal(await active.isVisible(), true);
      assert.ok(Math.abs((await slider.boundingBox()).height - initialHeight) < 1, 'slide changes do not shift card height');
      await active.locator('[data-youtube-play]').click();
      const playerUrl = new URL(await active.locator('iframe').getAttribute('src'));
      assert.equal(playerUrl.pathname, `/embed/${id}`);
      assert.equal(playerUrl.searchParams.get('autoplay'), '1');
      await slider.locator('[data-hero-video-next]').click();
      assert.equal(await slider.locator('iframe').count(), 0, 'leaving video destroys player to stop playback');
      assert.equal(await active.locator('[data-youtube-play]').count(), 1);
    }
    await slider.locator('[data-hero-video-indicator="0"]').click();
    await article.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await slider.getAttribute('data-hero-video-active'), '1');
    assert.equal(await slider.evaluate(el => document.activeElement === el), true, 'focus leaves hidden article link');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await slider.getAttribute('data-hero-video-active'), '0');
    await slider.evaluate(el => {
      const dispatch = (type, clientX) => el.dispatchEvent(new TouchEvent(type, {
        changedTouches: [new Touch({ identifier: 1, target: el, clientX })], bubbles: true,
      }));
      dispatch('touchstart', 250);
      dispatch('touchend', 100);
    });
    assert.equal(await slider.getAttribute('data-hero-video-active'), '1');
    console.log(`PASS ${width}px: uncropped photo, readable caption, both link clicks, stable height, keyboard, swipe, two video iframe lifecycles`);
    await context.close();
  }
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('.hero-article-link').isVisible(), true, 'article remains usable without JavaScript');
  assert.equal(await page.locator('.hero-article-link').getAttribute('href'), articleUrl);
  await context.close();
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
