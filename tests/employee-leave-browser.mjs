import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const code=fs.readFileSync(new URL('../app/assets/employee-leave.js',import.meta.url),'utf8');
for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://localhost/leave-qa',route=>route.fulfill({contentType:'text/html',body:'<main id="dashboard-main"></main>'}));
 await page.goto('http://localhost/leave-qa');
 await page.evaluate(()=>{
  const e={id:'employee',name:'검수 직원',employee_id:'TEST-001',balance:null,terms:[]};const ctx={server_today:'2026-11-01',can_initialize:true,can_review:true,employees:[e,{...e,id:'second',name:'둘째 직원',employee_id:'TEST-002'}],requests:[{id:'request',employee_uuid:'employee',employee_name:'검수 직원',work_date:'2026-11-10',portion:'full',units:1,status:'pending'},{id:'request2',employee_uuid:'second',employee_name:'둘째 직원',work_date:'2026-11-11',portion:'first_half',units:0.5,status:'pending'}],ledger:[],days_off:[],locations:[{id:'office',name:'본사'}]};
  window.calls=[];window.failNext=false;
  window.TaejangMenuAuthority={allowed:(_key,legacy)=>legacy};window.TaejangApp={can:()=>true,rpc:async(name,args)=>{
   window.calls.push({name,args});if(window.failNext){window.failNext=false;throw Error('NETWORK');}
   if(name==='get_employee_leave_admin_context'){const result=structuredClone(ctx);if(args.p_employee_uuid){result.employees=result.employees.filter(e=>e.id===args.p_employee_uuid);result.requests=result.requests.filter(r=>r.employee_uuid===args.p_employee_uuid);}return result;}
   if(name==='review_employee_leave'){const r=ctx.requests.find(r=>r.id===args.p_request_id);r.status=args.p_decision;r.decision_note=args.p_note;return {ok:true};}
   if(name==='initialize_employee_leave'){ctx.employees[0].balance={accrued:10,remaining:7,reserved:0,available:7};return {ok:true};}
   return {ok:true};
  }};
 });
 await page.addScriptTag({content:code});await page.evaluate(()=>window.TaejangEmployeeLeave.open());
 assert.equal(await page.getByRole('heading',{name:'연차 신청·승인',exact:true}).count(),1);
 assert.equal(await page.getByRole('heading',{name:'예외 휴무 등록',exact:true}).isVisible(),false);
 await page.getByLabel('신청 직원',{exact:true}).selectOption('employee');
 await page.getByRole('heading',{name:'검수 직원 · 2026-11-10',exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'둘째 직원 · 2026-11-11',exact:true}).count(),0);
 await page.getByLabel('처리 사유',{exact:true}).fill('승인 확인');await page.getByRole('button',{name:'처리 저장',exact:true}).click();
 await page.getByText('승인 대기 중인 연차 신청이 없습니다.',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('신청 직원',{exact:true}).inputValue(),'employee');
 await page.getByLabel('신청 상태',{exact:true}).selectOption('approved');await page.getByText('처리 사유: 승인 확인',{exact:true}).waitFor();
 await page.getByLabel('신청 직원',{exact:true}).selectOption('second');await page.getByLabel('신청 상태',{exact:true}).selectOption('pending');
 await page.getByRole('heading',{name:'둘째 직원 · 2026-11-11',exact:true}).waitFor();
 await page.getByLabel('처리 선택',{exact:true}).selectOption('rejected');await page.getByLabel('처리 사유',{exact:true}).fill('일정 재확인');await page.getByRole('button',{name:'처리 저장',exact:true}).click();
 await page.getByText('승인 대기 중인 연차 신청이 없습니다.',{exact:true}).waitFor();
 await page.getByLabel('신청 상태',{exact:true}).selectOption('rejected');await page.getByText('처리 사유: 일정 재확인',{exact:true}).waitFor();
 await page.getByRole('button',{name:'직원별 연차 등록·현황',exact:true}).click();
 await page.getByLabel('직원 선택').selectOption('employee');
 await page.getByLabel('지금까지 발생한 연차').fill('10');await page.getByLabel('현재 남은 연차').fill('7');await page.getByLabel('기준일·입력 근거').fill('기존 수기대장 확인');
 await page.getByLabel('매월 1일 1개 발생 대상 확인').check();
 await page.evaluate(()=>{window.failNext=true;});await page.getByRole('button',{name:'최초 연차 등록',exact:true}).click();
 await page.getByText('저장하지 못했습니다.',{exact:false}).waitFor();assert.equal(await page.getByLabel('현재 남은 연차').inputValue(),'7');
 await page.getByRole('button',{name:'최초 연차 등록',exact:true}).click();await page.getByText('발생 10개 · 남은 7개',{exact:false}).waitFor();
 const saved=await page.evaluate(()=>window.calls.find(c=>c.name==='initialize_employee_leave'));assert.equal(saved.args.p_accrued,10);assert.equal(saved.args.p_remaining,7);assert.equal(saved.args.p_monthly_enabled,true);
 assert.equal(await page.getByText('근무조건 추가',{exact:true}).count(),0);
 await page.getByLabel('직원 선택').selectOption('second');await page.getByRole('heading',{name:'둘째 직원 · 연차 등록·현황',exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'검수 직원 · 연차 등록·현황',exact:true}).count(),0);
 await page.evaluate(()=>{const h=document.createElement('div');document.body.append(h);h.append(window.TaejangEmployeeLeave.employeePanel({id:'employee'}));});
 await page.getByRole('button',{name:'근무조건·연차 확인',exact:true}).click();
 await page.getByText('근무조건·시간 확인 및 변경',{exact:true}).click();await page.getByText('근무조건 추가',{exact:true}).click();await page.getByLabel('출근 시각',{exact:true}).fill('09:00');await page.getByLabel('퇴근 시각',{exact:true}).fill('12:00');await page.getByLabel('변경 사유',{exact:true}).fill('실제 근로계약 확인');await page.locator('fieldset input').first().check();
 await page.getByRole('button',{name:'근무조건 저장',exact:true}).click();
 assert.ok((await page.evaluate(()=>window.calls)).some(c=>c.name==='save_employee_work_terms'&&c.args.p_values.starts_at==='09:00'));
 assert.deepEqual(errors,[]);await page.close();console.log(`LEAVE_WEB_BROWSER_PASS ${width}px scoped requests, approval/rejection, registration, input preservation, employee switching, secondary days off, schedule wiring`);
}
await browser.close();
