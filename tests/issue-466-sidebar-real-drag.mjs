import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tests/browser/sidebar-runtime-gate.html');
const output = path.resolve(process.env.SIDEBAR_DRAG_QA_OUTPUT || 'sidebar-drag-qa-artifacts');
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--allow-file-access-from-files'],
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' })
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const browserErrors = [];
page.on('pageerror',error => browserErrors.push(error.message));
const order = async () => await page.locator('#app-nav > [data-menu-key]').evaluateAll(
  items => items.filter(item=>!item.hidden).map(item=>item.dataset.menuKey)
);
const before = async (first, second) => {
  const keys = await order();
  assert.ok(keys.indexOf(first) >= 0 && keys.indexOf(second) >= 0, 'menu slots must exist: ' + keys);
  assert.ok(keys.indexOf(first) < keys.indexOf(second), first + ' did not move before ' + second + ': ' + keys);
};
// Only actual mouse movement proves the native browser drag path. Calling
// dispatchEvent(new DragEvent(...)) is NOT accepted as a substitute.
async function dragMenu(sourceKey, targetKey) {
  const source = page.locator('#app-nav > [data-menu-key="' + sourceKey + '"]');
  const target = page.locator('#app-nav > [data-menu-key="' + targetKey + '"]');
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  assert.equal(await source.getAttribute('draggable'),'true','actual menu row must be draggable');
  const from = await source.boundingBox(), to = await target.boundingBox();
  assert.ok(from && to, 'drag endpoints must be on-screen');
  await page.mouse.move(from.x + from.width - 17, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width - 30, from.y + from.height / 2 + 9,{steps:5});
  await page.mouse.move(to.x + to.width - 18,to.y + Math.min(10,to.height / 4),{steps:24});
  await page.mouse.up();
  await page.waitForTimeout(180);
}
try {
  await page.goto(pathToFileURL(fixture).href + '?realMouseDrag');
  try {
    await page.waitForFunction(() => document.getElementById('result')?.textContent === 'SIDEBAR_RUNTIME_DRAG_READY',null,{timeout:12000});
  } catch (error) {
    const status=await page.locator('#result').innerText().catch(()=>'<missing result>');
    throw new Error('drag fixture not ready: '+status+'; browser errors: '+browserErrors.join('; '),{cause:error});
  }
  await page.locator('#app-nav [data-menu-key="notice.manage"]').waitFor();
  await before('notice.manage','task.manage');
  await page.locator('[data-platform-settings-action]').click();
  await page.getByRole('button',{name:'사이드바 메뉴 순서 편집'}).click();
  await page.locator('#app-nav[data-layout-editing="1"]').waitFor();

  await dragMenu('task.manage','notice.manage');
  await before('task.manage','notice.manage');
  await page.screenshot({path:path.join(output,'mouse-drag-before-save.png')});
  await page.getByRole('button',{name:'메뉴 순서 저장'}).click();
  await page.waitForTimeout(160);
  await page.evaluate(async () => await window.TaejangPlatformUiSettings.refresh());
  await page.waitForTimeout(100);
  await before('task.manage','notice.manage');

  // Re-enter edit mode after save; ensure draggable re-enabled and keyboard
  // control still works without introducing a second handler.
  await page.getByRole('button',{name:'사이드바 메뉴 순서 편집'}).click();
  const moved = page.locator('#app-nav > [data-menu-key="task.manage"]');
  assert.equal(await moved.getAttribute('draggable'),'true','second edit session must be draggable');
  await moved.focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  await before('notice.manage','task.manage');
  await page.getByRole('button',{name:'기본 순서로'}).click();
  await page.waitForTimeout(170);
  await before('notice.manage','task.manage');
  await page.screenshot({path:path.join(output,'reset-default.png')});
  assert.deepEqual(browserErrors,[], 'unexpected JavaScript errors during real drag');
  console.log('REAL_SIDEBAR_MOUSE_DRAG_PASS');
} finally {
  await browser.close();
}
