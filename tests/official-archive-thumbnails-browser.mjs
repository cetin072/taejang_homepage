// Hosted Chrome regression: visible Naver blog cards must load genuine same-origin photos.
// The main renderer is exercised on both PC and mobile without touching Production.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = (process.env.ARCHIVE_PREVIEW_URL || '').replace(/\/+$/, '');
if (!/^https:\/\/deploy-preview-\d+--taejang-homepage\.netlify\.app$/.test(base)) {
  throw new Error('Expected verified Netlify Deploy Preview URL, never Production');
}
const source = await readFile(new URL('../assets/js/official-channel-updates.js', import.meta.url), 'utf8');
const start = source.split('/* OFFICIAL_ITEMS_START */')[1]?.split('/* OFFICIAL_ITEMS_END */')[0];
const original = JSON.parse(start);
const expected = original.filter(item => item.source === 'naver-blog').map(item => item.id);
assert.ok(expected.length >= 38, 'Official Naver backfill must be present');
const outDir = process.env.ARCHIVE_THUMB_QA_OUTPUT || 'archive-thumbnail-browser-qa';
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
try {
  for (const viewport of [
    { width: 1440, height: 900, name: 'desktop' },
    { width: 390, height: 844, name: 'mobile' }
  ]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    try {
      const response = await page.goto(base + '/archive', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      assert.equal(response?.status(), 200, 'archive document must load');
      await page.waitForFunction(() => !!window.TAEJANG_CONTENT?.hub?.some(item =>
        item.id === 'naver-blog-224443459405'), { timeout: 30_000 });
      const images = await page.evaluate((ids) => {
        const byId = new Map(window.TAEJANG_CONTENT.hub.map(item => [item.id, item]));
        return ids.map(id => ({ id, src: byId.get(id)?.thumbnail || '' }));
      }, expected);
      assert.equal(images.length, expected.length);
      for (const item of images) {
        assert.match(item.src, /^assets\/images\/archive\/naver-blog-\d{10,14}\.(?:jpg|png|webp)$/,
          'Blog image must be a same-origin snapshot: ' + item.id);
      }
      const decoded = await page.evaluate(async (paths) => {
        return await Promise.all(paths.map(async (src) => {
          const img = new Image();
          img.src = new URL(src, location.href).href;
          try {
            await img.decode();
            return { src, width: img.naturalWidth, height: img.naturalHeight };
          } catch {
            return { src, width: 0, height: 0 };
          }
        }));
      }, images.map(item => item.src));
      const broken = decoded.filter(item => !item.width || !item.height);
      assert.deepEqual(broken, [], viewport.name + ' browser image decode failed');
      await page.locator('[data-hub-list]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: outDir + '/archive-' + viewport.name + '.png' });
      console.log(JSON.stringify({ viewport: viewport.name, expected: expected.length,
        sameOrigin: images.length, decoded: decoded.length, broken: broken.length }));
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
