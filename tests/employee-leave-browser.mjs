import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const code=fs.readFileSync(new URL('../app/assets/employee-leave.js',import.meta.url),'utf8');
for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<main id="dashboard-main"></main>');
 await page.evaluate(()=>{
  const e={id:'employee',name:'검수 직원',employee_id:'TEST-001',balance:null,terms:[]};const ctx={server_today:'2026-11-01',can_initialize:true,can_review:true,employees:[e],requests:[],ledger:[],days_off:[],locations:[{id:'office',name:'본사'}]};
  window.calls=[];window.failNext=false;
  window.TaejangMenuAuthority={allowed:()=>true};window.TaejangApp={rpc:async(name,args)=>{
   window.calls.push({name,args});if(window.failNext){window.failNext=false;throw Error('NETWORK');}
   if(name==='get_employee_leave_admin_context')return structuredClone(ctx);
   if(name==='initialize_employee_leave'){ctx.employees[0].balance={accrued:10,remaining:7,reserved:0,available:7};return {ok:true};}
   return {ok:true};
  }};
 });
 await page.addScriptTag({content:code});await page.evaluate(()=>window.TaejangEmployeeLeave.open());
 await page.getByLabel('직원 선택').selectOption('employee');
 await page.getByLabel('지금까지 발생한 연차').fill('10');await page.getByLabel('현재 남은 연차').fill('7');await page.getByLabel('기준일·입력 근거').fill('기존 수기대장 확인');
 await page.getByLabel('매월 1일 1개 발생 대상 확인').check();
 await page.evaluate(()=>{window.failNext=true;});await page.getByRole('button',{name:'최초 연차 등록',exact:true}).click();
 await page.getByText('저장하지 못했습니다.',{exact:false}).waitFor();assert.equal(await page.getByLabel('현재 남은 연차').inputValue(),'7');
 await page.getByRole('button',{name:'최초 연차 등록',exact:true}).click();await page.getByText('발생 10개 · 남은 7개',{exact:false}).waitFor();
 const saved=await page.evaluate(()=>window.calls.find(c=>c.name==='initialize_employee_leave'));assert.equal(saved.args.p_accrued,10);assert.equal(saved.args.p_remaining,7);assert.equal(saved.args.p_monthly_enabled,true);
 await page.getByText('근무조건 추가',{exact:true}).click();await page.getByLabel('출근 시각',{exact:true}).fill('09:00');await page.getByLabel('퇴근 시각',{exact:true}).fill('12:00');await page.getByLabel('변경 사유',{exact:true}).fill('실제 근로계약 확인');await page.locator('fieldset input').first().check();
 await page.getByRole('button',{name:'근무조건 저장',exact:true}).click();
 assert.ok((await page.evaluate(()=>window.calls)).some(c=>c.name==='save_employee_work_terms'&&c.args.p_values.starts_at==='09:00'));
 assert.deepEqual(errors,[]);await page.close();console.log(`LEAVE_WEB_BROWSER_PASS ${width}px save, retry-input preservation, initialization, schedule wiring`);
}
await browser.close();
