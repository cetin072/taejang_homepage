import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.cwd(),dir=await mkdtemp(path.join(os.tmpdir(),'official-photo-'));
const output=process.env.PROMOTION_QA_OUTPUT||'/tmp/official-blog-photo-qa';await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{
 try { const url=new URL(req.url,'http://localhost'); if(url.pathname==='/photo-gate.html'){res.setHeader('content-type','text/html');res.end(html);return;}
 const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+path.sep))throw new Error('path');
 res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file));
 }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let html=await readFile('tests/browser/promotion-authoring-upload-gate.html','utf8');
html=html.slice(0,html.indexOf('  <script>\n    const wait'))+'</body></html>';
html=html.replace('<head>',`<head><base href="${base}/tests/browser/"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../../staff/assets/staff.css"><link rel="stylesheet" href="../../app/assets/dashboard-shell.css">`);
await writeFile(path.join(dir,'gate.html'),html);
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),args:['--allow-file-access-from-files','--no-sandbox']});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
try {for(const width of [320,390,1440]) {
 const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://supabase.example.test/**',r=>r.fulfill({contentType:'image/png',body:Buffer.from(png,'base64')}));
 await page.goto(base+'/tests/browser/promotion-authoring-upload-gate.html');
 await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('_GATE_'));
 assert.equal(await page.locator('#result').innerText(),'PROMOTION_AUTHORING_UPLOAD_GATE_PASS');
 await page.goto(base+'/photo-gate.html');
 await page.evaluate(({png})=>{
  const original=window.fetch;window.photoMode='ok';window.photoCalls=0;window.photoRelease=null;
  window.fetch=async(url,options)=>{if(String(url).includes('/external-content-meta')) {
   photoCalls++;const requested=JSON.parse(options.body).url;const mode=photoMode;
   if(mode==='pending') await new Promise(resolve=>window.photoRelease=resolve);
   if(mode==='fail') return Response.json({error:'IMAGE_UNAVAILABLE'},{status:422});
   return Response.json({url:requested,title:'자동 제목',article_text:'자동 본문',imported_image:{base64:png,type:'image/png'}});
  }return original(url,options);};
 },{png});
 await page.evaluate(()=>TaejangPromotionWorkspaceV2Api.openPromotion('write'));
 const link=page.locator('.phase-c-link-tools input[type=url]'),title=page.locator('.phase-c-board-form input').first(),body=page.locator('.phase-c-board-form textarea');
 await title.fill('유지할 제목');await body.fill('유지할 본문');
 await link.fill('https://blog.naver.com/taejang-official/224446512548');
 await page.waitForFunction(()=>document.querySelectorAll('.phase-c-photo-card').length===1).catch(async e=>{console.error(await page.locator('.phase-c-link-tools').innerText());throw e;});
 assert.equal(await title.inputValue(),'유지할 제목');assert.equal(await body.inputValue(),'유지할 본문');
 assert.equal(await page.evaluate(()=>state.storageCalls.length),1);
 assert.equal(await page.locator('[data-composer-preview] img').first().evaluate(img=>img.complete && img.naturalWidth>0),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await link.dispatchEvent('input');await page.waitForTimeout(800);assert.equal(await page.evaluate(()=>photoCalls),1);
 await page.screenshot({path:path.join(output,`attached-${width}.png`),fullPage:true});
 await page.getByRole('button',{name:'임시저장',exact:true}).click();
 await page.waitForFunction(()=>state.saveCalls.length===1);
 const saved=await page.evaluate(()=>state.saveCalls[0]);assert.equal(saved.p_public_media.length,1);assert.equal(saved.p_public_media[0].official_blog_post,'224446512548');assert.equal(saved.p_hero_image_url,saved.p_public_media[0].url);
 // Reload-equivalent: reconstruct the composer from the saved RPC media and source marker.
 await page.evaluate(saved=>{const rpc=TaejangApp.rpc;TaejangApp.rpc=async(name,args)=>name==='get_my_promotion_workspace'?{role:'promotion_lead',my_items:[{content_id:'11111111-1111-4111-8111-111111111111',lifecycle:'draft',title:saved.p_title,public_body:saved.p_public_body,external_url:saved.p_external_url,public_media:saved.p_public_media,hero_image_url:saved.p_hero_image_url}],review_items:[],publication_items:[]}:rpc(name,args);},saved);
 await page.evaluate(()=>TaejangPromotionWorkspaceV2Api.openPromotion('write'));
 await page.getByRole('button',{name:'열어 수정',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.phase-c-photo-card').length===1);
 const before=await page.evaluate(()=>photoCalls);await link.dispatchEvent('input');await page.waitForTimeout(800);assert.equal(await page.evaluate(()=>photoCalls),before,'restored media prevents duplicate');
 // A new composer simulates navigating away; late work must never attach there.
 await page.evaluate(()=>TaejangPromotionWorkspaceV2Api.openPromotion('write'));
 await page.evaluate(()=>photoMode='pending');await link.fill('https://blog.naver.com/taejang-official/123');
 await page.waitForFunction(()=>!!photoRelease);
 await link.fill('https://blog.naver.com/taejang-official/456');await page.evaluate(()=>{photoMode='ok';photoRelease();});
 await page.waitForFunction(()=>document.querySelectorAll('.phase-c-photo-card').length===1);
 assert.equal(await page.evaluate(()=>state.storageCalls.length),2,'stale result did not upload');
 // Retry failure preserves existing attachment and text.
 await page.evaluate(()=>photoMode='fail');await title.fill('실패 보존');await body.fill('본문 보존');await link.fill('https://blog.naver.com/taejang-official/789');
 await page.waitForFunction(()=>document.querySelector('.phase-c-link-tools .phase-c-upload-status').textContent.includes('직접 첨부'));
 assert.equal(await page.locator('.phase-c-photo-card').count(),1);assert.equal(await title.inputValue(),'실패 보존');
 await page.evaluate(()=>{photoMode='ok';state.uploadFailureStatus=403;});await page.getByRole('button',{name:'링크에서 제목·썸네일·본문 가져오기',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.phase-c-link-tools .phase-c-upload-status').textContent.includes('사진 저장 권한'));
 assert.equal(await page.locator('.phase-c-photo-card').count(),1);assert.equal(await title.inputValue(),'실패 보존');
 await page.evaluate(()=>state.uploadFailureStatus=null);
 await page.evaluate(()=>photoMode='ok');await page.getByRole('button',{name:'링크에서 제목·썸네일·본문 가져오기',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.phase-c-photo-card').length===2);
 await page.locator('.phase-c-photo-card').last().getByRole('button',{name:'앞으로',exact:true}).click();
 await page.locator('.phase-c-photo-card').first().getByRole('button',{name:'사진 빼기',exact:true}).click();assert.equal(await page.locator('.phase-c-photo-card').count(),1);
 const calls=await page.evaluate(()=>photoCalls);await link.fill('https://blog.naver.com/other/123');await page.waitForTimeout(800);assert.equal(await page.evaluate(()=>photoCalls),calls);
 assert.deepEqual(errors,[]);console.log(`official photo ${width}: PASS (auto attachment/save/stale/dedup/failure/retry/remove/external)`);await page.close();
}}finally{await browser.close();server.close();await rm(dir,{recursive:true,force:true});}
