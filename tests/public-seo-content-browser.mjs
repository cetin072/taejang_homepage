// Synthetic approved rows only. No production API, account, or content writes.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import edge from '../netlify/edge-functions/public-promotion-seo.mjs';

const root = path.resolve('dist');
const id = '11111111-1111-4111-8111-111111111111';
const row = { content_id: id, content_type: 'homepage_article', title: '합성 환경정비 소개',
  summary: '안전교육을 진행하고 ...', public_body: '안전교육을 진행하고 ...',
  external_url: 'https://blog.naver.com/taejang-official/224451351676',
  link_source_type: 'none', published_date: '2026-10-29', public_media: [] };
globalThis.Netlify = { env: { get: key => key === 'SUPABASE_URL' ? 'https://public-example.supabase.co' : 'public-test-only' } };
globalThis.fetch = async () => Response.json([row]);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    assert.equal(request.method, 'GET');
    if (url.pathname === '/.netlify/functions/public-promotion-feed') {
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify({ item: row }));
    }
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep)) throw Error('path');
    let body = await readFile(file);
    if (url.pathname === '/promotion.html' && !url.searchParams.has('client')) {
      const result = await edge(new Request('https://preview.example' + request.url), { next: async () => new Response(body) });
      assert.equal(result.status, 200);
      body = await result.text();
    }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CI ? { channel: 'chrome' } : {}) });
