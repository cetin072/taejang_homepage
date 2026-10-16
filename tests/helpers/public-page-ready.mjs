import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// A Preview toolbar iframe is not part of the product. Never wait for its
// analytics to become idle; still require product resources, fonts and layout.
const trackers = new WeakMap();
export async function gotoPublicReady(page, url, output, timeout = 30000) {
  let tracker = trackers.get(page);
  if (!tracker) {
    tracker = { pending: new Map(), events: [] };
    page.on('request', request => {
      const item = { url: request.url(), type: request.resourceType(), main: request.frame() === page.mainFrame(), start: Date.now() };
      tracker.pending.set(request, item);
    });
    const end = (request, failure) => {
      const item = tracker.pending.get(request);
      if (item) tracker.events.push({ ...item, ms: Date.now() - item.start, failure });
      tracker.pending.delete(request);
    };
    page.on('requestfinished', request => end(request, null));
    page.on('requestfailed', request => end(request, request.failure()?.errorText));
    page.on('response', response => {
      const item = tracker.pending.get(response.request());
      if (item) item.status = response.status();
    });
    trackers.set(page, tracker);
  }
  const origin = new URL(url).origin;
  tracker.events = [];
  tracker.pending.clear();
  const relevant = item => item.main && !new URL(item.url).pathname.startsWith('/.netlify/scripts/') &&
    (new URL(item.url).origin === origin || ['font', 'stylesheet', 'image'].includes(item.type));
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    assert.equal(response?.status(), 200, 'page document returns HTTP 200');
    const deadline = Date.now() + timeout;
    let quietSince = null;
    while (Date.now() < deadline) {
      if ([...tracker.pending.values()].some(relevant)) quietSince = null;
      else quietSince ??= Date.now();
      if (quietSince !== null && Date.now() - quietSince >= 500) break;
      await page.waitForTimeout(50);
    }
    assert.deepEqual([...tracker.pending.values()].filter(relevant), [], 'product requests must finish');
    await page.waitForFunction(() => document.fonts.status === 'loaded' &&
      [...document.styleSheets].length > 0 &&
      [...document.querySelectorAll('link[rel="stylesheet"]')].every(link => link.sheet) &&
      [...document.images].filter(image => {
        const box = image.getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight;
      }).every(image => image.complete && image.naturalWidth > 0), undefined, { timeout });
    assert.ok(await page.locator('main h1').isVisible(), 'actual page heading is visible');
    const boxes = () => page.locator('header, main, footer').evaluateAll(elements => elements.map(el => {
      const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height];
    }));
    const before = await boxes(); await page.waitForTimeout(300);
    assert.deepEqual(await boxes(), before, 'page layout has settled');
    // The local static bundle deliberately has no Functions server. Public feed
    // failures use the existing static fallback; CSS/JS/fonts/images may not fail.
    const failed = tracker.events.filter(item => relevant(item) && (item.failure || item.status >= 400) &&
      !new URL(item.url).pathname.startsWith('/.netlify/functions/'));
    assert.deepEqual(failed, [], 'critical visual resource requests must succeed');
    return response;
  } finally {
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'network-' + new URL(url).pathname.replace(/\W/g, '_') + '.json'),
      JSON.stringify({ url, events: tracker.events, pending: [...tracker.pending.values()] }, null, 2));
  }
}
