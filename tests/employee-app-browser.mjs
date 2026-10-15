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
async function assertMenuStyle(link, background, name) {
  const style = await link.evaluate(el => {
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor, border: s.borderTopColor, width: s.borderTopWidth };
  });
  assert.equal(style.color, 'rgb(27, 67, 50)', name + ': clear dark-green text');
  assert.equal(style.background, background, name + ': secondary background');
  assert.equal(style.border, 'rgb(196, 214, 199)', name + ': soft green border');
  assert.equal(style.width, '1px', name + ': thin border');
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
    assert.equal(await page.locator('a.employee-app-note-link').count(), 0);
    assert.equal(await page.locator('.employee-app-principle-list svg rect').count(), 1, 'use a phone-style icon instead of the old person glyph');
    assert.equal(await page.locator('header .desktop-nav .employee-app-nav').count(), 1);
    assert.equal(await page.locator('header .mobile-nav .employee-app-nav').count(), 1);
    const currentLink = page.locator('header .desktop-nav .employee-app-nav');
    const routeDebug = await page.evaluate(() => ({
      path: location.pathname,
      menuLink: document.querySelector('header .desktop-nav .employee-app-nav')?.getAttribute('href')
    }));
    assert.equal(await currentLink.getAttribute('aria-current'), 'page',
      name + ': active employee-app menu on actual route ' + JSON.stringify(routeDebug));
    await assertMenuStyle(currentLink, 'rgb(234, 243, 238)', name + ': desktop current page');
    const mobileOrder = await page.locator('header .mobile-nav > a').evaluateAll(els => els.map(el => ({
      label: el.textContent.trim(), href: el.getAttribute('href')
    })));
    const mobileStaffIndex = mobileOrder.findIndex(item => item.href === 'staff/');
    const mobileGuideIndex = mobileOrder.findIndex(item => /employee-app(?:\.html)?$/.test(item.href || ''));
    assert.equal(mobileGuideIndex, mobileStaffIndex + 1, name + ': mobile app guide follows staff login');
    assert.equal(mobileGuideIndex, mobileOrder.length - 1, name + ': mobile app guide is the last menu item');
    if (width > 1000) {
      const header = await page.locator('.desktop-nav').evaluate(el => {
        const links = [...el.querySelectorAll('a')].map(a => a.getBoundingClientRect());
        return { overlap: links.some((box, i) => i > 0 && box.left < links[i - 1].right),
          sameRow: links.every(box => Math.abs((box.top + box.bottom) / 2 - (links[0].top + links[0].bottom) / 2) < 2),
          contact: getComputedStyle(el.querySelector('.nav-cta')).backgroundColor };
      });
      assert.equal(header.overlap, false, name + ': desktop links do not overlap');
      assert.equal(header.sameRow, true, name + ': desktop links stay on one row');
      assert.equal(header.contact, 'rgb(45, 106, 79)', name + ': contact CTA retains priority');
    }
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
    assert.equal(await page.locator('.employee-app-note-link').count(), 0, name + ': no misleading self-links');
    assert.equal(await page.locator('#note-attendance h3').innerText(), '출퇴근 버튼을 더 쉽게');
    assert.equal(await page.locator('#note-notice h3').innerText(), '공지사항을 더 단순하게');
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
      const mobileStyle = await mobileAppLink.evaluate(el => {
        const s = getComputedStyle(el);
        const nav = el.closest('.mobile-nav');
        return {
          background: s.backgroundColor, borderLeftWidth: s.borderLeftWidth,
          borderLeftColor: s.borderLeftColor, color: s.color,
          contact: getComputedStyle(nav.querySelector('a[href="partnership.html"]')).backgroundColor
        };
      });
      assert.equal(mobileStyle.background, 'rgba(0, 0, 0, 0)', name + ': app guide has no button fill');
      assert.equal(mobileStyle.borderLeftWidth, '2px', name + ': app guide is indented with a fine divider');
      assert.equal(mobileStyle.borderLeftColor, 'rgb(196, 214, 199)', name + ': subtle divider');
      assert.equal(mobileStyle.color, 'rgb(27, 67, 50)', name + ': app guide readable');
      assert.equal(mobileStyle.contact, 'rgb(45, 106, 79)', name + ': contact is the primary mobile CTA');
      assert.equal(await mobileAppLink.isVisible(), true);
      if (name === 'mobile') {
        await page.screenshot({ path: path.join(output, 'homepage-app-menu-mobile.png') });
      }
      await mobileAppLink.click();
    } else {
      assert.equal(await desktopAppLink.isVisible(), true);
      await assertMenuStyle(desktopAppLink, 'rgb(245, 240, 232)', name + ': desktop default');
      await desktopAppLink.hover();
      await page.waitForTimeout(250);
      await assertMenuStyle(desktopAppLink, 'rgb(234, 243, 238)', name + ': hover');
      await page.mouse.move(0, 0);
      await desktopAppLink.focus();
      await page.waitForTimeout(250);
      await assertMenuStyle(desktopAppLink, 'rgb(234, 243, 238)', name + ': focus');
      assert.equal(await desktopAppLink.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
      await desktopAppLink.click();
    }
    await page.waitForURL(url => isLandingRoute(url.href));
    assert.ok(isLandingRoute(page.url()), name + ': homepage header opens landing');
    results.push({ name, width, footerHref, ...metric, ...visual, pass: true });
    console.log('PASS employee landing + homepage: ' + name);
    await context.close();
  }
  // Exercise the actual sign-in panel with a local-only public config mock: no credentials or Auth requests.
  for (const [name, width, height] of [['pc', 1440, 900], ['mobile', 390, 844], ['narrow', 320, 720]]) {
    const staffContext = await browser.newContext({ viewport: { width, height } });
    await staffContext.addInitScript(() => {
      window.TAEJANG_STAFF_CONFIG = { url: 'https://unused.invalid', publishableKey: 'test-public-config-only' };
    });
    const staffPage = await staffContext.newPage();
    const visit = await staffPage.goto(base + '/staff/index.html', { waitUntil: 'domcontentloaded' });
    assert.equal(visit?.status(), 200, name + ': staff login route works');
    await staffPage.locator('#login-panel').waitFor({ state: 'visible', timeout: 10000 });
    assert.ok(await staffPage.locator('#login-form input[name="email"]').isVisible(), name + ': username remains visible');
    assert.ok(await staffPage.locator('#login-form input[name="password"]').isVisible(), name + ': password remains visible');
    const guide = staffPage.locator('#login-panel .staff-app-guide');
    assert.equal(await guide.count(), 1, name + ': one app introduction inside sign-in');
    const appLink = guide.getByRole('link', { name: /직원앱 소개·이용 안내 보기/ });
    assert.ok(await appLink.isVisible(), name + ': app introduction is visible and not another login button');
    assert.ok((await appLink.boundingBox()).height >= 44, name + ': app guide meets touch target');
    assert.ok(isLandingRoute(new URL(await appLink.getAttribute('href'), staffPage.url()).href), name + ': app guide goes to the landing page');
    const authBefore = await staffPage.locator('#login-form input').evaluateAll(inputs => inputs.map(input => input.value));
    assert.ok(authBefore.every(value => !value), name + ': do not fill any real credentials');
    await staffPage.screenshot({ path: path.join(output, 'staff-login-app-guide-' + name + '.png'), fullPage: true });
    await appLink.click();
    await staffPage.waitForURL(url => isLandingRoute(url.href));
    assert.ok(isLandingRoute(staffPage.url()), name + ': app link navigates to landing without submitting the form');
    await staffContext.close();
    console.log('PASS staff login app guide: ' + name);
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
    const s = getComputedStyle(el); return { name: s.animationName, count: s.animationIterationCount, fill: s.animationFillMode, duration: s.animationDuration, delay: s.animationDelay };
  });
  assert.equal(motion.name, 'employee-app-arrive');
  assert.equal(motion.count, '1');
  assert.equal(motion.fill, 'none');
  assert.equal(motion.duration, '3.2s', 'hero components should appear noticeably slower');
  assert.equal(motion.delay, '1.15s', 'hero cards should appear in a relaxed sequence');
  for (const [selector, delay] of [
    ['.employee-app-art-arrive', '0.15s'],
    ['.employee-app-art-notice', '1.15s'],
    ['.employee-app-art-leave', '2.15s']
  ]) {
    const timing = await motionPage.locator(selector).evaluate(el => {
      const style = getComputedStyle(el);
      return { duration: style.animationDuration, delay: style.animationDelay, count: style.animationIterationCount };
    });
    assert.deepEqual(timing, { duration: '3.2s', delay, count: '1' }, selector + ': slow, finite hero animation');
  }
  for (const [index, delay] of [[0, '0.35s'], [1, '1.1s'], [2, '1.85s']]) {
    const timing = await motionPage.locator('.employee-app-feature-art').nth(index).evaluate(el => {
      const style = getComputedStyle(el);
      return { duration: style.animationDuration, delay: style.animationDelay, count: style.animationIterationCount };
    });
    assert.deepEqual(timing, { duration: '2.4s', delay, count: '1' }, 'guide illustration follows slower one-time pacing');
  }
  await motionPage.waitForTimeout(1750);
  assert.ok(await motionPage.evaluate(() => document.getAnimations().length > 0), 'motion still running during first seconds');
  await motionPage.screenshot({ path: path.join(output, 'employee-app-motion-in-progress.png') });
  await motionPage.waitForFunction(() => document.getAnimations().length === 0, undefined, { timeout: 9000 });
  assert.equal(await motionPage.evaluate(() => document.getAnimations().length), 0, 'all motion finishes');
  const finalArt = await motionPage.locator('.employee-app-art-arrive, .employee-app-art-notice, .employee-app-art-leave').evaluateAll(els => els.map(el => ({ opacity: getComputedStyle(el).opacity, transform: getComputedStyle(el).transform })));
  assert.equal(finalArt.length, 3);
  assert.ok(finalArt.every(s => s.opacity === '1' && s.transform === 'none'), 'all hero artwork remains opaque at its final position');
  await motionPage.screenshot({ path: path.join(output, 'employee-app-motion-finished.png'), fullPage: true });
  await assertLayout(motionPage, 'motion-finished');
  // Text-only enlargement catches fixed-height clipping independently of viewport reflow.
  await motionPage.addStyleTag({ content: 'main p, main dd, main dt, main a, main h3 { font-size: 200% !important; }' });
  await assertLayout(motionPage, 'text-200');
  await motionPage.screenshot({ path: path.join(output, 'employee-app-text-200.png'), fullPage: true });
  await normal.close();
  if (process.env.EMPLOYEE_APP_QA_BASE) {
    const cleanPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await cleanPage.goto(base + '/employee-app', { waitUntil: 'networkidle' });
    assert.ok(isLandingRoute(cleanPage.url()), 'hosted clean URL stays on landing');
    const cleanMenu = cleanPage.locator('.desktop-nav .employee-app-nav');
    assert.equal(await cleanMenu.getAttribute('aria-current'), 'page', 'hosted clean URL current menu');
    await assertMenuStyle(cleanMenu, 'rgb(234, 243, 238)', 'hosted clean URL');
    await cleanPage.screenshot({ path: path.join(output, 'employee-app-clean-url.png') });
    await cleanPage.close();
  }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ base, results, noJS: true, finiteMotion: motion, text200: true }, null, 2));
  console.log('PASS no-JS navigation/content, finite motion, 200% text enlargement');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