await mkdir('seo-qa-artifacts', { recursive: true });
try {
  for (const width of [320, 390, 1440]) {
    for (const javaScriptEnabled of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled, reducedMotion: 'reduce' });
      await context.route('**/*', route => route.request().url().startsWith(base + '/') && route.request().method() === 'GET' ? route.continue() : route.abort());
      const page = await context.newPage();
      for (const file of ['about.html', 'business.html', 'location.html', 'partnership.html', 'farm.html', 'certifications.html']) {
        const result = await page.goto(base + '/' + file, { waitUntil: 'load' });
        assert.equal(result.status(), 200);
        assert.equal(await page.locator('main h1').count(), 1);
        assert.ok(await page.title());
        if (file === 'partnership.html') {
          const question = page.getByRole('button', { name: '태장에 어떤 업무를 맡기거나 협력할 수 있나요?' });
          if (javaScriptEnabled) await question.click();
          assert.ok(await page.locator('#partnership-faq-answer-7').isVisible());
        }
        if (['about.html', 'business.html', 'location.html'].includes(file)) {
          assert.ok(await page.locator('main a[href="farm.html"]').count() > 0, file + ' links to farm');
        }
        if (['about.html', 'partnership.html'].includes(file)) {
          assert.ok(await page.locator('main a[href="certifications.html"]').count() > 0, file + ' links to credentials');
        }
        if (file === 'certifications.html') {
          assert.equal(await page.locator('main img').count(), 4);
          assert.match(await page.locator('main').textContent(), /제2026-049호/);
          assert.match(await page.locator('main').textContent(), /현판 사진/);
          for (const img of await page.locator('main img').all()) {
            await img.scrollIntoViewIfNeeded();
            await img.evaluate(el => el.decode());
            const dimensions = await img.evaluate(el => ({ natural: el.naturalWidth / el.naturalHeight, shown: el.getBoundingClientRect().width / el.getBoundingClientRect().height, fit: getComputedStyle(el).objectFit }));
            assert.ok(Math.abs(dimensions.natural - dimensions.shown) < 0.02, 'evidence image is uncropped');
          }
          await page.getByRole('link', { name: '표준사업장 인증', exact: true }).click();
          assert.ok(page.url().endsWith('#standard-workplace'));
          await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
          await page.waitForTimeout(200);
          await page.screenshot({ path: `seo-qa-artifacts/certifications-${width}-${javaScriptEnabled}.png`, fullPage: true });
          await page.getByRole('link', { name: '인증 당시 회사 소식 보기 →', exact: true }).click();
          assert.ok(page.url().endsWith('/activities/standard-workplace-certification.html'));
          assert.equal(await page.locator('.article-gallery img').count(), 3);
          for (const img of await page.locator('.article-body img').all()) {
            await img.scrollIntoViewIfNeeded();
            await img.evaluate(el => el.decode());
            assert.ok(await img.evaluate(el => Math.abs(el.naturalWidth / el.naturalHeight - el.getBoundingClientRect().width / el.getBoundingClientRect().height) < 0.02), 'news evidence image is uncropped');
          }
          await page.goto(base + '/certifications.html');
          await page.getByRole('link', { name: '장애인 표준사업장 인증서 원본 크게 보기', exact: true }).click();
          assert.ok(page.url().endsWith('/standard-workplace-certificate-2026-049.png'));
        }
        if (file === 'farm.html') {
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'farm overflow');
          assert.equal(await page.locator('main img, main iframe, main form').count(), 0, 'text-first draft has no invented farm photos, maps or booking');
          assert.match(await page.locator('main').textContent(), /2년 연속 호박 재배 완료/);
          assert.match(await page.locator('main').textContent(), /야생다래 덕장 시설/);
          await page.screenshot({ path: `seo-qa-artifacts/farm-${width}-${javaScriptEnabled}.png`, fullPage: true });
          await page.getByRole('link', { name: '농장 이야기 살펴보기', exact: true }).click();
          assert.ok((await page.url()).endsWith('#farm-story'));
          const current = await page.locator('#farm-story').boundingBox();
          await page.waitForTimeout(400);
          assert.deepEqual(await page.locator('#farm-story').boundingBox(), current, 'farm layout stable');
          await page.getByRole('link', { name: '농장 관련 협력 문의', exact: true }).click();
          assert.ok((await page.url()).endsWith('/partnership.html#contact'));
          assert.equal(await page.locator('form[name="taejang-inquiry"]').count(), 1);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), file + ' overflow');
        if (file === 'about.html') await page.screenshot({ path: `seo-qa-artifacts/about-${width}-${javaScriptEnabled}.png`, fullPage: true });
      }
      await page.goto(base + '/index.html', { waitUntil: 'load' });
      const partners = page.locator('.home-partners');
      const partnerNames = ['범한메카텍', '삼현', '청우비제이', '현대비앤지스틸', '경상남도', '미담농원', '아름다운학교', '미래진흥원', '학사모'];
      assert.deepEqual(await partners.locator('li > span').allTextContents(), partnerNames);
      assert.doesNotMatch(await partners.textContent(), /류진농원/);
      assert.equal(await partners.locator('h3').count(), 2);
      await partners.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `seo-qa-artifacts/home-partners-${width}-${javaScriptEnabled}.png`, fullPage: false });
      const trigger = page.locator('[data-home-inquiry-open]');
      assert.equal(await trigger.count(), 1);
      assert.equal(await trigger.getAttribute('href'), 'partnership.html#contact');
      const dialog = page.locator('#home-inquiry-dialog');
      assert.equal(await dialog.isVisible(), false);
      await trigger.click();
      if (javaScriptEnabled) {
        await dialog.waitFor({ state: 'visible' });
        assert.equal(await page.locator('body').evaluate(el => el.style.overflow), 'hidden');
        assert.equal(await dialog.getAttribute('aria-modal'), null, 'native dialog supplies modal semantics');
        await dialog.getByRole('link', { name: '오시는 길 보기 →', exact: true }).focus();
        await page.keyboard.press('Tab');
        assert.equal(await dialog.locator('[data-home-inquiry-close]').evaluate(el => el === document.activeElement), true, 'focus wraps within the native modal');
        const form = dialog.locator('form[name="taejang-inquiry"]');
        await form.locator('[name="name"]').fill('합성 문의자');
        await form.locator('[name="message"]').fill('합성 검증: 협력 방식을 문의합니다.');
        assert.equal(await form.evaluate(el => el.checkValidity()), false, 'required fields still enforced');
        await dialog.locator('[data-home-inquiry-close]').click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'focus returns to the opener');
        assert.equal(await page.locator('body').evaluate(el => el.style.overflow), '');
        await trigger.click();
        assert.equal(await form.locator('[name="name"]').inputValue(), '합성 문의자');
        assert.equal(await form.locator('[name="message"]').inputValue(), '합성 검증: 협력 방식을 문의합니다.');
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        await trigger.click();
        await page.mouse.click(1, 1);
        await dialog.waitFor({ state: 'hidden' });
        await page.goto(base + '/index.html#contact', { waitUntil: 'load' });
        await dialog.waitFor({ state: 'visible' });
        await form.locator('[name="inquiry-type"]').selectOption({ label: '일반 문의' });
        await form.locator('[name="name"]').fill('합성 문의자');
        await form.locator('[name="organization"]').fill('합성 검증 기관');
        await form.locator('[name="email"]').fill('qa@example.test');
        await form.locator('[name="message"]').fill('합성 브라우저 접수 검증');
        await form.locator('[name="privacy-consent"]').check();
        assert.equal(await form.evaluate(el => el.checkValidity()), true);
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= 901, 'dialog fits the viewport');
        assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'dialog has no horizontal overflow');
        await dialog.evaluate(el => { el.scrollTop = 0; document.activeElement?.blur(); });
        await page.screenshot({ path: `seo-qa-artifacts/home-inquiry-${width}.png`, fullPage: false });
        let captured;
        await page.route(base + '/thanks.html', async route => {
          captured = { method: route.request().method(), body: route.request().postData() };
          await route.fulfill({ contentType: 'text/html', body: '<title>Synthetic inquiry accepted</title><p>합성 응답</p>' });
        });
        await form.getByRole('button', { name: '문의 보내기', exact: true }).click();
        await page.waitForURL(base + '/thanks.html');
        assert.equal(captured.method, 'POST');
        const payload = new URLSearchParams(captured.body);
        assert.equal(payload.get('form-name'), 'taejang-inquiry');
        assert.equal(payload.get('name'), '합성 문의자');
        assert.equal(payload.get('email'), 'qa@example.test');
        assert.equal(payload.get('message'), '합성 브라우저 접수 검증');
        assert.equal(payload.get('privacy-consent'), '동의함');
        await page.unroute(base + '/thanks.html');
      } else {
        assert.ok(page.url().endsWith('/partnership.html#contact'));
        assert.equal(await page.locator('form[name="taejang-inquiry"]').count(), 1, 'no-JS inquiry remains reachable');
      }
      for (const client of javaScriptEnabled ? [false, true] : [false]) {
        await page.goto(base + '/promotion.html?id=' + id + (client ? '&client=1' : ''), { waitUntil: 'load' });
        await page.locator('h1').filter({ hasText: row.title }).waitFor();
        assert.equal(await page.locator('.article-body').textContent(), row.public_body);
        assert.equal(await page.locator('.article-header .lead').count(), 0);
        assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /noindex/);
        assert.equal(await page.getByRole('link', { name: /공식 활동 기록:/ }).count(), 1);
        assert.match(await page.locator('.article-meta').textContent(), /홈페이지 등록일:/);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        const before = await page.locator('.article').boundingBox();
        await page.waitForTimeout(300);
        assert.deepEqual(await page.locator('.article').boundingBox(), before);
      }
      await context.close();
    }
  }
  console.log('Public SEO: 320/390/1440px, JS on/off, SSR and browser fallback PASS');
} finally { await browser.close(); server.close(); }
