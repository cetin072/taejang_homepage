import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=process.cwd(), output=process.env.EMPLOYEE_QA_OUTPUT || path.join(os.tmpdir(),'employee-role-review');
await fs.mkdir(output,{recursive:true});
let html=await fs.readFile('tests/browser/employee-profile-gate.html','utf8');
html=html.replaceAll('../../app/assets/','/app/assets/').replaceAll('../../staff/assets/','/staff/assets/');
html=html.replace('</body>',`<script>
window.allowRole=true;window.roleFail=false;window.saveCount=0;window.confirmed=false;
window.confirm=()=>confirmed;
fixtureContext.positions.push({id:'lead',name:'부서 팀장'},{id:'ops',name:'운영총괄'});
const oldRpc=TaejangApp.rpc;
TaejangApp.rpc=async(name,args)=>{
 if(name==='get_employee_role_context')return {ok:true,profile_id:'profile-0',profile_updated_at:'2026-11-17T00:00:00Z',employee_updated_at:'2026-11-17T00:00:00Z',role_codes:['general_worker','promotion_staff'],role_names:['일반 근로자','홍보 직원'],profile_position_id:'position',profile_department_id:'dept',can_manage:allowRole,recommendations:[{position_id:'position',role_code:'general_worker',role_name:'일반 근로자'},{position_id:'lead',role_code:'department_lead',role_name:'부서 팀장'}]};
 if(name==='update_employee_core_with_role'){saveCount++;window.lastRoleSave=args;await new Promise(r=>setTimeout(r,70));if(roleFail)throw Error('합성 저장 실패');return {ok:true};}
 return oldRpc(name,args);
};
</script></body>`);
const server=http.createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('content-type','text/html;charset=utf-8');res.end(html);return;}const file=path.resolve(root,'.'+req.url);if(!file.startsWith(root+path.sep))throw Error('path');res.setHeader('content-type',file.endsWith('.css')?'text/css':'application/javascript');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
 for(const width of [1440,390,320]){
  const page=await browser.newPage({viewport:{width,height:960}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const open=async()=>{await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(()=>TaejangEmployeeManagement.openEmployeeManagement());await page.locator('[data-employee-id="fixture-0"]').click();await page.getByText('실제 시스템 역할: 일반 근로자 · 홍보 직원',{exact:true}).waitFor();};
  await open();await page.getByRole('button',{name:'수정',exact:true}).click();
  const form=page.locator('[data-employee-edit-form]'), apply=page.getByLabel('추천 역할을 확인하고 소속·직책과 함께 적용',{exact:true});
  await apply.waitFor();assert.equal(await apply.isChecked(),false);
  await form.getByLabel('직책',{exact:true}).selectOption('lead');await apply.check();
  await form.getByRole('button',{name:'직원정보 저장',exact:true}).click();
  assert.equal(await page.evaluate(()=>saveCount),0,'declining review does not write');
  assert.equal(await form.getByLabel('직책',{exact:true}).isEnabled(),true,'cancel restores controls');
  await page.evaluate(()=>{confirmed=true;roleFail=true;});
  await form.getByLabel('이름',{exact:true}).fill('합성 편집 보존');
  await form.getByRole('button',{name:'직원정보 저장',exact:true}).click();
  await page.waitForFunction(()=>alerts.includes('합성 저장 실패'));
  assert.equal(await form.getByLabel('이름',{exact:true}).inputValue(),'합성 편집 보존');
  assert.equal(await apply.isChecked(),true,'failed save preserves explicit choice');
  assert.deepEqual(await page.evaluate(()=>lastRoleSave.p_expected_role_codes),['general_worker','promotion_staff'],'concurrent roles retained in expected snapshot');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'responsive');
  await page.screenshot({path:path.join(output,'role-review-'+width+'.png'),fullPage:true});
  await form.getByLabel('직책',{exact:true}).selectOption('ops');assert.equal(await apply.isVisible(),false,'delegation roles not recommended');
  await form.getByLabel('직책',{exact:true}).selectOption('lead');assert.equal(await apply.isChecked(),false,'changed selection invalidates approval');
  await page.evaluate(()=>{roleFail=false;});await apply.check();
  await form.getByRole('button',{name:'직원정보 저장',exact:true}).dblclick();
  await page.waitForFunction(()=>!document.querySelector('[data-employee-edit-form]'));
  assert.equal(await page.evaluate(()=>saveCount),2,'double click submits once');
  await open();await page.evaluate(()=>{allowRole=false;});await page.getByRole('button',{name:'수정',exact:true}).click();
  await page.getByText(/요청이 자동 전송되지는 않습니다/).waitFor();assert.equal(await apply.isVisible(),false,'ordinary editor cannot delegate roles');
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('employee-role-review: three widths, cancel/failure/repeated submit/role guard PASS');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
