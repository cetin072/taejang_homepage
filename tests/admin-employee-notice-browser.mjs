import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const root=process.cwd(),baseline=process.env.ADMIN_UI_BASELINE_REF;
const preview=(process.env.PREVIEW_URL||'').replace(/\/$/,'');
const output=process.env.ADMIN_UI_QA_OUTPUT||path.join(os.tmpdir(),'taejang-admin-489');
await fs.mkdir(output,{recursive:true});
const load=async file=>baseline&&/^(app|staff)\//.test(file)
 ?execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'})
 :fs.readFile(path.join(root,file),'utf8');
const server=http.createServer(async(req,res)=>{
 try{
  const file=decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/,''),absolute=path.resolve(root,file);
  assert.ok(absolute.startsWith(root+path.sep));
  let body=await load(file);
  if(file.endsWith('.html')&&preview)body=body.replaceAll('src="../../app/assets/','src="'+preview+'/app/assets/')
    .replaceAll('href="../../app/assets/','href="'+preview+'/app/assets/')
    .replaceAll('href="../../staff/assets/','href="'+preview+'/staff/assets/');
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'application/javascript');res.end(body);
 }catch(error){res.statusCode=404;res.end('Missing fixture asset');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
try{
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  await page.route('https://fixture.invalid/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="#e8eee9"/><path d="M18 120v-16q0-25 42-25t42 25v16" fill="#476f59"/><ellipse cx="60" cy="49" rx="25" ry="31" fill="#e2b99b"/><path d="M34 42q-2-32 26-30t27 30q-25-18-53 0" fill="#3a3430"/><circle cx="51" cy="48" r="2"/><circle cx="69" cy="48" r="2"/><path d="M51 63q9 7 18 0" fill="none" stroke="#704e41" stroke-width="2"/></svg>'}));
  page.on('pageerror',error=>errors.push(error.message));
  const base='http://127.0.0.1:'+server.address().port;
  const capture=async name=>{
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),name+' no horizontal overflow');
   await page.screenshot({path:path.join(output,(baseline?'before-':'after-')+name+'-'+width+'.png'),fullPage:true});
  };
  await page.goto(base+'/tests/browser/employee-profile-gate.html');
  await page.evaluate(()=>{
   const positions=[{id:'worker',code:'general_worker',name:'일반 근로자'},{id:'ops',code:'operations_manager',name:'운영총괄'},{id:'lead',code:'department_lead',name:'팀장'},{id:'position',code:'staff',name:'사원'}];
   fixtureContext.positions=positions;
   for(const [index,position] of [[0,positions[0]],[1,positions[2]],[2,positions[1]]])Object.assign(fixtureContext.employees[index],{position_id:position.id,position_name:position.name});
   fixtureContext.employees[3].position_id=null;
   TaejangEmployeeManagement.openEmployeeManagement();
  });
  await page.locator('.employee-list-row').first().waitFor();
  await capture('employee-list');
  if(!baseline){
   assert.equal(await page.getByLabel('정렬',{exact:true}).locator('option').count(),6);
   assert.equal(await page.locator('.employee-list-row').first().getAttribute('data-employee-id'),'fixture-2');
   assert.match(await page.locator('[data-employee-id="fixture-3"]').innerText(),/직책 미지정/);
   await page.getByLabel('정렬',{exact:true}).selectOption('employee_desc');
   assert.equal(await page.locator('.employee-list-row').first().getAttribute('data-employee-id'),'fixture-49');
   await page.getByLabel('직원 검색',{exact:true}).fill('TJ-000003');
  }
  await page.locator('[data-employee-id="fixture-2"]').click();
  await page.locator('.employee-profile-head .employee-avatar').waitFor();
  await capture('employee-profile');
  if(!baseline){
   assert.equal(Math.round((await page.locator('.employee-profile-head .employee-avatar').boundingBox()).width),width===390?100:120);
   assert.equal(await page.locator('.employee-photo-grid img[alt*="증명사진"]').count(),0,'missing ID photo never falls back to work photo');
   await page.getByRole('button',{name:'← 직원 목록',exact:true}).click();
   assert.equal(await page.getByLabel('정렬',{exact:true}).inputValue(),'employee_desc');
   assert.equal(await page.getByLabel('직원 검색',{exact:true}).inputValue(),'TJ-000003');
   await page.evaluate(()=>{fixtureRoute='promotion_lead';fixtureContext.access_level='promotion_lead_global';fixtureContext.can_manage_sensitive_identity=false;TaejangEmployeeManagement.openEmployeeManagement();});
   await page.locator('[data-employee-id="fixture-2"]').click();
   assert.equal(await page.locator('.employee-sensitive-section').count(),0);
   assert.match(await page.locator('.employee-section-photos').innerText(),/현재 권한으로 등록 상태·사진 조회 불가/);
   assert.equal(await page.locator('.employee-photo-grid img[alt*="증명사진"]').count(),0);
  }
  await page.goto(base+'/tests/browser/notice-authoring-ux-gate.html?capture');
  await page.waitForFunction(()=>document.getElementById('result').textContent==='NOTICE_CAPTURE_READY');
  await page.getByRole('button',{name:'비공개 저장',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('notice-admin-message').textContent.includes('초안 저장됨'));
  await capture('notice-saved');
  if(!baseline){
   const assertSaved=async()=>{
    await page.waitForFunction(()=>!document.getElementById('notice-manage-section').hidden&&document.querySelector('[data-saved-notice="1"]'));
    const id=await page.locator('#notice-id').inputValue();
    assert.equal(await page.locator('[data-saved-notice="1"]').getAttribute('data-notice-id'),id);
    await page.getByRole('button',{name:'저장한 공지 목록에서 확인',exact:true}).click();
    assert.ok(await page.locator('[data-saved-notice="1"]').evaluate(n=>n===document.activeElement));
    return id;
   };
   await assertSaved();
   await page.evaluate(()=>{role='promotion_lead';TaejangNoticeAdmin.setView('create');});
   await page.locator('#notice-title-input').fill('합성 팀장 공지');
   await page.locator('#notice-body').fill('합성 데이터만 사용합니다.');
   await page.locator('#notice-save-draft').click();
   await page.waitForFunction(()=>document.getElementById('notice-admin-message').textContent.includes('합성 팀장 공지'));
   const id=await assertSaved();
   const writes=await page.evaluate(()=>rows.length);
   await page.locator('[data-saved-notice="1"]').getByRole('button',{name:'공지 수정',exact:true}).click();
   await page.locator('#notice-body').fill('수정 확인');await page.locator('#notice-save-draft').click();
   await page.waitForFunction(()=>document.getElementById('notice-admin-message').textContent.includes('저장 완료'));
   assert.equal(await page.locator('#notice-id').inputValue(),id);assert.equal(await page.evaluate(()=>rows.length),writes,'update preserves saved id');
   await page.evaluate(()=>{role='promotion_staff';TaejangApp.can=()=>false;document.getElementById('notice-admin-panel').hidden=true;document.dispatchEvent(new CustomEvent('taejang-open-notice-admin',{detail:{view:'create'}}));});
   assert.equal(await page.locator('#notice-admin-panel').isVisible(),false,'staff denied notice management');
  }
  assert.deepEqual(errors,[]);await context.close();console.log('ADMIN_EMPLOYEE_NOTICE_BROWSER_PASS:'+width+':'+(baseline?'BASELINE':preview?'PREVIEW':'LOCAL'));
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
