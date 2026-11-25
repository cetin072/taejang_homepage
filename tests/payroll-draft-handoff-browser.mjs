import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

// Exercise the built legacy URL with stale login state: no session or RPC is used.
const html = readFileSync('dist/app/payroll/handoff.html');
const css = readFileSync('dist/app/assets/payroll-operator.css');
const server = createServer((request, response) => {
  const style = request.url === '/app/assets/payroll-operator.css';
  response.setHeader('Content-Type', style ? 'text/css' : 'text/html; charset=utf-8');
  response.end(style ? css : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync), args: ['--no-sandbox'] });
  for (const javaScriptEnabled of [true, false]) {
    const context = await browser.newContext({ javaScriptEnabled });
    await context.addInitScript(() => localStorage.setItem('taejang-staff-session-v1', '{"access_token":"synthetic-retired-session"}'));
    const page = await context.newPage();
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/app/payroll/handoff.html?month=2026-09`);
    await page.waitForLoadState('networkidle');
    assert.match(await page.locator('h1').innerText(), /외부 급여 초안 기능이 종료되었습니다/);
    assert.equal(await page.locator('script, form, button').count(), 0);
    assert.equal(await page.getByRole('link', { name: '업무플랫폼으로' }).getAttribute('href'), '../');
    assert.deepEqual(requests.map(url => new URL(url).pathname).sort(), ['/app/assets/payroll-operator.css', '/app/payroll/handoff.html']);
    await context.close();
  }
  console.log('PASS retired handoff URL: with/without JavaScript, stale session, no API or script requests');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
