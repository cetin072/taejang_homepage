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
          assert.match(await page.locator('main').textContent(), /사진 보정본/);
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
