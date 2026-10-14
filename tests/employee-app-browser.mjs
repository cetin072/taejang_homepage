import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
// Fail closed if the hosted workflow accidentally falls back to the local server.
if (process.env.EMPLOYEE_APP_QA_REQUIRE_HOSTED === '1') {
  assert.match(process.env.EMPLOYEE_APP_QA_BASE || '', /^https:\/\//, 'hosted QA requires an explicit HTTPS Preview URL');
}
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
    const file = path.resolve(root, '.' + (requested === '/' ? '/index.html' : requested));
    if (!file.startsWith(root + path.sep)) throw new Error('invalid path');
    res.setHeader('Content-Type', types.get(path.extname(file)) || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
// Optional hosted base runs the same checks on the real Deploy Preview; no writes/API mutations.
const base = process.env.EMPLOYEE_APP_QA_BASE || 'http://127.0.0.1:' + server.address().port;
const results = [];
const landingLink = (page, region = 'footer') => page.locator(region).getByRole('link', { name: '직원앱 소개', exact: true });
const isLandingRoute = url => /\/employee-app(?:\.html)?\/?$/.test(new URL(url).pathname);
async function assertLayout(page, name) {
  const metric = await page.evaluate(() => ({
    viewport: innerWidth, document: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll('main *, header *, footer *')]
      .filter(el => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1); })
      .slice(0, 8).map(el => el.tagName + '.' + el.getAttribute('class')),
    clipped: [...document.querySelectorAll('main h1, main h2, main h3, main p, main dd, main a')]
      .filter(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline')
      .map(el => el.textContent.slice(0, 50))
  }));
  assert.ok(metric.document <= metric.viewport + 1, name + ': horizontal overflow: ' + JSON.stringify(metric));
  assert.deepEqual(metric.overflow, [], name + ': off-screen elements');
  assert.deepEqual(metric.clipped, [], name + ': clipped text');
  return metric;
}
let browser;
try {
  browser = await playwright.chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' })
  });
  for (const [name, width, height] of [
    ['pc', 1440, 900], ['desktop-min', 1001, 900], ['desktop-medium', 1120, 900],
    ['tablet', 768, 1024], ['mobile', 390, 844], ['narrow', 320, 720],
    // CSS viewport equivalent to desktop 1440 at 200%/400%; not a physical-device claim.
    ['reflow-200', 720, 450], ['reflow-400', 360, 225]
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(base + '/employee-app.html', { waitUntil: 'networkidle' });
    assert.equal(response?.status(), 200, name + ': HTML route');
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.locator('.employee-app-feature').count(), 3);
    assert.equal(await page.locator('.employee-app-note').count(), 2);
    assert.equal(await page.locator('.employee-app-note-flow dt').count(), 6);
    assert.equal(await page.locator('header .desktop-nav .employee-app-nav').count(), 1);
    assert.equal(await page.locator('header .mobile-nav .employee-app-nav').count(), 1);
    assert.equal(await page.locator('header .desktop-nav .employee-app-nav').getAttribute('aria-current'), 'page');
    const metric = await assertLayout(page, name);
    const visual = await page.evaluate(() => {
      const columns = selector => getComputedStyle(document.querySelector(selector)).gridTemplateColumns.trim().split(/\s+/).length;
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      return {
        features: columns('.employee-app-feature-grid'), flow: columns('.employee-app-note-flow'),
        heroCopy: box('.employee-app-hero-copy').bottom, heroArt: box('.employee-app-hero-art').top,
        heroArtBottom: box('.employee-app-hero-art').bottom, heroButton: box('.employee-app-hero-link').top,
        motion: getComputedStyle(document.documentElement).scrollBehavior,
        animations: document.getAnimations().length
      };
    });
    assert.equal(visual.features, width <= 760 ? 1 : 3);
    assert.equal(visual.flow, width <= 760 ? 1 : 3);
    if (width <= 760) {
      assert.ok(visual.heroCopy <= visual.heroArt && visual.heroArtBottom <= visual.heroButton, name + ': mobile title → description → illustration → button');
    }
    assert.equal(visual.motion, 'auto');
    assert.equal(visual.animations, 0, name + ': reduced motion disables all landing motion');
    const positions = () => page.locator('.employee-app-hero-layout, .employee-app-feature-grid, .employee-app-timeline').evaluateAll(els => els.map(el => { const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; }));
    const before = await positions();
    await page.waitForTimeout(300);
    assert.deepEqual(await positions(), before, name + ': stable layout');
    await page.screenshot({ path: path.join(output, 'employee-app-' + name + '.png'), fullPage: true });
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.skip-link').evaluate(el => el === document.activeElement), true, name + ': keyboard skip link');
    await page.keyboard.press('Enter');
    await page.waitForURL(url => url.hash === '#main-content');
    assert.equal(new URL(page.url()).hash, '#main-content');
    await page.locator('.employee-app-hero-link').focus();
    assert.equal(await page.locator('.employee-app-hero-link').evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    assert.ok((await page.locator('.employee-app-hero-link').boundingBox()).height >= 44);
    await page.keyboard.press('Enter');
    await page.waitForURL(url => url.hash === '#developer-notes');
    assert.equal(new URL(page.url()).hash, '#developer-notes');
    if (width < 1000) {
      const menu = page.locator('[data-menu-button]');
      await menu.focus();
      await page.keyboard.press('Enter');
      assert.equal(await menu.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('#mobile-nav').isVisible(), true);
      await page.keyboard.press('Escape');
      assert.equal(await menu.getAttribute('aria-expanded'), 'false');
      assert.equal(await menu.evaluate(el => el === document.activeElement), true);
      assert.ok((await menu.boundingBox()).width >= 44);
    }
    await page.locator('.employee-app-note-link').first().focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(url => url.hash === '#note-attendance');
    assert.equal(new URL(page.url()).hash, '#note-attendance');
    const footerHref = await landingLink(page).getAttribute('href');
    assert.ok(isLandingRoute(new URL(footerHref, page.url()).href), name + ': footer resolves to the employee-app route');
    await landingLink(page).focus();
    assert.equal(await landingLink(page).evaluate(el => getComputedStyle(el).outlineColor), 'rgb(255, 255, 255)', name + ': visible focus on dark footer');
    assert.deepEqual(errors, [], name + ': uncaught browser errors');
    // Regression: shared homepage footer entry and header/menu still work.
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    const desktopAppLink = page.locator('header .desktop-nav a.employee-app-nav');
    const mobileAppLink = page.locator('header .mobile-nav a.employee-app-nav');
    assert.equal(await desktopAppLink.count(), 1, name + ': desktop header includes employee app');
    assert.equal(await mobileAppLink.count(), 1, name + ': mobile header includes employee app');
    assert.equal(await landingLink(page).count(), 1, name + ': legacy footer entry remains');
    if (name === 'pc') {
      await landingLink(page).click();
      await page.waitForURL(url => isLandingRoute(url.href));
      await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
      await page.screenshot({ path: path.join(output, 'homepage-app-menu-pc.png') });
    }
    if (width <= 1000) {
      await page.locator('[data-menu-button]').click();
      assert.equal(await page.locator('#mobile-nav').isVisible(), true);
      assert.equal(await mobileAppLink.isVisible(), true);
      if (name === 'mobile') {
        await page.screenshot({ path: path.join(output, 'homepage-app-menu-mobile.png') });
      }
      await mobileAppLink.click();
    } else {
      assert.equal(await desktopAppLink.isVisible(), true);
      assert.equal(await desktopAppLink.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(20, 124, 155)',
        name + ': employee app header is a visible blue button');
      await desktopAppLink.click();
    }
    await page.waitForURL(url => isLandingRoute(url.href));
    assert.ok(isLandingRoute(page.url()), name + ': homepage header opens landing');
    results.push({ name, width, footerHref, ...metric, ...visual, pass: true });
    console.log('PASS employee landing + homepage: ' + name);
    await context.close();
  }
  const noJS = await browser.newContext({ viewport: { width: 320, height: 720 }, javaScriptEnabled: false, reducedMotion: 'reduce' });
  const staticPage = await noJS.newPage();
  await staticPage.goto(base + '/employee-app.html');
  assert.equal(await staticPage.locator('#mobile-nav').isVisible(), true);
  for (const selector of ['.employee-app-hero-message', '.employee-app-note-flow', '.employee-app-feature']) {
    assert.equal(await staticPage.locator(selector).first().isVisible(), true);
  }
  await assertLayout(staticPage, 'no-JS');
  await staticPage.screenshot({ path: path.join(output, 'employee-app-no-js.png'), fullPage: true });
  await noJS.close();
  const normal = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
  const motionPage = await normal.newPage();
  await motionPage.goto(base + '/employee-app.html', { waitUntil: 'domcontentloaded' });
  const motion = await motionPage.locator('.employee-app-art-notice').evaluate(el => {
    const s = getComputedStyle(el); return { name: s.animationName, count: s.animationIterationCount, fill: s.animationFillMode };
  });
  assert.equal(motion.name, 'employee-app-arrive');
  assert.equal(motion.count, '1');
  assert.equal(motion.fill, 'none');
  await motionPage.waitForTimeout(1800);
  assert.equal(await motionPage.evaluate(() => document.getAnimations().length), 0, 'all motion finishes');
  await assertLayout(motionPage, 'motion-finished');
  // Text-only enlargement catches fixed-height clipping independently of viewport reflow.
  await motionPage.addStyleTag({ content: 'main p, main dd, main dt, main a, main h3 { font-size: 200% !important; }' });
  await assertLayout(motionPage, 'text-200');
  await motionPage.screenshot({ path: path.join(output, 'employee-app-text-200.png'), fullPage: true });
  await normal.close();
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ base, results, noJS: true, finiteMotion: motion, text200: true }, null, 2));
  console.log('PASS no-JS navigation/content, finite motion, 200% text enlargement');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
