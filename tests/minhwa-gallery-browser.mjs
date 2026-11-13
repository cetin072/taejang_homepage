import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { newPhotoSafeContext } from './helpers/photo-safe-browser.mjs';

const root = path.resolve('dist');
const output = path.resolve(process.env.MINHWA_QA_OUTPUT || 'minhwa-qa/local');
await fs.mkdir(output, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!target.startsWith(root + path.sep)) throw new Error('Invalid path');
    res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
    res.end(await fs.readFile(target));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = (process.env.MINHWA_QA_BASE || 'http://127.0.0.1:' + server.address().port).replace(/\/$/, '');
const results = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) });
  for (const [width, javaScriptEnabled] of [[1440,true],[1001,true],[768,true],[390,true],[320,true],[1440,false],[390,false]]) {
    const context = await newPhotoSafeContext(browser, { viewport: { width, height: 960 }, javaScriptEnabled, reducedMotion: 'reduce' });
    // Explicit fallback scenario, not a claim that blocked Google Fonts loaded.
    // Normal JS-on viewports below continue to fetch and render the real fonts.
    if (!javaScriptEnabled) await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort('blockedbyclient'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(base + '/minhwa-gallery.html', { waitUntil: 'load', timeout: 90000 });
    assert.equal(response.status(), 200);
    try {
      await page.waitForFunction(allowFontFallback => [...document.querySelectorAll('link[rel="stylesheet"]')]
        .filter(link => !allowFontFallback || new URL(link.href).origin === location.origin)
        .every(link => link.sheet), !javaScriptEnabled, { polling: 100, timeout: 30000 });
    } catch (error) {
      await fs.writeFile(path.join(output, `css-failure-${width}-${javaScriptEnabled}.json`), JSON.stringify(await page.locator('link[rel="stylesheet"]').evaluateAll(links => links.map(link => ({ href: link.href, loaded: !!link.sheet }))), null, 2));
      throw error;
    }
    await page.evaluate(() => document.fonts.ready);
    for (const image of await page.locator('main img').all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate(img => new Promise((resolve, reject) => {
        if (img.complete) return img.naturalWidth > 0 ? resolve() : reject(new Error('Broken image: ' + img.src));
        const timer = setTimeout(() => reject(new Error('Image load timeout: ' + img.src)), 20000);
        img.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
        img.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Image failed: ' + img.src)); }, { once: true });
      }));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, `minhwa-${width}-${javaScriptEnabled ? 'js' : 'nojs'}-full.png`), fullPage: true });
    await page.screenshot({ path: path.join(output, `minhwa-${width}-${javaScriptEnabled ? 'js' : 'nojs'}-top.png`) });
    const metrics = await page.evaluate(() => ({
      viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      clipped: [...document.querySelectorAll('main h1,main h2,main h3,main p,main a')]
        .filter(el => el.clientWidth > 0 && getComputedStyle(el).display !== 'inline' && el.scrollWidth > el.clientWidth + 2)
        .map(el => ({ selector: el.className, text: el.textContent.slice(0, 60), width: el.clientWidth, content: el.scrollWidth })),
      images: [...document.querySelectorAll('main img')].map(img => ({ src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0 })),
      ids: [...document.querySelectorAll('[id]')].map(el => el.id)
    }));
    await fs.writeFile(path.join(output, `metrics-${width}-${javaScriptEnabled}.json`), JSON.stringify(metrics, null, 2));
    assert.ok(metrics.scrollWidth <= metrics.viewport + 1, 'Horizontal overflow: ' + JSON.stringify(metrics));
    assert.deepEqual(metrics.clipped, [], 'Text must not clip: ' + JSON.stringify(metrics.clipped));
    assert.ok(metrics.images.every(img => img.loaded));
    assert.equal(new Set(metrics.ids).size, metrics.ids.length);
    assert.equal(await page.locator('h1').innerText(), '태장 민화');
    const hero = page.locator('.mh-hero');
    if (width <= 860) {
      const copyBounds = await hero.locator('.mh-hero-copy').boundingBox();
      const photoBounds = await hero.locator('.mh-hero-image').boundingBox();
      assert.ok(copyBounds.y + copyBounds.height <= photoBounds.y + 1, 'Hero title and actions appear above the photo on mobile');
    }
    await hero.getByRole('link', { name: '작품 둘러보기', exact: true }).click();
    await page.waitForURL(url => url.hash === '#mh-gallery');
    for (const id of ['mh-artist','mh-gallery','mh-programs','mh-goods']) {
      const link = page.locator(`.mh-paths a[href="#${id}"]`);
      await link.focus(); await link.press('Enter');
      await page.waitForURL(url => url.hash === '#' + id);
      assert.ok(await page.locator('#' + id).isVisible());
    }
    if (width <= 1000) {
      if (javaScriptEnabled) {
        await page.locator('[data-menu-button]').click();
        assert.equal(await page.locator('[data-menu-button]').getAttribute('aria-expanded'), 'true');
        assert.ok(await page.locator('[data-mobile-nav]').isVisible());
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('[data-menu-button]').getAttribute('aria-expanded'), 'false');
      } else {
        assert.ok(await page.locator('[data-mobile-nav]').isVisible(), 'Static mobile links survive no JS');
      }
    }
    // Netlify may rewrite authored .html hrefs to pretty paths. Check the exact
    // destination and use the accessible link instead of a raw-href selector.
    const storyLink = page.locator('#mh-story').getByRole('link', { name: '태장 민화의 시작 이야기', exact: true });
    assert.match(new URL(await storyLink.getAttribute('href'), page.url()).pathname, /^\/why-minhwa(?:\.html)?$/);
    await storyLink.focus(); await storyLink.press('Enter');
    await page.waitForURL(url => /\/why-minhwa(?:\.html)?$/.test(url.pathname));
    assert.equal((await page.request.get(page.url())).status(), 200);
    await page.goBack();
    assert.match(new URL(page.url()).pathname, /\/minhwa-gallery(?:\.html)?$/);
    const contactLink = page.getByRole('link', { name: '작가 협업 문의', exact: true });
    const dialog = page.locator('#home-inquiry-dialog');
    const form = dialog.locator('form[name="taejang-minhwa-inquiry"]');
    assert.equal(await dialog.isVisible(), !javaScriptEnabled);
    await contactLink.press('Enter');
    assert.ok(await form.isVisible());
    assert.equal(await form.evaluate(element => element.checkValidity()), false);
    if (javaScriptEnabled) {
      assert.equal(await dialog.evaluate(element => element.matches(':modal')), true);
      assert.notEqual(new URL(page.url()).hash, '#mh-contact');
      const message = form.locator('textarea');
      await message.fill('민화 문의 팝업 검수');
      await message.press('Escape');
      assert.equal(await dialog.isVisible(), false);
      assert.equal(await contactLink.evaluate(element => document.activeElement === element), true);
      await page.getByRole('link', { name: '민화 문의하기', exact: true }).click();
      assert.equal(await message.inputValue(), '민화 문의 팝업 검수');
      await dialog.getByRole('button', { name: '문의창 닫기' }).click();
      for (const name of ['민화 문의', '기관·단체 출강 문의', '굿즈·주문제작 문의']) {
        const trigger = page.getByRole('link', { name, exact: true });
        await trigger.click();
        assert.equal(await dialog.evaluate(element => element.matches(':modal')), true);
        await page.keyboard.press('Escape');
        assert.equal(await dialog.isVisible(), false);
        assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
      }
    } else {
      await page.waitForURL(url => url.hash === '#mh-contact');
    }

    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: '태장 민화 보기', exact: true }).click();
    await page.waitForURL(url => /\/minhwa-gallery(?:\.html)?$/.test(url.pathname));
    await page.goBack();
    await page.getByRole('link', { name: '태장 민화 알아보기', exact: true }).click();
    await page.waitForURL(url => /\/minhwa-gallery(?:\.html)?$/.test(url.pathname));

    await page.goto(base + '/resources.html', { waitUntil: 'load' });
    const card = page.locator('[aria-labelledby="resource-minhwa-title"]');
    assert.equal(await card.locator('.resource-status').innerText(), '준비 중');
    await card.focus(); await card.press('Enter');
    await page.waitForURL(url => /\/minhwa-gallery(?:\.html)?$/.test(url.pathname));
    assert.equal((await page.request.get(page.url())).status(), 200);
    assert.deepEqual(errors, [], 'Uncaught page errors');
    results.push({ width, javaScriptEnabled, externalFontFallback: !javaScriptEnabled, overflow: false, clipped: false, images: metrics.images.length, navigation: 'pass', formsSubmitted: false });
    await context.close();
  }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ base, results, writes: false }, null, 2));
  console.log('PASS minhwa visual QA: ' + JSON.stringify({ base, results }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
