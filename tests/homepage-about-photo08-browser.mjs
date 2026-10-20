// Hosted, read-only QA: test public overrides with mocked approved API data.
// Never authenticate to, write to, or mutate the live Supabase database.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const base = (process.env.ABOUT_PHOTO_QA_BASE || '').replace(/\/+$/, '');
if (!/^https:\/\/deploy-preview-\d+--taejang-homepage\.netlify\.app$/.test(base)) {
  throw new Error('Only exact-HEAD Netlify Deploy Previews may be used for this browser QA');
}
const source = await readFile(new URL('../about.html', import.meta.url), 'utf8');
const original = source.match(/data-photo-slot="08"[\s\S]*?<img src="([^"]+)"/)?.[1];
if (!original) throw new Error('PHOTO 08 missing from static HTML');
const out = process.env.ABOUT_PHOTO_QA_OUTPUT || 'about-photo-qa-artifacts';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const selector = '[data-photo-slot="08"] > img';
const slotSelector = '[data-photo-slot="08"] > img';
const imageURL = base + '/images/homepage/photo-08.webp';
const approved = {
  slot_key: 'about.greeting.photo', slot_kind: 'image',
  public_path: 'about.html', selector: slotSelector, registered: true,
  image_url: imageURL, image_alt: '태장 대표이사 수정된 사진'
};
try {
  for (const width of [1440, 390]) {
    for (const failure of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.route('**/.netlify/functions/public-homepage-overrides', route =>
          route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ items: [{
              ...approved,
              image_url: failure ? base + '/__intentionally_missing_photo08__.webp' : imageURL
            }] })
          })
        );
        const doc = await page.goto(base + '/about', { waitUntil: 'domcontentloaded', timeout: 30000 });
        assert.equal(doc?.status(), 200);
        const image = page.locator(selector);
        await image.waitFor();
        await page.waitForFunction(({ selector, expectedSrc, failure }) => {
          const element = document.querySelector(selector);
          if (!element) return false;
          if (element.dataset.homepageLiveSlot !== 'about.greeting.photo') return false;
          const expected = failure ? expectedSrc : '/images/homepage/photo-08.webp';
          return new URL(element.getAttribute('src'), location.href).pathname === expected &&
            element.complete && element.naturalWidth > 0;
        }, { selector, expectedSrc: '/' + original, failure }, { timeout: 20000 });
        const actual = await image.evaluate(el => ({
          src: new URL(el.getAttribute('src'), location.href).pathname,
          naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, alt: el.alt
        }));
        assert.ok(actual.naturalWidth > 0 && actual.naturalHeight > 0);
        if (failure) {
          assert.equal(actual.src, '/' + original);
          assert.equal(actual.alt, '농업회사법인 태장 주식회사 대표이사 이영희');
        } else {
          assert.equal(actual.src, '/images/homepage/photo-08.webp');
          assert.equal(actual.alt, approved.image_alt);
        }
        const suffix = failure ? 'static-fallback' : 'approved-live';
        await page.screenshot({ path: path.join(out, 'about-' + width + '-' + suffix + '.png') });
        console.log(JSON.stringify({ width, scenario: suffix, photoSlot:'about.greeting.photo',
          image: actual.src, decoded: true }));
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
