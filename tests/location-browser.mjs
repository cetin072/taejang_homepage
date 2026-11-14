import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('dist');
const output = process.env.LOCATION_QA_OUTPUT || '/tmp/location-qa';
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
  await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedAddress=value;}}}));
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  assert.equal((await page.goto(base+'/location.html')).status(),200);
  await page.evaluate(()=>document.fonts.ready);
  const map=page.getByRole('link',{name:'네이버지도에서 위치 보기'});
  const mapBox=await map.boundingBox();assert.ok(mapBox.y+mapBox.height<800,`map promptly visible at ${width}: ${JSON.stringify(mapBox)}`);
  const copy=page.getByRole('button',{name:'주소 복사'});
  await copy.focus();assert.equal(await copy.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
  await page.keyboard.press('Enter');await page.getByRole('status').filter({hasText:'주소를 복사했습니다.'}).waitFor();
  assert.equal(await page.evaluate(()=>window.copiedAddress),'경남 창원시 의창구 평산로 33 신화 더 플렉스시티 422·423호');
  await page.evaluate(()=>navigator.clipboard.writeText=async()=>{throw Error('denied');});
  await copy.click();await page.getByRole('status').filter({hasText:'복사하지 못했습니다.'}).waitFor();assert.ok(await copy.isEnabled());
  await page.evaluate(()=>navigator.clipboard.writeText=async value=>{window.copiedAddress=value;});
  await copy.click();await page.getByRole('status').filter({hasText:'주소를 복사했습니다.'}).waitFor();
  for(const img of await page.locator('main img').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(e=>e.decode());assert.ok(await img.evaluate(e=>Math.abs(e.clientWidth/e.clientHeight-e.naturalWidth/e.naturalHeight)<.03));}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
  assert.ok(await page.locator('.location-farm-scale').innerText().then(s=>s.includes('1만 평')));
  assert.equal(await page.getByRole('link',{name:'농장 소개 보기',exact:true}).getAttribute('href'),'farm.html');
  assert.equal(await page.getByRole('link',{name:'농장 관련 문의',exact:true}).getAttribute('href'),'partnership.html#contact');
  await page.evaluate(()=>{document.querySelector('[data-copy-status]').textContent='';scrollTo(0,0);});
  await page.screenshot({path:path.join(output,`location-${width}.png`),fullPage:true});
  assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${width}px: address, map, copy success/failure/retry, imagery, links and layout`);
 }
 const off=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});const p=await off.newPage();await p.goto(base+'/location.html');assert.ok(await p.locator('#office-address').isVisible());assert.ok(await p.getByRole('link',{name:'네이버지도에서 위치 보기'}).isVisible());assert.equal(await p.locator('[data-copy-address]').isVisible(),false);await off.close();
 console.log('PASS JS-off address/map and no inactive copy button');
} finally {await browser.close();await new Promise(r=>server.close(r));}
