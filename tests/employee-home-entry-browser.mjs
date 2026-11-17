import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const source = readFileSync(new URL('../app/assets/employee-common-home-v1.js', import.meta.url), 'utf8');
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<div class="staff-shell"><div class="app-user-actions"></div><a class="staff-brand">태장</a><div id="desktop-app-shell"><div id="dashboard-main">ERP</div></div><div id="general-worker-board" hidden></div></div><script>
  const role = new URLSearchParams(location.search).get('role');
  window.TaejangApp = { getRoute:()=>role, getContext:()=>({display_name:'Test',role_simulation:{active:false}}), rpc:async(name)=>{if(!['get_my_attendance_today','get_my_notice_list'].includes(name))throw Error('Unexpected write '+name);return name==='get_my_notice_list'?[]:{attendance_required:false};} };
  document.body.classList.add('desktop-app-mode');
  </script><script>${source}</script><script>document.dispatchEvent(new Event('taejang-app-ready'));</script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {channel:'chrome'})});
try {
  for (const mobile of [false,true]) {
    const context = await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1365,height:900},isMobile:mobile,hasTouch:mobile});
    const page = await context.newPage();
    for (const role of ['promotion_lead','promotion_staff','general_worker','operations_manager','department_lead']) {
      await page.goto(`${base}/?role=${role}`);
      await page.waitForTimeout(100);
      const homeFirst = role==='general_worker'||(mobile&&['promotion_lead','promotion_staff'].includes(role));
      assert.equal(await page.locator('#desktop-app-shell').isVisible(),!homeFirst,`${role} mobile=${mobile}`);
      if (['promotion_lead','promotion_staff','operations_manager'].includes(role)) {
        if (homeFirst) await page.getByRole('button',{name:/운영팀 업무 열기|홍보 업무 열기/}).click();
        await page.getByRole('button',{name:'직원 홈',exact:true}).click();
        await page.locator('#employee-common-home').waitFor({state:'visible'});
        assert.equal(await page.locator('#desktop-app-shell').isVisible(),false);
        await page.getByRole('button',{name:/운영팀 업무 열기|홍보 업무 열기/}).click();
        assert.equal(await page.locator('#desktop-app-shell').isVisible(),true);
      }
    }
    for (const role of ['promotion_lead','promotion_staff']) {
      await page.goto(`${base}/?role=${role}&view=dashboard`);
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#desktop-app-shell').isVisible(),true);
      assert.equal(new URL(page.url()).searchParams.get('view'),'dashboard');
    }
    await context.close();
  }
  console.log('PASS: desktop/mobile roles, direct links, employee-home round trips; mock read-only RPC only.');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
