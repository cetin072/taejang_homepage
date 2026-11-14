import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('dist');
const output = process.env.CERTIFICATIONS_QA_OUTPUT || '/tmp/certifications-qa';
await fs.mkdir(output, { recursive:true });
const types = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.webp':'image/webp'};
const server = http.createServer(async(req,res) => {
  try {
    let pathname = new URL(req.url,'http://localhost').pathname;
    if (!path.extname(pathname)) pathname += '.html';
    const file = path.resolve(root,'.'+pathname);
    if (!file.startsWith(root+path.sep)) throw Error('path');
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base = process.env.PREVIEW_URL || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
try {
 for (const width of [320,390,768,1440]) {
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  await context.route('**/*',route=>['GET','HEAD'].includes(route.request().method())?route.fallback():route.abort());
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  assert.equal((await page.goto(base+'/certifications.html')).status(),200);
  await page.evaluate(()=>document.fonts.ready);
  for(const img of await page.locator('main img').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode());}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow');
  assert.equal(await page.locator('main figure').count(),4);
  for(const img of await page.locator('main figure img').all()) assert.ok(await img.evaluate(e=>Math.abs(e.clientWidth/e.clientHeight-e.naturalWidth/e.naturalHeight)<.03),'uncropped evidence');
  if(width<760) assert.equal(await page.locator('.certification-facts > div').first().evaluate(e=>getComputedStyle(e).display),'grid');
  const links=page.locator('[data-certification-image]');
  for(let i=0;i<4;i++){
   const link=links.nth(i);await link.click();
   const dialog=page.locator('.certification-viewer');assert.ok(await dialog.isVisible());
   await dialog.locator('img').evaluate(e=>e.decode());
   assert.equal(await dialog.locator('img').getAttribute('src'),await link.evaluate(e=>e.href));
   assert.ok(await dialog.evaluate(e=>e.getBoundingClientRect().width<=innerWidth),'dialog fits');
   await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('.certification-viewer-original').evaluate(e=>e===document.activeElement),true);
   await page.keyboard.press('Tab');assert.equal(await dialog.locator('button').evaluate(e=>e===document.activeElement),true);
   if(i===0){await page.screenshot({path:path.join(output,`viewer-${width}.png`)});await page.keyboard.press('Escape');}
   else if(i===1){await page.mouse.click(2,2);}
   else await dialog.getByRole('button',{name:'사진 확대 닫기'}).click();
   assert.equal(await dialog.isVisible(),false);
   assert.ok(await link.evaluate(e=>e===document.activeElement),'focus restored');
   assert.notEqual(await page.evaluate(()=>document.documentElement.style.overflow),'hidden');
  }
  await page.evaluate(()=>scrollTo(0,0));
  const boxes=()=>page.locator('header,main > section').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}));
  const stable=await boxes();await page.waitForTimeout(500);assert.deepEqual(await boxes(),stable,'layout remains stable');
  await page.screenshot({path:path.join(output,`page-${width}.png`),fullPage:true});
  assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${width}px: layout, originals, 4 dialogs, Escape/backdrop/close, focus and keyboard`);
 }
 const off=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});const p=await off.newPage();await p.goto(base+'/certifications.html');await p.locator('[data-certification-image]').first().click();assert.ok(p.url().endsWith('standard-workplace-certificate-2026-049.png'));await off.close();
 const failure=await browser.newContext();const p2=await failure.newPage();await p2.goto(base+'/certifications.html');await p2.route('**/standard-workplace-certificate-2026-049.png',r=>r.abort());await p2.locator('[data-certification-image]').first().click();await p2.locator('.certification-viewer-error').waitFor({state:'visible'});assert.ok(await p2.locator('.certification-viewer-original').isVisible());await failure.close();
 console.log('PASS JS-off original navigation and failed-image recovery');
} finally {await browser.close();await new Promise(r=>server.close(r));}
