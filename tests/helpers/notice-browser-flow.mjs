import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

// Real isolated Auth/PostgREST/RLS and real app bootstrap. Business RPCs are
// never mocked. The only injected failure is the unrelated task-list endpoint.
export async function noticeBrowserFlow({ apiUrl, publishableKey, operations, lead, foreignNoticeId }) {
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(apiUrl).hostname), 'isolated DB only');
  const { chromium } = await import('playwright');
  const root = process.cwd();
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/.netlify/functions/staff-config') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ url: apiUrl, publishableKey })); return;
      }
      const file = pathname.slice(1) + (pathname.endsWith('/') ? 'index.html' : '');
      const absolute = path.resolve(root, file); assert.ok(absolute.startsWith(root + path.sep));
      let body = await fs.readFile(absolute, 'utf8');
      if (file === 'app/index.html') body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace('</body>', [
        '../staff/assets/auth-routing.js', 'assets/today-board.js', 'assets/staff-information-ui.js',
        'assets/notice-media.js', 'assets/capability-access.js', 'assets/app-workspace-surface.js', 'assets/app.js'
      ].map(src => `<script src="${src}"></script>`).join('') + '</body>');
      res.setHeader('Content-Type', (/\.m?js$/).test(file) ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
      res.end(body);
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) });
    for (const width of [390, 1440]) {
      for (const [role, actor] of [['operations_manager', operations], ['promotion_lead', lead]]) {
        const context = await browser.newContext({ viewport: { width, height: 1000 } });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(session => {
          window.addEventListener('pageshow', event => { if (!window.TaejangApp) event.stopImmediatePropagation(); }, true);
          localStorage.setItem('taejang-staff-session-v1', JSON.stringify(session));
          window.TaejangAppUi = {
            element: id => document.getElementById(id),
            text: (tag, value, cls) => { const n = document.createElement(tag); n.textContent = value || ''; if (cls) n.className = cls; return n; },
            message: (id, value, error = false) => { const n = document.getElementById(id); n.textContent = value; n.hidden = !value; n.classList.toggle('error', error); },
            imageOrNotice: () => document.createElement('span')
          };
          window.confirm = () => true;
        }, actor.session);
        await page.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.pathname.endsWith('/rpc/list_manageable_today_records')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"isolated unrelated task failure"}' });
          return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? route.continue() : route.abort();
        });
        const open = async () => {
          await page.waitForFunction(() => window.TaejangNoticeAdmin && window.TaejangApp?.hasCapabilityContract?.());
          await page.evaluate(() => document.dispatchEvent(new CustomEvent('taejang-open-app-panel', { detail: { id: 'notice-admin-panel' } })));
        };
        await page.goto(origin + '/app/'); await open();
        const foreign = page.locator(`[data-notice-id="${foreignNoticeId}"]`);
        await foreign.waitFor();
        if (role === 'promotion_lead') {
          assert.equal(await foreign.getByRole('button', { name: '공지 수정', exact: true }).count(), 0, 'foreign publication is read only');
        }
        await page.locator('#new-notice-admin').click();
        const title = `Isolated notice browser ${role} ${width}`;
        await page.locator('#notice-title-input').fill(title);
        await page.locator('#notice-body').fill('실제 격리 DB 저장 및 재조회 본문');
        await page.locator('#notice-save-draft').click();
        await page.waitForFunction(() => document.getElementById('notice-admin-message').textContent.startsWith('저장 완료'));
        const id = await page.locator('#notice-id').inputValue(); assert.ok(id);
        const saved = page.locator(`[data-notice-id="${id}"]`);
        await saved.getByRole('button', { name: '공지 수정', exact: true }).click();
        if (role === 'promotion_lead') await page.locator('#notice-routine-confirm').check();
        await page.locator('#notice-publish').click();
        await page.waitForFunction(() => document.getElementById('notice-admin-message').textContent.startsWith('저장 완료'));
        const readback = await fetch(apiUrl + '/rest/v1/rpc/get_manageable_notice', {
          method: 'POST', headers: { apikey: publishableKey, Authorization: 'Bearer ' + actor.token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_notice_id: id })
        });
        assert.equal(readback.status, 200);
        const row = await readback.json();
        assert.equal(row.id, id); assert.equal(row.title, title); assert.equal(row.status, 'published');
        assert.equal(row.body_easy, '실제 격리 DB 저장 및 재조회 본문');
        assert.equal(row.target_scope, 'company');
        await page.reload(); await open();
        await page.locator(`[data-notice-id="${id}"]`).waitFor();
        assert.deepEqual(errors, []);
        await context.close();
        console.log(`NOTICE_ISOLATED_AUTH_BROWSER_PASS:${role}:${width}`);
      }
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
