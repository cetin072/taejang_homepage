import assert from 'node:assert/strict';
import { gotoPublicReady } from './public-page-ready.mjs';

export async function checkReadinessBoundary(browser, output) {
  const context = await browser.newContext();
  await context.route('https://readiness.invalid/**', async route => {
    const url = new URL(route.request().url());
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
  const page = await context.newPage();
  // CI browser startup may exceed 1 s before the mocked main document is ready.
  // Keep the blocked product-stylesheet case below at 1 s: it must still fail closed.
  await gotoPublicReady(page, 'https://readiness.invalid/toolbar-test', output, 5000);
  await assert.rejects(page.waitForLoadState('networkidle', { timeout: 200 }), /Timeout/, 'a stalled iframe can prevent networkidle after product is ready');
  await assert.rejects(gotoPublicReady(page, 'https://readiness.invalid/product-failure', output, 1000), /product requests must finish|Timeout/, 'a stalled product stylesheet still fails');
  await context.close();
  console.log('PASS readiness boundary: irrelevant iframe vs required product CSS');
}
