// Public API/crawler audit. Browser Storage photos use fixtures unless explicitly opted in.
import { newPhotoSafeContext, isStorageRequest, boundedLivePhotoRoute } from '../tests/helpers/photo-safe-browser.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=String(process.env.PUBLIC_IMAGE_QA_BASE||'').replace(/\/$/,'');
assert.equal(new URL(base).protocol,'https:');
const output=path.resolve(process.env.PUBLIC_IMAGE_QA_OUTPUT||'promotion-image-qa-artifacts');
const required=String(process.env.PUBLIC_IMAGE_QA_REQUIRED_IDS||'').split(',').filter(Boolean);
const livePhotos = process.env.PUBLIC_IMAGE_QA_LIVE_PHOTOS === '1';
// Intentional live audit: explicit IDs and one shared finite budget across all pages.
if (livePhotos) assert.ok(required.length >= 1 && required.length <= 3, 'Live photo audit requires 1–3 explicit PUBLIC_IMAGE_QA_REQUIRED_IDS');
const allowedPhotos = new Set();
const liveBudget = boundedLivePhotoRoute(allowedPhotos);
async function auditContext(options) {
 const context = await newPhotoSafeContext(browser, options);
 if (livePhotos) await context.route(isStorageRequest, liveBudget.handle);
 return context;
}
await mkdir(output,{recursive:true});
const report={photoMode:livePhotos?'bounded-live':'fixture',base,checkedAt:new Date().toISOString(),posts:[],pages:[],widths:[320,390,1440]};
const feed=await (await fetch(base+'/.netlify/functions/public-promotion-feed?format=json')).json();
const ids=feed.items.map(item=>item.id.replace(/^promotion-/,''));
for(const id of required) assert.ok(ids.includes(id),'required post missing from actual Preview feed: '+id);
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
try {
 for(const id of (livePhotos ? required : ids)){
  const response=await fetch(base+'/.netlify/functions/public-promotion-feed?id='+id+'&format=json');assert.equal(response.status,200);
  const {item}=await response.json();
  const htmlResponse=await fetch(base+'/promotion.html?id='+id);assert.equal(htmlResponse.status,200);
  const html=await htmlResponse.text();
  const og=html.match(/<meta property="og:image" content="([^"]+)"/)[1].replaceAll('&amp;','&');
  assert.equal(og,item.public_image.url,'SSR OG differs from detail presentation');
  assert.equal(feed.items.find(row=>row.id==='promotion-'+id).thumbnail,og,'card differs from SSR OG');
  let ogStatus = 'fixture-not-probed';
  if (livePhotos) {
   const imageResponse=await fetch(og,{method:'HEAD',redirect:'error'});assert.equal(imageResponse.status,200);assert.match(imageResponse.headers.get('content-type')||'',/^image\//);
   ogStatus=imageResponse.status; allowedPhotos.add(og);
  }
  const post={id,mediaCount:item.public_media.length,og,ogStatus,browser:[]};
  for(const width of report.widths){
   const context=await auditContext({viewport:{width,height:950}});const page=await context.newPage();
   await page.goto(base+'/promotion.html?id='+id,{waitUntil:'domcontentloaded'});
   await page.locator('.article-representative-media img').scrollIntoViewIfNeeded();
   await page.locator('.article-representative-media img').evaluate(image=>image.decode());
   const result=await page.locator('.article-representative-media img').evaluate(image=>({src:image.currentSrc,naturalWidth:image.naturalWidth,complete:image.complete}));
   assert.ok(result.complete&&result.naturalWidth>0);assert.equal(result.src,og);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,'horizontal overflow');
   post.browser.push({viewportWidth:width,...result});
   if(required.includes(id))await page.screenshot({path:path.join(output,id+'-'+width+'.png'),fullPage:true});
   await context.close();
  }
  report.posts.push(post);console.log('PASS post '+id+' browser 320/390/1440; photo mode='+report.photoMode);
 }
 // Live checks are restricted to the selected representative images, never all cards.
 for(const route of (livePhotos ? [] : ['/','/archive.html'])){
  const context=await auditContext({viewport:{width:390,height:844}});const page=await context.newPage();
  await page.goto(base+route,{waitUntil:'domcontentloaded'});
  const cards=page.locator('a[href*="promotion.html?id="] img');
  await cards.first().waitFor({state:'attached'});
  const count=await cards.count();assert.ok(count>0,'no promotion cards on '+route);
  for(let i=0;i<count;i++){const image=cards.nth(i);await image.scrollIntoViewIfNeeded();await image.evaluate(node=>node.decode());}
  const broken=await cards.evaluateAll(images=>images.filter(image=>!image.complete||!image.naturalWidth).length);
  assert.equal(broken,0);report.pages.push({route,cards:count,broken});
  await context.close();console.log('PASS cards '+route+' '+count);
 }
 report.liveStorageRequests=liveBudget.stats.requests; report.liveStorageRequestLimit=liveBudget.stats.limit;
 report.status='PASS';
} finally {await browser.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));}
console.log('PUBLIC_PROMOTION_IMAGE_QA_PASS');
