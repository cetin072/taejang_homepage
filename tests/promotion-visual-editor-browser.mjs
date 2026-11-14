import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright';
const root=process.cwd(), dir=await mkdtemp(path.join(os.tmpdir(),'visual-editor-'));
const output=process.env.PROMOTION_QA_OUTPUT || path.join(os.tmpdir(),'visual-editor-qa');await mkdir(output,{recursive:true});
const base=pathToFileURL(root+'/').href;
const photo='https://fixture.supabase.co/storage/v1/object/public/promotion-media/one.jpg';
const photo2='https://fixture.supabase.co/storage/v1/object/public/promotion-media/two.jpg';
const html=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="${base}"><link rel="stylesheet" href="staff/assets/staff.css"><link rel="stylesheet" href="app/assets/dashboard-shell.css"><link rel="stylesheet" href="assets/css/promotion-document.css"></head><body><h1 id="desktop-page-title"></h1><main id="dashboard-main"></main><script>
window.testRole='operations_manager';window.testItems=[];window.calls=[];window.failSave=false;window.alerts=[];window.alert=m=>alerts.push(m);window.confirm=()=>true;
window.TaejangApp={getRoute:()=>testRole,hasCapabilityContract:()=>false,friendlyError:e=>e.message,rpc:async(name,args)=>{calls.push({name,args});if(name==='get_my_promotion_workspace')return {role:testRole,my_items:testItems,review_items:[],publication_items:[]};if(name.startsWith('save_')){if(failSave)throw Error('저장 실패 테스트');window.saved=args;return {content_id:'11111111-1111-4111-8111-111111111111',revision_id:'22222222-2222-4222-8222-222222222222'};}return [];}};
</script><script src="assets/js/public-promotion-media.js"></script><script src="assets/js/promotion-document.js"></script><script src="assets/js/featured-article-layout.js"></script><script src="app/assets/promotion-visual-editor.js"></script><script src="app/assets/phase-c-workspace-v2.js"></script></body></html>`;
await writeFile(path.join(dir,'index.html'),html);
const browser=await chromium.launch({headless:true,args:['--allow-file-access-from-files'],...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
try {
for(const width of [320,390,768,1440]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420"><rect width="800" height="420" fill="#8ba08b"/></svg>'}));
 await page.goto(pathToFileURL(path.join(dir,'index.html')).href);
 for(const role of ['operations_manager','promotion_lead','promotion_staff']){
  await page.evaluate(async({role,photo,photo2})=>{testRole=role;testItems=[{content_id:'11111111-1111-4111-8111-111111111111',title:'함께 만드는 태장의 일터',public_body:'원래 본문',content_type:'homepage_article',lifecycle:'draft',public_media:[{url:photo,alt:'함께하는 작업'},{url:photo2,alt:'완성한 작품'}],hero_image_url:photo2}];await TaejangPromotionWorkspaceV2Api.openPromotion('write');},{role,photo,photo2});
  await page.getByRole('button',{name:'열어 수정',exact:true}).click();
  const field=page.getByRole('textbox',{name:'기사 본문',exact:true});await field.waitFor();
  assert.equal(await page.locator('textarea.app-form-body').inputValue(),'원래 본문','opening legacy preserves original');
  assert.equal(await page.getByRole('combobox',{name:'목록 대표사진',exact:true}).inputValue(),photo2,'existing cover survives');
  await field.fill('직원이 직접 쓴 제목');await page.getByRole('combobox',{name:'문단 스타일'}).selectOption('2');
  await field.press('End');await field.press('Enter');await page.getByRole('combobox',{name:'문단 스타일'}).selectOption('p');await field.pressSequentially('첫 문단입니다.');
  await field.press('Enter');await page.getByRole('combobox',{name:'본문에 넣을 사진'}).selectOption(photo);
  await page.getByRole('button',{name:'본문에 사진 넣기',exact:true}).click();
  await field.locator('img').click();await page.getByRole('textbox',{name:'선택한 사진 설명'}).fill('문단 사이 사진 설명');
  await page.getByRole('button',{name:'문단·사진 위로',exact:true}).click();await page.getByRole('button',{name:'실행 취소',exact:true}).click();
  // New trailing paragraph using the real editor command exercises schema/serialization.
  await page.evaluate(()=>{const api=document.querySelector('textarea.app-form-body')._articleEditor;api.editor.commands.insertContentAt(api.editor.state.doc.content.size,{type:'paragraph',content:[{type:'text',text:'마지막 문단'}]});});
  await page.getByRole('button',{name:'모바일 미리보기',exact:true}).click();
  assert.match(await page.locator('.article-editor-preview').innerText(),/문단 사이 사진 설명/);
  assert.equal(await page.locator('.article-editor-preview img').count(),1,'unplaced attachments do not reappear');
  const before=await page.locator('textarea.app-form-body').inputValue();
  await page.evaluate(()=>failSave=true);await page.getByRole('button',{name:'수정본 저장',exact:true}).click();
  assert.equal(await page.locator('textarea.app-form-body').inputValue(),before,'failed save preserves full document');
  await page.evaluate(()=>failSave=false);await page.getByRole('button',{name:'수정본 저장',exact:true}).click();
  const saved=await page.evaluate(()=>window.saved);assert.equal(saved.p_public_body,before);assert.equal(saved.p_hero_image_url,photo2);assert.doesNotMatch(saved.p_summary,/TAEJANG_ARTICLE|"type"/);
  await page.evaluate(async({saved,role})=>{testItems=[{content_id:saved.p_content_id,title:saved.p_title,public_body:saved.p_public_body,public_media:saved.p_public_media,hero_image_url:saved.p_hero_image_url,content_type:'homepage_article',lifecycle:'draft'}];await TaejangPromotionWorkspaceV2Api.openPromotion('write');},{saved,role});
  await page.getByRole('button',{name:'열어 수정',exact:true}).click();
  assert.equal(await page.locator('textarea.app-form-body').inputValue(),before,'reopen is lossless');
  assert.equal(await field.locator('h2').innerText(),'직원이 직접 쓴 제목');assert.equal(await field.locator('img').getAttribute('alt'),'문단 사이 사진 설명');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page overflow');
  if(role==='operations_manager')await page.screenshot({path:path.join(output,`visual-editor-${width}.png`),fullPage:true});
 }
 assert.deepEqual(errors,[]);await page.close();
}
console.log('Visual editor: 3 roles × 4 viewports; format/photos/caption/cover/move/undo/save failure/reopen PASS');
} finally {await browser.close();}
