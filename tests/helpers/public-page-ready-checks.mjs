import assert from 'node:assert/strict';
import { gotoPublicReady } from './public-page-ready.mjs';

export async function checkReadinessBoundary(browser, output) {
  const context = await browser.newContext();
  const documents = new Map();
  await context.route('https://readiness.invalid/**', async route => {
    const url = new URL(route.request().url());
    if (route.request().isNavigationRequest()) documents.set(url.pathname, (documents.get(url.pathname) || 0) + 1);
    if (url.pathname === '/reset-once' && documents.get(url.pathname) === 1 || url.pathname === '/reset-always') return route.abort('connectionreset');
    if (url.pathname === '/http-failure') return route.fulfill({status:503,contentType:'text/html',body:'Unavailable'});
    if (url.pathname === '/toolbar') return route.fulfill({ contentType: 'text/html', body: '<img src="/slow">' });
    if (url.pathname === '/slow' || url.pathname === '/blocked.css') {
      await new Promise(resolve => setTimeout(resolve, 3000));
      return route.fulfill({ contentType: 'text/css', body: 'body{color:#111}' }).catch(() => {});
    }
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}</style>' +
      (url.pathname === '/product-failure' ? '<link rel="stylesheet" href="/blocked.css">' : '') +
      '<header>Header</header><main><h1>Ready fixture</h1></main><footer>Footer</footer>' +
      (url.pathname === '/toolbar-test' ? '<iframe src="/toolbar"></iframe>' : '') });
  });
  let page = await context.newPage();
  // CI browser startup may exceed 1 s before the mocked main document is ready.
  // Keep the blocked product-stylesheet case below at 1 s: it must still fail closed.
  await gotoPublicReady(page, 'https://readiness.invalid/toolbar-test', output, 5000);
  await assert.rejects(page.waitForLoadState('networkidle', { timeout: 200 }), /Timeout/, 'a stalled iframe can prevent networkidle after product is ready');
  await assert.rejects(gotoPublicReady(page, 'https://readiness.invalid/product-failure', output, 1000), /product requests must finish|Timeout/, 'a stalled product stylesheet still fails');
  await gotoPublicReady(page, 'https://readiness.invalid/reset-once', output, 5000);
  assert.equal(documents.get('/reset-once'), 2, 'one transport reset recovers with one retry');
  await assert.rejects(gotoPublicReady(page, 'https://readiness.invalid/reset-always', output, 5000), /ERR_CONNECTION_RESET/, 'persistent transport failure still blocks');
  assert.equal(documents.get('/reset-always'), 2, 'transport retries are bounded');
  // The final failed navigation can still commit Chromium's error document.
  // Keep the independent HTTP-status case out of that failed page's lifecycle.
  await page.close();
  page = await context.newPage();
  await assert.rejects(gotoPublicReady(page, 'https://readiness.invalid/http-failure', output, 5000), /page document returns HTTP 200/, 'HTTP failure still blocks');
  assert.equal(documents.get('/http-failure'), 1, 'HTTP error is never retried');
  assert.equal(documents.get('/product-failure'), 1, 'product stylesheet failure is never retried');
  await context.close();
  console.log('PASS readiness boundary: iframe/product CSS and bounded transport-only retry');
}
