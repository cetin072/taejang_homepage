// Real app bootstrap, shared notice DOM/controller/transport; synthetic API only.
// No hosted database requests or real account writes are permitted.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const root = process.cwd();
const preview = (process.env.PREVIEW_URL || '').replace(/\/$/, '');
const output = process.env.NOTICE_INIT_QA_OUTPUT || path.join(os.tmpdir(), 'taejang-notice-init');
await fs.mkdir(output, { recursive: true });
const server = http.createServer(async (req, res) => {
  try {
    const file = new URL(req.url, 'http://localhost').pathname.slice(1);
    assert.ok(path.resolve(root, file).startsWith(root + path.sep));
    let body;
    if (process.env.NOTICE_INIT_BASELINE_REF && file === 'app/assets/notice-admin.js') {
      body = execFileSync('git', ['show', process.env.NOTICE_INIT_BASELINE_REF + ':' + file], { encoding: 'utf8' });
    } else if (preview && /^(app|staff)\//.test(file)) {
      const response = await fetch(preview + '/' + file);
      assert.equal(response.status, 200, file);
      body = await response.text();
      // Netlify rewrites home links and appends its Preview toolbar to HTML.
      // Executable/controller and style bytes must still match the tested HEAD.
      if (/\.(js|css)$/.test(file)) assert.equal(body, await fs.readFile(path.join(root, file), 'utf8'), 'exact-head Preview asset ' + file);
    } else body = await fs.readFile(path.join(root, file), 'utf8');
    if (file === 'app/index.html') {
      // Keep actual bootstrap and panel navigation; unrelated enhancements have
      // separate gates. Manager controllers are loaded by the real app.js.
      body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace('</body>', [
        '../staff/assets/auth-routing.js', 'assets/today-board.js',
        'assets/staff-information-ui.js', 'assets/app-workspace-surface.js', 'assets/app.js'
      ].map(src => `<script src="${src}"></script>`).join('') + '</body>');
    }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : (/\.m?js$/).test(file) ? 'application/javascript' : 'text/html; charset=utf-8');
    res.end(body);
  } catch (error) { res.statusCode = 500; res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) });
