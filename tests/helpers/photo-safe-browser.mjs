// Test-only transport. A decoded fixture is not evidence that a live photo exists.
export const PHOTO_FIXTURE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

export function isStorageRequest(url) {
  // Match custom domains, local proxies and encoded Image CDN source URLs too.
  let value = String(url);
  for (let depth = 0; depth < 4; depth++) {
    if (/\/storage\/v1\//i.test(value)) return true;
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    } catch { break; }
  }
  return false;
}

export async function fulfillPhotoFixture(route) {
  const request = route.request();
  if (request.method() === 'GET' && request.resourceType() === 'image') {
    return route.fulfill({ contentType: 'image/png', body: PHOTO_FIXTURE });
  }
  // No remote HEAD probes, fetches, downloads, scripts or writes from UI QA.
  return route.abort('blockedbyclient');
}

export async function newPhotoSafeContext(browser, options = {}) {
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
  // Install before returning the context: initial HTML, JS-off and popups are covered.
  // Later broad routes must use fallback(), not continue(), for read requests.
  await context.route(isStorageRequest, fulfillPhotoFixture);
  return context;
}

export async function newPhotoSafePage(browser, options = {}) {
  const context = await newPhotoSafeContext(browser, options);
  return context.newPage();
}

// Only the manually opted-in audit uses this. The budget is shared across contexts.
export function boundedLivePhotoRoute(allowedPhotos, limit = 12) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new Error('Photo request limit must be 1–12');
  const stats = { requests: 0, limit };
  const handle = async route => {
    const request = route.request();
    if (request.method() === 'GET' && request.resourceType() === 'image' &&
        allowedPhotos.has(request.url()) && stats.requests < limit) {
      stats.requests++;
      return route.continue();
    }
    return route.abort('blockedbyclient');
  };
  return { handle, stats };
}
