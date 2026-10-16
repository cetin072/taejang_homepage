import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile,writeFile,mkdtemp,mkdir,rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve('.'), preview=process.env.PREVIEW_URL?.replace(/\/$/,'');
if(preview)assert.equal(new URL(preview).protocol,'https:');
const dir=await mkdtemp(path.join(os.tmpdir(),'promotion-composer-'));
const output=process.env.PROMOTION_QA_OUTPUT||path.join(os.tmpdir(),'promotion-composer-qa');await mkdir(output,{recursive:true});
let html=await readFile('tests/browser/promotion-authoring-upload-gate.html','utf8');
html=html.replace('<head>',`<head><base href="${pathToFileURL(path.join(root,'tests/browser/')).href}"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../../staff/assets/staff.css"><link rel="stylesheet" href="../../app/assets/dashboard-shell.css">`);
if(preview)html=html.replaceAll('src="../../app/assets/',`src="${preview}/app/assets/`).replaceAll('href="../../app/assets/',`href="${preview}/app/assets/`).replaceAll('href="../../staff/assets/',`href="${preview}/staff/assets/`);
await writeFile(path.join(dir,'gate.html'),html);
const browser=await chromium.launch({headless:true,args:['--allow-file-access-from-files'],...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
try{
 for(const width of [320,390,768,1440]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://example.test/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="green"/></svg>'}));
  await page.goto(pathToFileURL(path.join(dir,'gate.html')).href);
  await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('_GATE_'),null,{timeout:20000});
  assert.equal(await page.locator('#result').innerText(),'PROMOTION_AUTHORING_UPLOAD_GATE_PASS');
  await page.evaluate(()=>{
   window.testRole='promotion_staff';window.testItems=[];window.testFailSave=false;window.testFailSubmit=false;window.testCalls=[];window.testAlerts=[];
   window.alert=m=>testAlerts.push(m);const original=TaejangApp.rpc;
   TaejangApp.getRoute=()=>testRole;
   TaejangApp.can=c=>c==='promotion.edit_any_unpublished'?testRole==='operations_manager':['promotion.write','promotion.edit_own','promotion.review_lead','promotion.queue_publication'].includes(c);
   TaejangApp.rpc=async(name,args)=>{testCalls.push({name,args:structuredClone(args)});
    if(name==='get_my_promotion_workspace')return {role:testRole,my_items:testItems,review_items:[],publication_items:[]};
    if(name==='save_promotion_draft'||name==='save_operations_promotion_draft'){if(testFailSave)throw Error('SYNTHETIC_SAVE_FAILED');return original('save_promotion_draft',args);}
    if(name==='submit_promotion_revision'){if(testFailSubmit)throw Error('SYNTHETIC_SUBMIT_FAILED');}
    return original(name,args);
   };state.externalUnauthorizedOnce=false;state.uploadFailureStatus=null;
  });
  for(const name of ['official-channel-config.js','issue-181-promotion-live-ux.js','issue-187-promotion-live-qa.js'])await page.addScriptTag({url:preview?`${preview}/app/assets/${name}`:pathToFileURL(path.join(root,'app/assets',name)).href});
  await page.evaluate(async()=>{await TaejangPromotionWorkspaceV2Api.openPromotion('write');document.dispatchEvent(new Event('taejang-app-ready'));});
  await page.waitForTimeout(300);
  const title=page.locator('.phase-c-board-form label').filter({has:page.locator('span',{hasText:/^제목$/})}).locator('input').first();
  const body=page.locator('.phase-c-board-form textarea');
  await title.fill('<img src=x onerror=alert(1)> 환경정비 활동');await body.fill('첫 문단\n둘째 문단 <script>alert(1)</script>');
  const live=page.locator('[data-composer-preview]');
  assert.match(await live.innerText(),/둘째 문단 <script>/);assert.equal(await live.locator('script').count(),0);
  assert.equal(await page.evaluate(()=>testCalls.filter(c=>c.name.startsWith('save_')).length),0,'preview never saves');
  assert.equal(await page.locator('.phase-c-composer-options select').first().isVisible(),false,'staff kind hidden');
  const order=await page.evaluate(()=>{const f=document.querySelector('.phase-c-board-form'),a=[...f.children];return a.map(n=>n.textContent.slice(0,20));});
  assert.ok(order[0].startsWith('제목')&&order[1].startsWith('본문'),'title and body adjacent');
  const file=page.locator('.phase-c-editor-toolbar input[type=file]');
  await file.setInputFiles([{name:'first.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71])},{name:'second.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71])}]);
  await page.waitForFunction(()=>document.querySelectorAll('.phase-c-photo-card').length===2);
  await page.locator('.phase-c-photo-card').first().getByRole('button',{name:'뒤로',exact:true}).click();
  assert.equal(await live.locator('.phase-c-photo-grid img').first().getAttribute('alt'),'second');
  await page.locator('.phase-c-photo-card').first().getByRole('button',{name:'사진 빼기',exact:true}).click();
  assert.equal(await live.locator('.phase-c-photo-grid img').count(),1);
  const link=page.locator('.phase-c-link-tools input[type=url]');await link.fill('https://www.youtube.com/watch?v=fixture');
  await page.locator('[data-issue181-link-source]').selectOption('taejang_youtube');
  await page.getByRole('button',{name:'링크 정보 가져오기',exact:true}).click();await page.waitForTimeout(150);
  assert.equal(await title.inputValue(),'<img src=x onerror=alert(1)> 환경정비 활동','typed text survives import');
  assert.equal(await live.locator('h2').innerText(),await title.inputValue(),'preview reflects post-import guard');
  await link.fill('javascript:alert(1)');assert.equal(await live.locator('a[href^="javascript:"]').count(),0);
  await link.fill('https://blog.naver.com/example/1');
  await page.locator('.phase-c-composer-options input[type=date]').fill('2026-10-23');
  await page.locator('.phase-c-composer-options select').nth(1).selectOption('yes');
  await page.evaluate(()=>testFailSave=true);await page.getByRole('button',{name:'임시저장',exact:true}).click();
  assert.equal(await title.inputValue(),'<img src=x onerror=alert(1)> 환경정비 활동');assert.equal(await live.locator('.phase-c-photo-grid img').count(),1);
  await page.evaluate(()=>{testFailSave=false;testFailSubmit=true});await page.getByRole('button',{name:'저장 후 승인 요청',exact:true}).click();await page.waitForTimeout(80);
  const saved=await page.evaluate(()=>testCalls.filter(c=>c.name==='save_promotion_draft').at(-1).args);assert.equal(saved.p_number_or_amount,'yes');assert.equal(saved.p_requested_publish_date,'2026-10-23');
  await page.evaluate(()=>testFailSubmit=false);await page.getByRole('button',{name:'저장 후 승인 요청',exact:true}).click();await page.waitForTimeout(80);
  assert.equal(await page.evaluate(()=>testCalls.filter(c=>c.name==='save_promotion_draft').at(-1).args.p_content_id),'11111111-1111-4111-8111-111111111111','submit retry reuses saved ID');
  // Reuse existing stored draft / returned-revision entry and RPC, not a new editor.
  for(const lifecycle of ['draft','needs_revision']){
   await page.evaluate(async lifecycle=>{testItems=[{content_id:'11111111-1111-4111-8111-111111111111',title:'기존 원고',public_body:'기존 본문',content_type:'homepage_article',lifecycle,public_media:[],requested_publish_date:'2026-10-23'}];await TaejangPromotionWorkspaceV2Api.openPromotion(lifecycle==='draft'?'write':'revision');},lifecycle);
   if(lifecycle==='draft'){await page.getByRole('button',{name:'미리보기',exact:true}).click();assert.equal(await live.locator('.promotion-preview-live').count(),1,'saved preview must not remove live preview');await page.getByRole('button',{name:'미리보기 닫기',exact:true}).click();}
   await page.getByRole('button',{name:lifecycle==='draft'?'열어 수정':'보완해서 새 수정본 만들기',exact:true}).click();await page.waitForTimeout(60);
   assert.match(await live.innerText(),/기존 본문/);assert.equal(await body.inputValue(),'기존 본문');
  }
  for(const role of ['promotion_lead','operations_manager']){
   await page.evaluate(async r=>{testRole=r;await TaejangPromotionWorkspaceV2Api.openPromotion('write');document.dispatchEvent(new CustomEvent('taejang-open-promotion-workspace',{detail:{mode:'write'}}));},role);await page.waitForTimeout(300);
   for(const kind of ['homepage_article','external_content','press_release']){await page.locator('.phase-c-composer-options select').first().selectOption(kind);assert.ok(await link.isVisible());}
   assert.ok(await page.getByRole('button',{name:role==='promotion_lead'?'저장 후 운영총괄 승인 요청':'운영팀장 검토 요청',exact:true}).isVisible());
   if(role==='operations_manager'){await page.locator('.phase-c-composer-options select').nth(2).selectOption('ceo');assert.ok(await page.getByRole('button',{name:'대표이사 승인 요청',exact:true}).isVisible());assert.equal(await page.getByRole('button',{name:'바로 공개',exact:true}).isVisible(),false);}
  }
  await page.evaluate(async()=>{testRole='promotion_staff';testItems=[];await TaejangPromotionWorkspaceV2Api.openPromotion('write')});await title.fill('환경정비활동 안내');await body.fill('함께 활동한 내용을 작성합니다.\n사진과 자료를 확인해주세요.');
  assert.ok(await page.evaluate(()=>document.body.scrollWidth<=innerWidth+2),'viewport fits');
  await page.screenshot({path:path.join(output,`promotion-${width}.png`),fullPage:true});assert.deepEqual(errors,[]);
  console.log(`PROMOTION_COMPOSER_PASS:${width}:${preview?'PREVIEW':'LOCAL'}`);await context.close();
 }
}finally{await browser.close();await rm(dir,{recursive:true,force:true});}
