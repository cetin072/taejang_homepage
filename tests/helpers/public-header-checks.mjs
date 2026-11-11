import { newPhotoSafeContext } from './photo-safe-browser.mjs';
import {recordBrowserDiagnostics} from '../../scripts/browser-network-diagnostics.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gotoPublicDocument, gotoPublicReady } from './public-page-ready.mjs';

const order = ['about.html','business.html','workplace.html','archive.html','partnership.html','resources.html','staff/'];
const hrefs = nav => [...nav.querySelectorAll(':scope > a')].map(a => a.getAttribute('href'));
const canonicalHref = href => {
  const relative = href.replace(/^\//,'');
  return relative==='staff/' ? relative : relative.replace(/\.html$/,'')+'.html';
};

async function headerReady(page,url,diagnostics) {
  diagnostics.length=0;
  try {
  const response=await gotoPublicDocument(page,url);
  assert.equal(response.status(),200,'header document');
  await page.waitForFunction(()=>document.documentElement.classList.contains('js-nav-ready') &&
    [...document.querySelectorAll('link[rel="stylesheet"]')].every(l=>l.sheet) &&
    [...document.querySelectorAll('.site-header img')].every(i=>i.complete&&i.naturalWidth>0));
  await page.evaluate(async()=>{await document.fonts.load('700 16px "Nanum Gothic"','서비스·상품');await document.fonts.ready;});
  assert.ok(await page.locator('.site-header').isVisible());
  } catch(error) {
    console.error('HEADER_ASSET_DIAGNOSTICS:'+url+'\n'+diagnostics.join('\n'));
    throw error;
  }
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
    const context = await newPhotoSafeContext(browser, {viewport:{width,height:1000},reducedMotion:'reduce'});
    const page = await context.newPage();
    const diagnostics=recordBrowserDiagnostics(page);
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
      await page.waitForFunction(()=>[...document.querySelectorAll('link[rel="stylesheet"]')].every(link=>link.sheet));
      await page.evaluate(()=>{
        const navs=[...document.querySelectorAll('.desktop-nav,[data-mobile-nav]')];
        window.__menuBeforeSite = {
          ready: document.documentElement.classList.contains('js-nav-ready'),
          visible: getComputedStyle(navs[1]).display !== 'none'
        };
        window.__headerBefore=navs.map(n=>[...n.children].map(a=>a.getAttribute('href')));
        window.__headerMutations=[];
        navs.forEach(n=>new MutationObserver(records=>window.__headerMutations.push(...records.map(r=>r.type))).observe(n,{childList:true,subtree:true,characterData:true}));
      });
      await route.continue();
    });
    for (const file of [...pages,...(width===1440?generated:[])]) {
      // This new gate measures shared headers, not the unrelated live archive
      // feed. Keep the existing whole-landing readiness gate unchanged below.
      await headerReady(page,base+'/'+file,diagnostics);
      const first = await page.evaluate(()=>window.__headerBefore);
      assert.deepEqual(await page.evaluate(()=>window.__menuBeforeSite),
        {ready:true,visible:false},file+': menu is closed before later site.js enhancement, without a first-paint flash');
      assert.deepEqual(first.map(links=>links.map(canonicalHref)),[order,order],file+': first authored order on both surfaces, including Netlify pretty URLs');
      for (const selector of ['.desktop-nav','[data-mobile-nav]']) assert.deepEqual((await page.locator(selector).evaluate(hrefs)).map(canonicalHref),order,file+': runtime order');
      await page.waitForTimeout(120);
      assert.deepEqual(await page.evaluate(()=>window.__headerMutations),[],file+': no runtime header insertion/removal/reorder');
      if(width===390) {
        await page.locator('[data-menu-button]').click();
        const metrics=await page.locator('[data-mobile-nav]').evaluate(nav=>({
          links:[...nav.children].map(a=>({h:a.getBoundingClientRect().height,left:a.getBoundingClientRect().left})),
          staff:nav.querySelector('.staff-nav').innerText,
          app:nav.querySelector('.resources-nav').innerText,
          border:getComputedStyle(nav.querySelector('.resources-nav')).borderLeftWidth,
          indent:getComputedStyle(nav.querySelector('.resources-nav')).paddingLeft,
          contact:getComputedStyle(nav.querySelector('a[href*="partnership"]')).backgroundColor,
          contactCurrent:nav.querySelector('a[href*="partnership"]').getAttribute('aria-current')==='page'
        }));
        assert.ok(metrics.links.every(l=>l.h>=44),file+': mobile touch areas');
        assert.equal(metrics.links.at(-1).left,metrics.links.at(-2).left);
        assert.equal(metrics.border,'0px');assert.equal(metrics.indent,'0px');
        assert.match(metrics.staff,/임직원\s+업무 플랫폼 로그인/);
        assert.match(metrics.app,/서비스·상품\s+출근앱과 상품 안내/);
        assert.equal(metrics.contact,metrics.contactCurrent?'rgb(27, 67, 50)':'rgb(45, 106, 79)',file+': contact retains its existing normal/current CTA colors');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('[data-mobile-nav]').isVisible(),false,file+': Escape closes menu');
        assert.equal(await page.locator('[data-menu-button]').getAttribute('aria-expanded'),'false');
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
      await page.locator(selector+' > a').nth(order.indexOf(target)).click();
      await page.waitForURL(url=>url.pathname===('/'+target)||url.pathname===('/'+target.replace(/\.html$/,''))||target==='staff/'&&/\/staff\/?$/.test(url.pathname));
      assert.equal((await page.request.get(page.url(),{maxRetries:1})).status(),200,target+': destination HTTP200');
    }
    // Actual menu under enlarged text, including utility subtitles and scroll reachability.
    await gotoPublicReady(page,base+'/index.html',output);
    if(width===390){
      await page.locator('[data-menu-button]').click();
      await page.locator('.site-header .brand').click();
      await page.waitForURL(url=>/^\/(?:index(?:\.html)?)?$/.test(url.pathname));
      await page.waitForFunction(()=>window.__menuBeforeSite?.ready);
      assert.equal(await page.locator('[data-mobile-nav]').isVisible(),false,'logo navigates home without opening the menu');
      await page.locator('[data-menu-button]').click();
      await page.setViewportSize({width:1440,height:1000});
      await page.waitForFunction(()=>!document.body.classList.contains('nav-open'));
      await page.setViewportSize({width:390,height:1000});
      assert.equal(await page.locator('[data-mobile-nav]').isVisible(),false,'resize resets open state and scroll lock');
      await page.locator('[data-menu-button]').click();
      await page.screenshot({path:path.join(output,'header-mobile-390.png')});
      await page.addStyleTag({content:'.mobile-nav a,.mobile-nav .nav-entry-label{font-size:200%!important}.mobile-nav .nav-entry-description{font-size:28px!important}'});
      const app=page.locator('.mobile-nav .resources-nav');
      await app.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.ok((await app.boundingBox()).height>=44);
      await page.screenshot({path:path.join(output,'header-mobile-text200.png')});
    } else await page.screenshot({path:path.join(output,'header-pc-1440.png')});
    assert.deepEqual(errors,[],width+': no product script errors');
    await context.close();
  }
  for(const width of[1440,390]){
    const context=await newPhotoSafeContext(browser, {viewport:{width,height:900},javaScriptEnabled:false});
    const page=await context.newPage();await page.goto(base+'/index.html');
    for(const selector of['.desktop-nav','[data-mobile-nav]'])assert.deepEqual((await page.locator(selector).evaluate(hrefs)).map(canonicalHref),order,'no-JS authored order including pretty URLs');
    assert.ok(await page.locator(width===390?'[data-mobile-nav]':'.desktop-nav').isVisible(),'no-JS navigation remains visible');
    if(width===390)assert.equal(await page.locator('[data-menu-button]').isVisible(),false,'no-JS fallback has no inactive toggle');
    await context.close();
  }
  // The resource hub is authored HTML: pending materials are not dead links,
  // and the available card makes the round trip without a runtime data fetch.
  for (const javaScriptEnabled of [true, false]) for (const width of [1440, 390, 320]) {
    const context = await newPhotoSafeContext(browser, {viewport:{width,height:900},javaScriptEnabled,reducedMotion:'reduce'});
    const page = await context.newPage();
    await page.goto(base+'/resources.html');
    await page.waitForFunction(()=>[...document.querySelectorAll('link[rel="stylesheet"]')].every(link=>link.sheet));
    assert.equal(await page.locator('h1').innerText(),'서비스·상품');
    assert.equal(await page.locator('.resource-card').count(),4);
    assert.equal(await page.locator('#resource-company-title').count(),0,'brochure card waits until its approved public release');
    assert.equal(await page.locator('.resource-card--pending').count(),1);
    assert.equal(await page.locator('#resource-salt-title').innerText(),'뉴질랜드 천일염');
    assert.equal(await page.getByText('태장 업무수첩', {exact:true}).count(),1);
    assert.equal(await page.locator('.resource-card--pending a, .resource-card--pending button, .resource-card--pending [tabindex]').count(),0,'unpublished cards are not interactive');
    assert.equal(await page.locator('a[href="#"], a[download]').count(),0,'no fake downloads');
    assert.equal(await page.locator('.desktop-nav .resources-nav').getAttribute('aria-current'),'page');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'resource cards fit viewport');
    assert.equal(await page.locator('.resources-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),width>760?2:1);
    const card=page.locator('.resource-card--link[aria-labelledby="resource-staff-title"]');
    await card.focus();
    assert.equal(await card.evaluate(el=>document.activeElement===el),true);
    if(javaScriptEnabled) await page.screenshot({path:path.join(output,'resources-'+width+'.png'),fullPage:true});
    await page.keyboard.press('Enter');
    await page.waitForURL(url=>/\/employee-app(?:\.html)?$/.test(url.pathname));
    await page.locator('.resources-breadcrumb a').click();
    await page.waitForURL(url=>/\/resources(?:\.html)?$/.test(url.pathname));
    const saltCard=page.locator('.resource-card--link[aria-labelledby="resource-salt-title"]');
    assert.equal(await saltCard.locator('.resource-status').innerText(),'판매 중');
    assert.equal(await page.locator('.resource-card--pending .resource-status').innerText(),'준비 중');
    assert.equal(await page.locator('.resource-card--pending h3').innerText(),'태장 업무수첩');
    assert.equal(await page.locator('.resource-card--link[aria-labelledby="resource-terrarium-title"]').count(),1);
    await saltCard.focus();
    assert.equal(await saltCard.evaluate(el=>document.activeElement===el),true);
    await page.keyboard.press('Enter');
    await page.waitForURL(url=>/\/new-zealand-salt(?:\.html)?$/.test(url.pathname));
    assert.equal((await page.request.get(page.url())).status(),200,'salt landing responds');
    const inquiry=page.locator('.salt-sticky');
    const inquiryAction=await inquiry.isVisible() ? inquiry : page.locator('.salt-hero a[href="#salt-contact"]');
    // Local pointer coverage is retained. Netlify's review-only drawer can
    // overlap the mobile CTA, so hosted QA verifies native keyboard activation.
    if(process.env.EMPLOYEE_APP_QA_REQUIRE_HOSTED==='1') await inquiryAction.press('Enter');
    else await inquiryAction.click();
    await page.waitForURL(url=>url.hash==='#salt-contact');
    assert.ok(await page.locator('#salt-contact').isVisible(),'product inquiry is reachable without submitting personal data');
    await page.goBack();
    await page.goBack();
    await page.waitForURL(url=>/\/resources(?:\.html)?$/.test(url.pathname));
    assert.equal(await page.locator('.resource-card').count(),4,'Back preserves hub cards');
    await context.close();
  }
  // Network failure boundaries: later enhancements cannot disable the menu;
  // The head controller is inlined at build time and must not depend on a
  // network request. JavaScript-disabled fallback is checked above.
  for (const failed of ['site.js','public-navigation.js']) {
    const context=await newPhotoSafeContext(browser, {viewport:{width:390,height:1000}});
    let requests=0;
    await context.route('**/assets/js/'+failed,route=>{requests++;return route.abort();});
    const page=await context.newPage();
    await page.goto(base+'/about.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>[...document.querySelectorAll('link[rel="stylesheet"]')].every(link=>link.sheet));
    if(failed==='public-navigation.js')assert.equal(requests,0,'published header requires no controller download');
    assert.equal(await page.locator('[data-mobile-nav]').isVisible(),false);
    await page.locator('[data-menu-button]').click();
    assert.equal(await page.locator('[data-mobile-nav]').isVisible(),true,failed+': core navigation remains usable');
    await context.close();
  }
  await fs.writeFile(path.join(output,'public-header-results.json'),JSON.stringify({scope:'shared header only; whole-landing checks run separately',results,clickRoutes:order,credentialsSubmitted:false,externalBodyImageWarnings},null,2));
  console.log('PASS public headers: '+results.length+' real pages, first paint/order/stability, all menu clicks, mobile text zoom');
}
