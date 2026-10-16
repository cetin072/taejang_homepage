import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve('.');
const fixture = path.join(root, 'tests/browser/notice-authoring-ux-gate.html');
const output = process.env.NOTICE_QA_OUTPUT || path.join(os.tmpdir(), 'taejang-notice-444-qa');
const preview = process.env.PREVIEW_URL?.replace(/\/$/, '');
if (preview) assert.equal(new URL(preview).protocol, 'https:');
const temp = await mkdtemp(path.join(os.tmpdir(), 'taejang-notice-fixture-'));
let html = await readFile(fixture, 'utf8');
html = html.replace('<head>', `<head><base href="${pathToFileURL(path.dirname(fixture) + path.sep).href}">`);
if (preview) {
  html = html.replaceAll('src="../../app/assets/', `src="${preview}/app/assets/`)
    .replaceAll('href="../../app/assets/', `href="${preview}/app/assets/`)
    .replaceAll('href="../../staff/assets/', `href="${preview}/staff/assets/`);
}
const target = path.join(temp, 'notice.html');
await writeFile(target, html);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--allow-file-access-from-files'],
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) });
try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(target).href);
    await page.waitForFunction(() => /NOTICE_AUTHORING_UX_GATE_(PASS|FAIL)/.test(document.getElementById('result').textContent), null, { timeout: 20000 });
    const result = await page.locator('#result').innerText();
    assert.equal(result, 'NOTICE_AUTHORING_UX_GATE_PASS:' + width, result + '\n' + errors.join('\n'));
    assert.deepEqual(errors, []);
    console.log(result + (preview ? ':PREVIEW' : ':LOCAL'));
    if (width === 390) {
      await page.goto(pathToFileURL(target).href + '?missing-final');
      await page.waitForFunction(() => /NOTICE_AUTHORING_UX_GATE_(PASS|FAIL)/.test(document.getElementById('result').textContent), null, { timeout: 20000 });
      assert.equal(await page.locator('#result').innerText(), 'NOTICE_AUTHORING_UX_GATE_PASS:' + width);
      console.log('NOTICE_FINAL_RPC_MISSING_PASS:390');
    }
    await page.goto(pathToFileURL(target).href + '?capture');
    await page.waitForFunction(() => document.getElementById('result').textContent === 'NOTICE_CAPTURE_READY');
    assert.equal(await page.evaluate(() => document.documentElement.clientWidth), width);
    assert.ok(await page.evaluate(() => document.body.scrollWidth <= innerWidth + 2), 'capture fits exact viewport');
    await page.screenshot({ path: path.join(output, `notice-${width}.png`), fullPage: true });
    await context.close();
  }
} finally {
  await browser.close();
  await rm(temp, { recursive: true, force: true });
}
console.log('NOTICE_AUTHORING_BROWSER_PASS');
