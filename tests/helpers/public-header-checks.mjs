import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gotoPublicReady } from './public-page-ready.mjs';

const order = ['about.html','business.html','workplace.html','archive.html','partnership.html','staff/','employee-app.html'];
const hrefs = nav => [...nav.querySelectorAll(':scope > a')].map(a => a.getAttribute('href'));

async function headerReady(page,url) {
  const response=await page.goto(url,{waitUntil:'domcontentloaded'});
  assert.equal(response.status(),200,'header document');
  await page.waitForFunction(()=>document.documentElement.classList.contains('js-nav-ready') &&
    [...document.querySelectorAll('link[rel="stylesheet"]')].every(l=>l.sheet) &&
    [...document.querySelectorAll('.site-header img')].every(i=>i.complete&&i.naturalWidth>0));
  await page.evaluate(async()=>{await document.fonts.load('700 16px "Nanum Gothic"','직원앱 안내');await document.fonts.ready;});
  assert.ok(await page.locator('.site-header').isVisible());
}

// Real local + exact-head hosted gate. Public navigation only; no login submission,
// credentials, hosted mutations or employee data. Static checks alone cannot prove this.
export async function exercisePublicHeaders(browser, base, root, output) {
  const pages = [];
  for (const name of await fs.readdir(root)) {
    if (name.endsWith('.html') && (await fs.readFile(path.join(root,name),'utf8')).includes('class="desktop-nav"')) pages.push(name);
  }
  const generated = [];
  for (const dir of ['activities','workplace']) for (const name of await fs.readdir(path.join(root,dir))) {
    if (name.endsWith('.html')) generated.push(dir+'/'+name);
  }
  const results = [];
  const externalBodyImageWarnings = [];
  for (const width of [1440,390]) {
    const context = await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('requestfailed',r=>{
      if(r.resourceType()==='image' && new URL(r.url()).origin!==new URL(base).origin)
        externalBodyImageWarnings.push({page:page.url(),url:r.url(),error:r.failure()?.errorText});
    });
    // Snapshot before site.js runs, not only the final DOM. Intercept the script
    // download without blocking CSS/fonts or the Preview toolbar.
    await page.route('**/assets/js/site.js',async route=>{
      await page.waitForFunction(()=>document.querySelectorAll('.desktop-nav,[data-mobile-nav]').length===2);
      await page.evaluate(()=>{
        const navs=[...document.querySelectorAll('.desktop-nav,[data-mobile-nav]')];
        window.__headerBefore=navs.map(n=>[...n.children].map(a=>a.getAttribute('href')));
        window.__headerMutations=[];
        navs.forEach(n=>new MutationObserver(records=>window.__headerMutations.push(...records.map(r=>r.type))).observe(n,{childList:true,subtree:true,characterData:true}));
      });
      await route.continue();
    });
    for (const file of [...pages,...(width===1440?generated:[])]) {
      // This new gate measures shared headers, not the unrelated live archive
      // feed. Keep the existing whole-landing readiness gate unchanged below.
      await headerReady(page,base+'/'+file);
      const first = await page.evaluate(()=>window.__headerBefore);
      assert.deepEqual(first,[order,order],file+': first authored order on both surfaces');
      for (const selector of ['.desktop-nav','[data-mobile-nav]']) assert.deepEqual(await page.locator(selector).evaluate(hrefs),order,file+': runtime order');
      await page.waitForTimeout(120);
      assert.deepEqual(await page.evaluate(()=>window.__headerMutations),[],file+': no runtime header insertion/removal/reorder');
      if(width===390) {
        await page.locator('[data-menu-button]').click();
        const metrics=await page.locator('[data-mobile-nav]').evaluate(nav=>({
          links:[...nav.children].map(a=>({h:a.getBoundingClientRect().height,left:a.getBoundingClientRect().left})),
          staff:nav.querySelector('.staff-nav').innerText,
          app:nav.querySelector('.employee-app-nav').innerText,
          border:getComputedStyle(nav.querySelector('.employee-app-nav')).borderLeftWidth,
          indent:getComputedStyle(nav.querySelector('.employee-app-nav')).paddingLeft,
          contact:getComputedStyle(nav.querySelector('a[href*="partnership"]')).backgroundColor,
          contactCurrent:nav.querySelector('a[href*="partnership"]').getAttribute('aria-current')==='page'
        }));
        assert.ok(metrics.links.every(l=>l.h>=44),file+': mobile touch areas');
        assert.equal(metrics.links.at(-1).left,metrics.links.at(-2).left);
        assert.equal(metrics.border,'0px');assert.equal(metrics.indent,'0px');
        assert.match(metrics.staff,/임직원\s+업무 플랫폼 로그인/);
        assert.match(metrics.app,/직원앱 안내\s+앱 설치 및 사용 방법/);
        assert.equal(metrics.contact,metrics.contactCurrent?'rgb(27, 67, 50)':'rgb(45, 106, 79)',file+': contact retains its existing normal/current CTA colors');
        await page.keyboard.press('Escape');
      } else {
        const header=await page.locator('.header-inner').evaluate(el=>({height:el.getBoundingClientRect().height,links:[...el.querySelectorAll('nav>a')].map(a=>({top:a.getBoundingClientRect().top,bottom:a.getBoundingClientRect().bottom,left:a.getBoundingClientRect().left,right:a.getBoundingClientRect().right}))}));
        assert.equal(header.height,80,file+': desktop header height');
        assert.ok(header.links.every((b,i)=>!i||b.left>=header.links[i-1].right),file+': no overlap');
        assert.ok(header.links.every(b=>Math.abs((b.top+b.bottom)-(header.links[0].top+header.links[0].bottom))<4),file+': single row');
      }
      results.push({file,width,firstPaintOrder:true,noRuntimeReorder:true});
    }
    // Click every actual menu entry, including staff/, rather than merely reading hrefs.
    for(const target of order) {
      await gotoPublicReady(page,base+'/index.html',output);
      if(width===390)await page.locator('[data-menu-button]').click();
      const selector=width===390?'[data-mobile-nav]':'.desktop-nav';
      await page.locator(selector+' a[href="'+target+'"]').click();
      await page.waitForURL(url=>url.pathname===('/'+target)||url.pathname===('/'+target.replace(/\.html$/,''))||target==='staff/'&&/\/staff\/?$/.test(url.pathname));
      assert.equal((await page.request.get(page.url())).status(),200,target+': destination HTTP200');
    }
    // Actual menu under enlarged text, including utility subtitles and scroll reachability.
    await gotoPublicReady(page,base+'/index.html',output);
    if(width===390){
      await page.locator('[data-menu-button]').click();
      await page.screenshot({path:path.join(output,'header-mobile-390.png')});
      await page.addStyleTag({content:'.mobile-nav a,.mobile-nav .nav-entry-label{font-size:200%!important}.mobile-nav .nav-entry-description{font-size:28px!important}'});
      const app=page.locator('.mobile-nav .employee-app-nav');
      await app.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.ok((await app.boundingBox()).height>=44);
      await page.screenshot({path:path.join(output,'header-mobile-text200.png')});
    } else await page.screenshot({path:path.join(output,'header-pc-1440.png')});
    assert.deepEqual(errors,[],width+': no product script errors');
    await context.close();
  }
  for(const width of[1440,390]){
    const context=await browser.newContext({viewport:{width,height:900},javaScriptEnabled:false});
    const page=await context.newPage();await page.goto(base+'/index.html');
    for(const selector of['.desktop-nav','[data-mobile-nav]'])assert.deepEqual(await page.locator(selector).evaluate(hrefs),order,'no-JS authored order');
    assert.ok(await page.locator(width===390?'[data-mobile-nav]':'.desktop-nav').isVisible(),'no-JS navigation remains visible');
    await context.close();
  }
  await fs.writeFile(path.join(output,'public-header-results.json'),JSON.stringify({scope:'shared header only; whole-landing checks run separately',results,clickRoutes:order,credentialsSubmitted:false,externalBodyImageWarnings},null,2));
  console.log('PASS public headers: '+results.length+' real pages, first paint/order/stability, all menu clicks, mobile text zoom');
}
