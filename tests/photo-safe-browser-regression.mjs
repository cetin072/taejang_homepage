// Loopback-only transport regression: the server counts every escaped Storage request.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { newPhotoSafeContext } from './helpers/photo-safe-browser.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
let storageHits = 0;
const server = createServer((req, res) => {
  if (req.url.includes('/storage/') || req.url.startsWith('/.netlify/images')) {
    storageHits++; res.writeHead(500); res.end('unexpected network request'); return;
  }
  res.setHeader('content-type', 'text/html');
  res.end('<img id="initial" src="/storage/v1/object/public/promotion-media/initial.jpg"><img id="proxy" src="/.netlify/images?url=https%3A%2F%2Fcustom.invalid%2Fstorage%2Fv1%2Frender%2Fimage%2Fpublic%2Fpromotion-media%2Fphoto.jpg"><a target="_blank" href="/popup">popup</a>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless:true, args:['--no-sandbox'], ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {channel:'chrome'}) });
  for (const javaScriptEnabled of [true, false]) {
    const context = await newPhotoSafeContext(browser, { javaScriptEnabled });
    // A later general route must retain the guard underneath.
    await context.route('**/*', route => route.fallback());
    const page = await context.newPage();
    await page.goto(base);
    for (const id of ['initial','proxy']) assert.equal(await page.locator('#' + id).evaluate(async img => { await img.decode(); return img.naturalWidth; }), 1);
    const popupEvent = page.waitForEvent('popup');
    await page.locator('a').click(); const popup = await popupEvent;
    await popup.waitForLoadState();
    assert.equal(await popup.locator('#initial').evaluate(img => img.naturalWidth), 1);
    if (javaScriptEnabled) {
      const results = await page.evaluate(async () => {
        const outcomes = [];
        for (const method of ['GET','HEAD','POST']) {
          try { await fetch('/storage/v1/object/public/promotion-media/download.jpg', {method}); outcomes.push('escaped'); }
          catch { outcomes.push('blocked'); }
        }
        const img = new Image(); img.loading = 'lazy'; img.src = '/storage/v1/object/sign/promotion-media/lazy.jpg?token=fake'; document.body.append(img); img.scrollIntoView(); await img.decode();
        return {outcomes, width:img.naturalWidth};
      });
      assert.deepEqual(results, {outcomes:['blocked','blocked','blocked'], width:1});
    }
    await context.close();
  }
  assert.equal(storageHits, 0);
  console.log('PASS photo guard: initial HTML, JS-off, popup, lazy signed image, encoded proxy, GET/HEAD/POST; upstream Storage requests = 0');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
