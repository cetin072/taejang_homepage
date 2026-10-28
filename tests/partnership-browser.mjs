// Run after npm run build:netlify. Optional PREVIEW_URL repeats on actual PR Preview.
// Native POST is intercepted; this never creates a real inquiry or email.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const root = path.resolve('dist');
const output = process.env.PARTNERSHIP_QA_OUTPUT || path.join(os.tmpdir(), 'taejang-partnership-qa');
await fs.mkdir(output, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    let requested = new URL(req.url, 'http://localhost').pathname;
    if (!path.extname(requested)) requested += requested.endsWith('/') ? 'index.html' : '.html';
    const file = path.resolve(root, '.' + requested);
    if (!file.startsWith(root + path.sep)) throw Error('path');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = process.env.PREVIEW_URL || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : process.env.CI ? { channel: 'chrome' } : {}) });
const results = [];
const field = (page, name) => page.locator(`form [name="${name}"]`);
async function layout(page, label) {
  const metrics = await page.evaluate(() => ({
    width: innerWidth, document: document.documentElement.scrollWidth,
    offscreen: [...document.querySelectorAll('main *')].filter(el => {
      const b = el.getBoundingClientRect(); return !el.closest('.form-honeypot') && b.width && (b.right > innerWidth + 1 || b.left < -1);
    }).map(el => el.tagName + '.' + el.className),
    clipped: [...document.querySelectorAll('main h1, main h2, main h3, main p, main label > span')].filter(el => {
      return !el.closest('.form-honeypot') && el.clientWidth && el.scrollWidth > el.clientWidth + 1;
    }).map(el => el.tagName + ':' + el.textContent.slice(0, 40))
  }));
  assert.ok(metrics.document <= metrics.width + 1, label + JSON.stringify(metrics));
  assert.deepEqual(metrics.offscreen, [], label + ' offscreen');
  assert.deepEqual(metrics.clipped, [], label + ' clipped');
  return metrics;
}
async function ready(page) {
  const response = await page.goto(base + '/partnership.html', { waitUntil: 'load' });
  assert.equal(response.status(), 200);
  await page.evaluate(() => document.fonts.ready);
  for (const img of await page.locator('main img').all()) {
    await img.scrollIntoViewIfNeeded();
    await img.evaluate(el => el.decode());
    const dims = await img.evaluate(el => ({ actual: el.width / el.height, source: el.naturalWidth / el.naturalHeight }));
    assert.ok(Math.abs(dims.actual - dims.source) < 0.01, 'photo aspect ratio');
  }
  await page.evaluate(() => scrollTo(0, 0));
}
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 }, reducedMotion: 'reduce' });
    let post = null;
    let mockAction = null;
    const blockedWrites = [];
    // Fail closed from the first request, including Netlify's clean-URL form action.
    // No non-read request from this context is ever sent to the network.
    await context.route('**/*', async route => {
      const request = route.request();
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
      if (request.method() === 'POST' && mockAction && request.url() === mockAction) {
        post = request.postData();
        return route.fulfill({ status: 503, contentType: 'text/html; charset=utf-8', body: '<h1>개발 검수용 수신 실패</h1><p>요청은 외부로 전송되지 않았습니다. 뒤로가기로 입력을 확인합니다.</p>' });
      }
      blockedWrites.push({ method: request.method(), url: request.url() });
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await ready(page);
    assert.equal(await page.locator('main > section').count(), 6);
    assert.equal(await page.locator('.partner-company-list li').count(), 4);
    assert.equal(await page.locator('.partner-company-list a').count(), 0);
    assert.equal(await page.locator('.partner-company-section').getByRole('link', { name: '공동출자 기록 보기 →', exact: true }).count(), 1);
    assert.equal(await page.locator('#partnership-faq-title').textContent(), '참여 안내');
    const metric = await layout(page, String(width));
    const boxes = () => page.locator('header, main > section, footer').evaluateAll(els => els.map(el => {
      const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height];
    }));
    const before = await boxes(); await page.waitForTimeout(600); assert.deepEqual(await boxes(), before, 'stable layout');
    await page.screenshot({ path: path.join(output, `partnership-${width}.png`), fullPage: true });
    await page.screenshot({ path: path.join(output, `partnership-${width}-hero.png`) });
    const form = page.locator('form[name="taejang-inquiry"]');
    assert.equal(await form.evaluate(el => el.checkValidity()), false, 'native required');
    await page.getByRole('link', { name: '공동출자·참여기업 상담', exact: true }).click();
    assert.equal(await field(page, 'inquiry-type').inputValue(), '모회사·고용 연계');
    await field(page, 'name').fill('개발 검수용');
    await field(page, 'organization').fill('합성 QA 기관');
    await field(page, 'email').fill('invalid-email');
    assert.equal(await field(page, 'email').evaluate(el => el.validity.typeMismatch), true);
    await field(page, 'email').fill('qa@example.invalid');
    await field(page, 'message').fill('개발 검수용 합성 문의입니다. 실제 전송하지 않습니다.');
    await page.getByRole('link', { name: '사업·농장 협력 문의', exact: true }).click();
    assert.equal(await field(page, 'inquiry-type').inputValue(), '기업 업무·건별 프로젝트');
    assert.equal(await field(page, 'name').inputValue(), '개발 검수용');
    await field(page, 'inquiry-type').selectOption({ label: '지역사회공헌·ESG 협력' });
    await page.locator('.faq-q').nth(0).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.faq-q').nth(0).getAttribute('aria-expanded'), 'true');
    assert.ok(await page.locator('#partnership-faq-answer-1').isVisible());
    await page.locator('.faq-q').nth(1).focus(); await page.keyboard.press('Space');
    assert.equal(await page.locator('.faq-q').nth(0).getAttribute('aria-expanded'), 'false');
    assert.ok(await page.locator('#partnership-faq-answer-2').isVisible());
    const outline = await page.locator('.faq-q').nth(1).evaluate(el => getComputedStyle(el).outlineWidth);
    assert.notEqual(outline, '0px', 'keyboard focus visible');
    assert.equal(await form.evaluate(el => el.checkValidity()), false, 'consent required');
    await field(page, 'privacy-consent').check();
    assert.equal(await form.evaluate(el => el.checkValidity()), true);
    // All native submission fields, completion path and synthetic failure/back recovery.
    const initial = await form.evaluate(el => [...new FormData(el)]);
    const action = new URL(await form.getAttribute('action'), page.url());
    assert.equal(action.origin, new URL(base).origin, 'same-origin native form');
    assert.match(action.pathname, /^\/thanks(?:\.html)?$/, 'known original or Netlify clean action');
    mockAction = action.href;
    await page.getByRole('button', { name: '문의 보내기', exact: true }).click();
    await page.waitForURL(url => url.href === mockAction);
    assert.notEqual(post, null, 'the expected POST was intercepted');
    const posted = new URLSearchParams(post);
    for (const [key, value] of initial) assert.equal(posted.get(key), value, 'POST ' + key);
    assert.equal(posted.get('form-name'), 'taejang-inquiry');
    assert.equal(posted.get('inquiry-type'), '지역사회공헌·ESG 협력');
    await page.goBack({ waitUntil: 'load' });
    assert.equal(await field(page, 'name').inputValue(), '개발 검수용');
    assert.equal(await field(page, 'message').inputValue(), '개발 검수용 합성 문의입니다. 실제 전송하지 않습니다.');
    assert.equal(await field(page, 'inquiry-type').inputValue(), '지역사회공헌·ESG 협력');
    if (width === 390) {
      await page.evaluate(() => {
        const els = [...document.querySelectorAll('main h1, main h2, main h3, main p, main a, main button, main label, main input, main textarea, main select, main strong, main span, main figcaption')];
        const sizes = els.map(el => parseFloat(getComputedStyle(el).fontSize));
        els.forEach((el, i) => { el.style.fontSize = `${sizes[i] * 2}px`; });
      });
      await layout(page, '200% text');
      await page.screenshot({ path: path.join(output, 'partnership-390-text-200.png'), fullPage: true });
    }
    assert.deepEqual(errors, [], 'page runtime errors');
    results.push({ width, metric, blockedWrites, faq: true, nativeValidation: true, interceptedPost: true, failureBackPreservation: true });
    await context.close();
  }
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); await page.goto(base + '/partnership.html');
  assert.ok(await page.locator('#partnership-faq-answer-1').isVisible(), 'JS off FAQ');
  assert.equal(await field(page, 'inquiry-type').locator('option').count(), 8);
  await field(page, 'inquiry-type').selectOption({ label: '일반 문의' });
  assert.equal(await field(page, 'inquiry-type').inputValue(), '일반 문의');
  await layout(page, 'JS off');
  await page.screenshot({ path: path.join(output, 'partnership-390-no-js.png'), fullPage: true });
  // Changed page's own links must resolve in the built bundle / hosted Preview.
  const internal = await page.locator('main a[href]').evaluateAll(els => [...new Set(els.map(el => el.getAttribute('href')).filter(h => !h.startsWith('#') && !h.startsWith('http') && !h.startsWith('mailto:')))]);
  for (const href of internal) {
    const res = await context.request.get(new URL(href, base).href);
    assert.equal(res.status(), 200, 'internal link ' + href);
  }
  results.push({ noJavaScript: true, internalLinks: internal, realSubmit: false, actualReceipt: 'UNVERIFIED', notification: 'UNVERIFIED' });
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ base, results }, null, 2));
  console.log(JSON.stringify({ base, output, widths: [320, 390, 768, 1440], status: 'PASS', realSubmit: false }));
} finally { await browser.close(); server.close(); }
