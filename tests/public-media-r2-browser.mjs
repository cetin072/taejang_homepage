// Offline browser gate. Run with CHROMIUM_EXECUTABLE_PATH when using a system browser.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorker } from '../cloudflare/public-media/worker.mjs';
import { routePublicMedia, mediaKey } from '../shared/public-media-manifest.mjs';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1sAAAAASUVORK5CYII=', 'base64');
const origin = 'https://fixture.supabase.co';
const entry = {contentId: '11111111-1111-4111-8111-111111111111', sourceUrl: origin + '/storage/v1/object/public/promotion-media/test.png', size: png.length, contentType: 'image/png', sha256: createHash('sha256').update(png).digest('hex')};
const row = {content_id:entry.contentId, title:'합성 공개 사진 검증', content_type:'homepage_article', public_body:'로컬 fixture', hero_image_url:entry.sourceUrl, public_media:[{url:entry.sourceUrl, alt:'합성 사진'}]};
let published = true;
const worker = createWorker([entry], async () => Response.json(published ? [row] : []));
const env = {PUBLIC_MEDIA_ENABLED:'true', SUPABASE_URL:origin, SUPABASE_PUBLISHABLE_KEY:'fixture', PUBLIC_MEDIA_BUCKET:{async get(){return {body:png,size:png.length,customMetadata:{sha256:entry.sha256}};},async head(){return {size:png.length,customMetadata:{sha256:entry.sha256}};}}};
const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args:['--no-sandbox']});
try {
  for (const width of [390,1440]) {
    const page = await browser.newPage({viewport:{width,height:900}});
    let imageRequests = 0;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'media.taejang.co.kr') {
        imageRequests++;
        const response = await worker.fetch(new Request(url, {method:route.request().method()}), env);
        return route.fulfill({status:response.status, headers:Object.fromEntries(response.headers), body:Buffer.from(await response.arrayBuffer())});
      }
      if (url.pathname.includes('/.netlify/functions/public-promotion-feed')) return route.fulfill({json:{item:routePublicMedia(row,{enabled:'true',storageOrigin:origin,entries:[entry]})}});
      if (url.hostname !== 'taejang.co.kr') return route.fulfill({status:404});
      const file = path.resolve(url.pathname.slice(1));
      if (!file.startsWith(process.cwd() + path.sep)) return route.fulfill({status:404});
      try {
        const body = url.pathname === '/images/og-taejang.png' ? png : await readFile(file);
        return route.fulfill({body, contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'image/png'});
      } catch { return route.fulfill({status:404}); }
    });
    await page.goto('https://taejang.co.kr/promotion.html?id=' + entry.contentId);
    const image = page.locator('.article-representative-media img');
    await image.waitFor();
    await image.evaluate(img=>img.decode());
    assert.equal(await image.getAttribute('src'), 'https://media.taejang.co.kr/' + mediaKey(entry));
    assert.ok(imageRequests > 0);
    published = false;
    await page.reload(); await image.waitFor();
    await page.waitForFunction(()=>document.querySelector('.article-representative-media img')?.src.endsWith('/images/og-taejang.png'));
    published = true;
    console.log(`PASS ${width}px: direct R2 fixture decode + revoked-photo fallback`);
    await page.close();
  }
} finally { await browser.close(); }