async function boot(width, role, task, simulation = false) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await context.newPage(), calls = [], errors = [];
  const control = { fail: '', delay: 0, optionsFail: false, role, allowed: true, holdOptions: false, releaseOptions: null };
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ role, task, simulation }) => {
    window.addEventListener('pageshow', event => { if (!window.TaejangApp) event.stopImmediatePropagation(); }, true);
    localStorage.setItem('taejang-staff-session-v1', JSON.stringify({ access_token: 'synthetic', user: { id: 'synthetic' } }));
    window.fixtureAccess = { role, allowed: true, task };
    window.TaejangAppUi = {
      element: id => document.getElementById(id), text: (tag, value, cls) => { const n = document.createElement(tag); n.textContent = value || ''; if (cls) n.className = cls; return n; },
      message: (id, value, error = false) => { const n = document.getElementById(id); n.textContent = value; n.hidden = !value; n.classList.toggle('error', error); },
      imageOrNotice: () => document.createElement('span')
    };
    window.TaejangCapabilityAccess = { refresh: async () => {
      const app = window.TaejangApp;
      app.hasCapabilityContract = () => true;
      app.can = code => code === 'notice.manage' ? fixtureAccess.allowed : code === 'task.manage' && fixtureAccess.task;
      app.getRoute = () => fixtureAccess.role;
    } };
  }, { role, task, simulation });
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    assert.equal(url.origin, origin, 'hosted API requests are forbidden');
    const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/.netlify/functions/staff-config') return send({ url: origin, publishableKey: 'synthetic' });
    if (url.pathname === '/staff/change-password.html') return route.fulfill({ status: 404, body: '' });
    if (!url.pathname.startsWith('/rest/v1/rpc/')) return route.continue();
    const name = url.pathname.split('/').pop(), args = req.postDataJSON(); calls.push({ name, args });
    if (name === 'get_my_access_context') return send({ id: 'synthetic', authenticated: true, account_status: 'active', roles: [{ code: role }], role_simulation: { active: simulation, role_code: role } });
    if (name === 'list_manageable_today_records') return send({ message: 'TASK_API_FAILED' }, 503);
    if (name === 'get_today_board_admin_options') {
      if (control.holdOptions) await new Promise(resolve => { control.releaseOptions = resolve; });
      return control.optionsFail ? send({ message: 'FORBIDDEN' }, 403) : send({ work_guides: [], departments: [], profiles: [], work_groups: [] });
    }
    if (name === 'list_manageable_schedules') return send({ message: 'OPTIONAL_SCHEDULE_FAILED' }, 503);
    if (name === 'list_manageable_notices_page') {
      if (control.delay) await new Promise(resolve => setTimeout(resolve, control.delay));
      if (control.fail) return send({ message: control.fail }, control.fail === 'FORBIDDEN' ? 403 : 503);
      const make = (id, title, end) => ({ id, title, body_easy: '합성 공지 본문', notice_kind: 'general', importance: 'normal', status: 'published', target_scope: 'company', publish_start_at: '2026-01-01T00:00:00Z', publish_end_at: end, version_no: 1, media: [], can_edit: control.role === 'operations_manager', can_lead_edit: false, can_read_ack_summary: false });
      const items = args.p_search === '없음' ? [] : [make('published', '전 직원 공지', '2099-01-01T00:00:00Z'), make('expired', '게시기간 종료 공지', '2026-02-01T00:00:00Z')];
      return send({ items, total: items.length, has_more: false });
    }
    errors.push('Unexpected RPC ' + name); return send({ message: 'Unexpected RPC ' + name }, 500);
  });
  await page.goto(origin + '/app/index.html');
  await page.waitForFunction(() => window.TaejangNoticeAdmin && window.TaejangApp?.hasCapabilityContract?.());
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('taejang-open-app-panel', { detail: { id: 'notice-admin-panel' } })));
  return { context, page, calls, errors, control };
}
try {
  for (const width of [390, 1440]) {
    for (const [role, task, simulation] of [['operations_manager', true, false], ['promotion_lead', false, false], ['promotion_lead', false, true]]) {
      const { context, page, calls, errors, control } = await boot(width, role, task, simulation);
      await page.locator('[data-notice-id="published"]').waitFor({ timeout: 5000 }).catch(error => {
        console.error('NOTICE_INIT_FAILURE', { role, task, simulation, calls: calls.map(c => c.name), errors });
        throw error;
      });
      await page.locator('[data-notice-id="expired"]').waitFor();
      assert.equal(calls.filter(c => c.name === 'list_manageable_today_records').length, 0);
      assert.equal(calls.filter(c => c.name === 'list_manageable_notices_page').length, 1, 'bootstrap/menu must share one in-flight query');
      await page.screenshot({ path: path.join(output, `${role}-${simulation}-${width}.png`), fullPage: true });
      control.delay = 100;
      const before = calls.filter(c => c.name === 'list_manageable_notices_page').length;
      await page.evaluate(() => {
        for (let i = 0; i < 3; i++) document.dispatchEvent(new CustomEvent('taejang-open-notice-admin', { detail: { view: 'manage' } }));
        document.dispatchEvent(new CustomEvent('taejang-admin-options-ready', { detail: { options: { work_guides: [] } } }));
        document.dispatchEvent(new Event('taejang-app-ready'));
      });
      await page.waitForFunction(() => !document.getElementById('refresh-notice-admin').disabled);
      assert.equal(calls.filter(c => c.name === 'list_manageable_notices_page').length, before + 1, 'reentry and legacy event do not duplicate loading');
      control.optionsFail = true;
      await page.locator('#notice-list-search').fill('없음');
      await page.locator('#notice-list-filters').getByRole('button', { name: '검색', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('notice-list-summary').textContent.startsWith('0 / 0'));
      assert.match(await page.locator('#notice-admin-list').textContent(), /등록된 공지가 없습니다/);
      control.fail = 'FORBIDDEN';
      await page.locator('#refresh-notice-admin').click();
      await page.waitForFunction(() => !document.getElementById('refresh-notice-admin').disabled);
      assert.match(await page.locator('#notice-admin-message').textContent(), /권한/);
      control.fail = 'READ_FAILED';
      await page.locator('#refresh-notice-admin').click();
      await page.waitForFunction(() => !document.getElementById('refresh-notice-admin').disabled);
      assert.match(await page.locator('#notice-admin-message').textContent(), /불러오지 못/);
      control.fail = ''; control.holdOptions = true;
      await page.locator('#notice-clear-filters').click();
      await page.locator('[data-notice-id="published"]').waitFor({ timeout: 2000 });
      assert.ok(control.releaseOptions, 'optional options request remains pending while notice list renders');
      control.releaseOptions(); control.holdOptions = false;
      // A capability change invalidates old requests and clears foreign results.
      await page.evaluate(() => { fixtureAccess.allowed = false; document.dispatchEvent(new Event('taejang-capabilities-ready')); });
      assert.equal(await page.locator('#notice-admin-list article').count(), 0);
      assert.match(await page.locator('#notice-admin-message').textContent(), /권한/);
      await page.evaluate(() => { fixtureAccess.allowed = true; document.dispatchEvent(new Event('taejang-app-ready')); });
      await page.locator('[data-notice-id="published"]').waitFor();
      await page.reload();
      await page.waitForFunction(() => window.TaejangNoticeAdmin && window.TaejangApp?.hasCapabilityContract?.());
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('taejang-open-app-panel', { detail: { id: 'notice-admin-panel' } })));
      await page.locator('[data-notice-id="published"]').waitFor();
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`NOTICE_INDEPENDENT_INIT_PASS:${role}:task=${task}:simulation=${simulation}:${width}`);
    }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
