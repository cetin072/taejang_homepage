import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=process.env.FIELD_AUDIT_QA_OUTPUT||path.join(os.tmpdir(),'taejang-issue456');
await mkdir(output,{recursive:true});
const browser=await playwright.chromium.launch({
 headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})
});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8GAAAAABJRU5ErkJggg==','base64');
const errors=[];
try {
for(const [kind,width,height] of [['pc',1440,1000],['mobile',390,844]]) {
 const context=await browser.newContext({viewport:{width,height}});
 const page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 await page.setContent(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <style>body{box-sizing:border-box;margin:0;background:#f5f8f6;color:#173e2e;font:16px/1.5 Arial,sans-serif}
 .dashboard-main{padding:14px;margin:0 auto;max-width:1180px;min-width:0;}.button{padding:10px;border-radius:9px;border:1px solid #6d997d;min-height:44px;background:#eff6f0;cursor:pointer}</style>
 </head><body><div id="desktop-app-shell"><main id="dashboard-main" class="dashboard-main"></main></div></body></html>`);
 await page.addStyleTag({path:'app/assets/admin-authoring.css'});
 await page.evaluate(()=>{
 const staff=Array.from({length:50},(_,i)=>({
 id:'fixture-456-'+i,employee_id:'TJ-000'+String(i+1).padStart(3,'0'),
 full_name:'가상직원 '+i,department_name:i%3===0?'물류':'생산',department_id:'depa',
 position_name:'일반 근로자',position_id:'worker',
 hired_on:'2026-09-01',employment_status:'active',attendance_required:true,
 account_connected:i<45,account_status:i<45?'active':'unlinked',
 last_attendance_on:i%2===0?'2026-10-13':null,has_app_use:i%2===0,
 identity_verified:false,app_install_status:'unchecked',
 profile_photo_path:null,audit_note:'',can_edit_basic:true,
 updated_at:'2026-10-13T00:00:00Z'
 }));
 window.syntheticStaff=staff;
 window.mockCalls=[];
 window.failAuditOnce=false;
 window.failBasicOnce=true;
 window.failPhotoOnce=true;
 window.TaejangEmployeeManagement={
 openEmployeeManagement(){document.getElementById('dashboard-main').textContent='원래 직원 관리';},
 async uploadEmployeePhoto(employee,type,file){
  window.mockCalls.push('photo-upload');
  if(window.failPhotoOnce){window.failPhotoOnce=false;throw Error('스토리지 연결 실패');}
  return employee.id+'/'+type+'/fixture.png';
 }
 };
 window.TaejangApp={
  getRoute:()=> 'promotion_lead',hasCapabilityContract:()=>true,
  can:c=>c==='employee.field_audit_manage',
  friendlyError:e=>e.message,
  async rpc(name,args){
    window.mockCalls.push(name);
    if(name==='get_employee_field_audit') return {
      employees:window.syntheticStaff.map(e=>({...e})),
      departments:[{id:'depa',name:'생산'},{id:'depb',name:'물류'}],
      positions:[{id:'worker',name:'일반 근로자'},{id:'staff',name:'사무'}]
    };
    if(name==='update_employee_field_audit'){
      if(window.failAuditOnce){window.failAuditOnce=false;throw Error('네트워크 오류');}
      const staff=window.syntheticStaff.find(e=>e.id===args.p_employee_uuid);
      Object.assign(staff,{identity_verified:args.p_identity_verified,
        app_install_status:args.p_app_install_status,audit_note:args.p_note});
      return {ok:true};
    }
    if(name==='update_employee_field_audit_basic'){
      if(window.failBasicOnce){window.failBasicOnce=false;throw Error('일시 오류');}
      Object.assign(window.syntheticStaff.find(e=>e.id===args.p_employee_uuid),{
       full_name:args.p_full_name,hired_on:args.p_hired_on,department_id:args.p_department_id,
       position_id:args.p_position_id,attendance_required:args.p_attendance_required
      });return {ok:true};
    }
    if(name==='set_employee_photo'){
      window.syntheticStaff.find(e=>e.id===args.p_employee_uuid).profile_photo_path=args.p_storage_path;
      return {ok:true};
    }
    throw Error('unexpected RPC '+name);
  }
 };
 });
 await page.addScriptTag({path:'app/assets/employee-field-audit.js'});
 await page.evaluate(()=>window.TaejangEmployeeFieldAudit.open());
 await page.locator('.employee-field-audit-row').first().waitFor();
 assert.equal(await page.locator('.employee-field-audit-row').count(),50,'50 synthetic employees in open task list');
 await page.screenshot({path:path.join(output,'field-audit-'+kind+'-list.png'),fullPage:true});
 await page.locator('[data-audit-employee-id="fixture-456-0"]').click();
 await page.locator('[data-audit-detail="fixture-456-0"]').waitFor();
 const inputs=page.locator('.employee-field-audit-detail input');
 await page.locator('.employee-field-audit-form').first().locator('input[type="checkbox"]').check();
 await page.locator('.employee-field-audit-form').first().locator('select').selectOption('not_installed');
 await page.getByRole('button',{name:'현장 확인 저장'}).click();
 await page.getByText('미설치 · 방문 필요',{exact:false}).first().waitFor();
 assert.equal(await page.evaluate(()=>window.syntheticStaff[0].app_install_status),'not_installed');
 // Failed core edit never discards typed data.
 await page.locator('.employee-field-audit-form').last().locator('input[type="date"]').fill('2026-09-02');
 await page.getByRole('button',{name:'기본정보 수정 저장'}).click();
 await page.getByText('일시 오류',{exact:false}).waitFor();
 assert.equal(await page.locator('.employee-field-audit-form').last().locator('input[type="date"]').inputValue(),'2026-09-02');
 await page.getByRole('button',{name:'기본정보 수정 저장'}).click();
 await page.getByText('가상직원 0 · TJ-000001',{exact:false}).waitFor();
 assert.equal(await page.evaluate(()=>window.syntheticStaff[0].hired_on),'2026-09-02');
 // Failure and retry of private portrait upload.
 await page.locator('input.employee-field-audit-file').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:png});
 await page.getByText('스토리지 연결 실패',{exact:false}).waitFor();
 await page.locator('input.employee-field-audit-file').setInputFiles({name:'another.png',mimeType:'image/png',buffer:png});
 await page.getByText('얼굴사진 있음',{exact:false}).first().waitFor();
 await page.screenshot({path:path.join(output,'field-audit-'+kind+'-detail.png'),fullPage:true});
 const overflow=await page.evaluate(()=>({
  viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
  layout:document.body.scrollWidth
 }));
 assert.ok(overflow.scrollWidth<=overflow.viewport+2,JSON.stringify(overflow));
 await page.getByRole('button',{name:'← 전수조사 목록'}).click();
 await page.getByLabel('현장조사 상태').selectOption('needs_install');
 assert.equal(await page.locator('.employee-field-audit-row').count(),1,'filter isolates one not-installed employee');
 assert.equal(await page.evaluate(()=>window.mockCalls.some(x=>x==='set_employee_photo')),true);
 await context.close();
}
assert.deepEqual(errors,[],'no console page errors');
console.log('ISSUE_456_FIELD_AUDIT_BROWSER_PASS (1440px/390px)');
}finally{await browser.close()}
