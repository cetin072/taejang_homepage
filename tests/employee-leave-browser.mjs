import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const code=fs.readFileSync(new URL('../app/assets/employee-leave.js',import.meta.url),'utf8');
for(const width of [320,390,786,1440]){
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('http://localhost/leave-qa',route=>route.fulfill({contentType:'text/html',body:'<div id="desktop-app-shell"><main id="dashboard-main" class="dashboard-main"></main></div>'}));
 await page.goto('http://localhost/leave-qa');
 await page.evaluate(()=>{
  const e={id:'employee',name:'검수 직원',employee_id:'TEST-001',full_name:'검수 직원',employment_status:'active',hired_on:'2020-01-01',departed_on:null,position_id:'ops',position_name:'운영총괄',balance:null,terms:[]};const ctx={roster_version:1,positions:[{id:'ops',name:'운영총괄',code:'operations_manager',sort_order:1},{id:'worker',name:'일반직원',code:'general_worker',sort_order:99}],server_today:'2026-11-01',can_initialize:true,can_adjust:true,can_manage_work_terms:true,can_review:true,employees:[e,{...e,id:'second',name:'둘째 직원',full_name:'둘째 직원',employee_id:'TEST-002',position_id:'worker',position_name:'일반직원'},{...e,id:'retired',name:'퇴직 검수',employee_id:'TEST-003',employment_status:'departed',departed_on:'2026-10-30'}],requests:[{id:'retired-request',employee_uuid:'retired',employee_name:'퇴직 검수',work_date:'2026-10-20',portion:'full',units:1,status:'pending'},{id:'request',employee_uuid:'employee',employee_name:'검수 직원',work_date:'2026-11-10',portion:'full',units:1,status:'pending'},{id:'request2',employee_uuid:'second',employee_name:'둘째 직원',work_date:'2026-11-11',portion:'first_half',units:0.5,status:'pending'}],change_requests:[{id:'change',employee_uuid:'employee',request_id:'approved-original',employee_name:'검수 직원',original_work_date:'2026-11-15',original_portion:'full',action:'amend',new_work_date:'2026-11-16',new_portion:'first_half',reason:'',status:'pending'}],ledger:[],days_off:[],locations:[{id:'office',name:'본사'}]};
  window.fixtureLeaveContext=ctx;window.calls=[];window.failNext=false;window.conflictNext=false;window.rosterMissing=false;
  window.TaejangMenuAuthority={allowed:(_key,legacy)=>legacy};window.TaejangApp={can:()=>true,rpc:async(name,args)=>{
   window.calls.push({name,args});if(window.failNext){window.failNext=false;throw Error('NETWORK');}
   if(name==='get_employee_leave_admin_context'){const result=structuredClone(ctx);if(window.rosterMissing)delete result.roster_version;if(args.p_employee_uuid){result.employees=result.employees.filter(e=>e.id===args.p_employee_uuid);result.requests=result.requests.filter(r=>r.employee_uuid===args.p_employee_uuid);result.change_requests=result.change_requests.filter(c=>c.employee_uuid===args.p_employee_uuid);}return result;}
   if(name==='review_employee_leave_change'){const c=ctx.change_requests.find(c=>c.id===args.p_change_id);c.status=args.p_decision;c.decision_note=args.p_note;return {ok:true};}
   if(name==='admin_register_urgent_employee_leave'){
    const e=ctx.employees.find(employee=>employee.id===args.p_employee_uuid);
    ctx.requests.unshift({id:args.p_id,employee_uuid:e.id,employee_name:e.name,work_date:args.p_work_date,portion:'full',units:1,status:'approved',admin_registration_note:args.p_note});
    return {ok:true,status:'approved'};
   }
   if(name==='admin_change_employee_leave'){const r=ctx.requests.find(r=>r.id===args.p_request_id);r.work_date=args.p_new_work_date||r.work_date;r.status=args.p_action==='cancel'?'cancelled':'approved';return {ok:true};}
   if(name==='review_employee_leave'){const r=ctx.requests.find(r=>r.id===args.p_request_id);r.status=args.p_decision;r.decision_note=args.p_note;return {ok:true};}
   if(name==='save_employee_work_terms'){if(window.conflictNext){window.conflictNext=false;throw Error('ATTENDANCE_CONFLICT');}ctx.employees.find(e=>e.id===args.p_employee_uuid).terms.unshift({id:'saved-term',...args.p_values});return {ok:true};}
   if(name==='initialize_employee_leave'){ctx.employees.find(e=>e.id===args.p_employee_uuid).balance={accrued:args.p_accrued,remaining:args.p_remaining,reserved:0,available:args.p_remaining};return {ok:true};}
   return {ok:true};
  }};
 });
 await page.addStyleTag({content:fs.readFileSync(new URL('../staff/assets/staff.css',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('../app/assets/admin-authoring.css',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('../app/assets/dashboard-shell.css',import.meta.url),'utf8').replace(/^@import[^;]+;/,'')+'\n'+fs.readFileSync(new URL('../app/assets/employee-management.css',import.meta.url),'utf8')});await page.addScriptTag({content:fs.readFileSync(new URL('../app/assets/employee-management-views.js',import.meta.url),'utf8')});await page.addScriptTag({content:code});await page.evaluate(()=>window.TaejangEmployeeLeave.open());
 assert.equal(await page.getByRole('heading',{name:'연차 신청·승인',exact:true}).count(),1);
 assert.equal(await page.getByText('직원 요청 사유:',{exact:false}).count(),0,'empty employee reason is not rendered as a blank field');
 assert.equal(await page.getByRole('heading',{name:'예외 휴무 등록',exact:true}).isVisible(),false);
 assert.equal(await page.getByLabel('신청 직원',{exact:true}).locator('option[value=retired]').count(),0,'retired employees excluded by default');
 assert.deepEqual(await page.getByLabel('신청 직원',{exact:true}).locator('optgroup').evaluateAll(gs=>gs.map(g=>g.label)),['운영총괄','일반직원']);
 assert.equal(await page.getByRole('heading',{name:'퇴직 검수 · 2026-10-20',exact:true}).count(),0);
 await page.getByLabel('퇴직자 과거 신청 보기',{exact:true}).check();await page.getByRole('heading',{name:'퇴직 검수 · 2026-10-20',exact:true}).waitFor();
 assert.equal(await page.getByLabel('신청 직원',{exact:true}).locator('option[value=employee]').count(),0);
 await page.getByLabel('퇴직자 과거 신청 보기',{exact:true}).uncheck();
 await page.getByLabel('신청 직원',{exact:true}).selectOption('employee');
 await page.getByRole('heading',{name:'검수 직원 · 2026-11-10',exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'둘째 직원 · 2026-11-11',exact:true}).count(),0);
 await page.getByLabel('처리 사유',{exact:true}).fill('승인 확인');await page.getByRole('button',{name:'처리 저장',exact:true}).click();
 await page.getByText('승인 대기 중인 연차 신청이 없습니다.',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('신청 직원',{exact:true}).inputValue(),'employee');
 await page.getByLabel('신청 상태',{exact:true}).selectOption('approved');await page.getByText('처리 사유: 승인 확인',{exact:true}).waitFor();
 await page.getByLabel('변경 처리 사유',{exact:true}).fill('변경 승인 확인');
 await page.getByRole('button',{name:'취소·수정 처리',exact:true}).click();
 await page.getByText('처리할 취소·수정 요청이 없습니다.',{exact:true}).waitFor();
 assert.equal(await page.getByText('처리 사유: 변경 승인 확인',{exact:true}).count(),0);
 await page.getByRole('button',{name:'취소·수정 이력',exact:true}).click();
 const historyRow=page.locator('details > summary').filter({hasText:'검수 직원 · 수정 요청'});
 await historyRow.waitFor();
 assert.equal(await page.getByLabel('신청 직원',{exact:true}).inputValue(),'employee');
 assert.equal(await page.getByRole('button',{name:'취소·수정 처리',exact:true}).count(),0);
 assert.equal(await page.getByText('처리 사유: 변경 승인 확인',{exact:true}).isVisible(),false);
 await historyRow.click();
 await page.getByText('처리 사유: 변경 승인 확인',{exact:true}).waitFor();
 await page.getByRole('button',{name:'신청·승인',exact:true}).click();
 await page.getByText('관리자 직접 변경',{exact:true}).waitFor();
 await page.getByText('관리자 직접 변경',{exact:true}).click();await page.getByRole('button',{name:'새 연차 날짜',exact:true}).click();await page.getByRole('button',{name:'2026-11-20 선택',exact:true}).click();await page.getByLabel('관리자 변경 사유',{exact:true}).fill('확인한 일정 변경');
 await page.getByRole('button',{name:'관리자 변경 적용',exact:true}).click();await page.getByRole('heading',{name:'검수 직원 · 2026-11-20',exact:true}).waitFor();
 const direct=await page.evaluate(()=>window.calls.find(c=>c.name==='admin_change_employee_leave'));assert.equal(direct.args.p_new_work_date,'2026-11-20');assert.equal(direct.args.p_note,'확인한 일정 변경');
 await page.getByLabel('신청 직원',{exact:true}).selectOption('second');await page.getByLabel('신청 상태',{exact:true}).selectOption('pending');
 await page.getByRole('heading',{name:'둘째 직원 · 2026-11-11',exact:true}).waitFor();
 await page.getByLabel('처리 선택',{exact:true}).selectOption('rejected');await page.getByLabel('처리 사유',{exact:true}).fill('일정 재확인');await page.getByRole('button',{name:'처리 저장',exact:true}).click();
 await page.getByText('승인 대기 중인 연차 신청이 없습니다.',{exact:true}).waitFor();
 await page.getByLabel('신청 상태',{exact:true}).selectOption('rejected');await page.getByText('처리 사유: 일정 재확인',{exact:true}).waitFor();
 await page.getByRole('button',{name:'직원별 연차 등록·현황',exact:true}).click();
 assert.equal(await page.getByLabel('직원 선택').locator('option[value=retired]').count(),0,'retired not available for balance registration');
 await page.getByLabel('직원 선택').selectOption('employee');
 const accruedBox=await page.getByLabel('지금까지 발생한 연차',{exact:true}).boundingBox(),remainingBox=await page.getByLabel('현재 남은 연차',{exact:true}).boundingBox();
 if(width>760){assert.ok(Math.abs(accruedBox.y-remainingBox.y)<2,'desktop balances share one row');assert.ok(remainingBox.x>=accruedBox.x+accruedBox.width,'desktop balance fields never overlap');}
 else assert.ok(remainingBox.y>=accruedBox.y+accruedBox.height,'mobile balances stack using shared responsive grid');
 assert.equal(await page.getByLabel('기타 입력 근거',{exact:true}).isVisible(),false,'no free typing for a predefined reason');
 fs.mkdirSync('leave-admin-qa-artifacts',{recursive:true});await page.getByRole('button',{name:'최초 연차 등록',exact:true}).locator('..').screenshot({path:`leave-admin-qa-artifacts/initial-leave-${width}.png`});
 await page.getByLabel('지금까지 발생한 연차').fill('10');await page.getByLabel('현재 남은 연차').fill('7');await page.getByLabel('입력 근거',{exact:true}).selectOption('other');await page.getByLabel('기타 입력 근거',{exact:true}).fill('기존 수기대장 확인');
 await page.getByLabel('매월 1일 1개 발생 대상 확인').check();
 await page.evaluate(()=>{window.failNext=true;});await page.getByRole('button',{name:'최초 연차 등록',exact:true}).click();
 await page.getByText('저장하지 못했습니다.',{exact:false}).waitFor();assert.equal(await page.getByLabel('현재 남은 연차').inputValue(),'7');assert.equal(await page.getByLabel('입력 근거',{exact:true}).inputValue(),'other');assert.equal(await page.getByLabel('기타 입력 근거',{exact:true}).inputValue(),'기존 수기대장 확인');
 await page.getByRole('button',{name:'최초 연차 등록',exact:true}).click();await page.getByText('발생 10개 · 남은 7개',{exact:false}).waitFor();
 const saved=await page.evaluate(()=>window.calls.find(c=>c.name==='initialize_employee_leave'));assert.equal(saved.args.p_accrued,10);assert.equal(saved.args.p_remaining,7);assert.equal(saved.args.p_monthly_enabled,true);assert.equal(saved.args.p_reason,'기존 수기대장 확인');
 // These small forms share a row on desktop, without changing their free-text contracts.
 await page.getByText('잔여 연차 조정',{exact:true}).click();
 const adjustment=page.locator('.leave-adjustment-form');
 await adjustment.getByLabel('조정 개수 (+ 또는 -)',{exact:true}).fill('-0.5');
 await adjustment.getByLabel('조정 사유',{exact:true}).fill('가상 검수 조정');
 const checkCompact=async form=>{
  const controls=form.locator(':scope > label > input, :scope > label > select, :scope > .leave-date-field > .leave-date-button, :scope > button[type=submit]');
  const boxes=await controls.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,height:r.height,radius:getComputedStyle(n).borderRadius};}));
  for(const b of boxes){assert.equal(b.radius,'0px','requested controls have square corners');assert.ok(b.height>=44,'touch targets retained');assert.ok(b.x>=0&&b.right<=width+1,'control fits viewport');}
  if(width===1440)assert.ok(boxes.every(b=>Math.abs(b.bottom-boxes[0].bottom)<2),'desktop controls and save share a row');
  if(width<=760)for(let i=1;i<boxes.length;i++)assert.ok(boxes[i].y>=boxes[i-1].bottom,'mobile controls stack');
 };
 await checkCompact(adjustment);
 await adjustment.screenshot({path:`leave-admin-qa-artifacts/adjustment-${width}.png`});
 await page.evaluate(()=>{window.failNext=true;});await adjustment.getByRole('button',{name:'조정 저장',exact:true}).click();
 await adjustment.getByText('저장하지 못했습니다.',{exact:false}).waitFor();
 assert.equal(await adjustment.getByLabel('조정 사유',{exact:true}).inputValue(),'가상 검수 조정','save failure preserves typed reason');
 await adjustment.getByRole('button',{name:'조정 저장',exact:true}).click();
 await page.getByText('잔여 연차 조정',{exact:true}).waitFor();
 const adjustmentCall=await page.evaluate(()=>window.calls.filter(c=>c.name==='adjust_employee_leave').at(-1));
 assert.equal(adjustmentCall.args.p_delta,-0.5);assert.equal(adjustmentCall.args.p_reason,'가상 검수 조정');
 await page.locator('.leave-exceptions > summary').click();
 const holiday=page.locator('.leave-day-off-form');await checkCompact(holiday);
 await holiday.getByRole('button',{name:'휴무일',exact:true}).click();
 await holiday.getByRole('button',{name:'2026-11-20 선택',exact:true}).click();
 await holiday.getByLabel('휴무 사유',{exact:true}).fill('가상 검수 휴무');
 await holiday.screenshot({path:`leave-admin-qa-artifacts/exception-${width}.png`});
 await holiday.getByRole('button',{name:'예외 휴무 저장',exact:true}).click();
 await page.waitForFunction(()=>window.calls.some(c=>c.name==='save_employee_day_off'));
 const holidayCall=await page.evaluate(()=>window.calls.find(c=>c.name==='save_employee_day_off'));
 assert.deepEqual(holidayCall.args,{p_employee_uuid:null,p_work_date:'2026-11-20',p_reason:'가상 검수 휴무'});
 assert.equal(await page.getByText('근무조건 추가',{exact:true}).count(),0);
 await page.getByLabel('직원 선택').selectOption('second');await page.getByRole('heading',{name:'둘째 직원 · 연차 등록·현황',exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'검수 직원 · 연차 등록·현황',exact:true}).count(),0);
 await page.evaluate(()=>{const h=document.createElement('div');document.querySelector('#dashboard-main').append(h);h.id='work-qa';h.dataset.employeeProfile='employee';h.append(window.TaejangEmployeeLeave.workSummary({id:'employee'}));h.append(window.TaejangEmployeeLeave.employeePanel({id:'employee'}));});
 await page.getByRole('button',{name:'근무시간 확인·변경',exact:true}).click();
 const work=page.locator('#work-qa');await work.getByRole('heading',{name:'근무시간',exact:true}).waitFor();
 assert.equal(await work.getByText('연차 발생·사용·조정 이력',{exact:true}).count(),0);assert.equal(await work.getByRole('heading',{name:'연차 신청·승인',exact:true}).count(),0);
 assert.equal(await work.locator('input[type=date],input[type=time]').count(),0,'dates and times cannot be typed');
 assert.equal(await work.getByRole('button',{name:'적용 시작일',exact:true}).evaluate(n=>n.value),'2026-11-02','initial registration defaults to tomorrow, preserving today punches');
 await work.getByRole('button',{name:'적용 시작일',exact:true}).click();await work.getByRole('button',{name:'2026-11-03 선택',exact:true}).click();
 await work.getByLabel('출근 시각 시',{exact:true}).selectOption('21');await work.getByLabel('출근 시각 분',{exact:true}).selectOption('00');
 await work.getByLabel('퇴근 시각 시',{exact:true}).selectOption('18');await work.getByLabel('퇴근 시각 분',{exact:true}).selectOption('00');
 await work.getByLabel('근무장소',{exact:true}).selectOption('office');await work.getByLabel('등록 사유',{exact:true}).fill('실제 근로계약 확인');for(let i=0;i<5;i++)await work.locator('.leave-weekdays input').nth(i).check();
 await work.getByRole('button',{name:'근무시간 저장',exact:true}).click();await work.getByText('퇴근 시각은 출근 시각보다 늦어야 합니다.',{exact:false}).waitFor();
 assert.equal((await page.evaluate(()=>window.calls)).some(c=>c.name==='save_employee_work_terms'),false,'invalid reverse times never sent');
 await work.getByLabel('출근 시각 시',{exact:true}).selectOption('09');await work.getByLabel('퇴근 시각 시',{exact:true}).selectOption('12');
 await page.evaluate(()=>{window.conflictNext=true;});await work.getByRole('button',{name:'근무시간 저장',exact:true}).click();await work.getByText('선택한 적용일에는 이미 출근 기록이 있습니다.',{exact:false}).waitFor();
 assert.equal(await work.getByLabel('출근 시각 시',{exact:true}).inputValue(),'09');
 await page.evaluate(()=>{window.failNext=true;});await work.getByRole('button',{name:'근무시간 저장',exact:true}).click();await work.getByText('저장하지 못했습니다.',{exact:false}).waitFor();
 assert.equal(await work.getByLabel('출근 시각 시',{exact:true}).inputValue(),'09');assert.equal(await work.getByLabel('등록 사유',{exact:true}).inputValue(),'실제 근로계약 확인');
 await work.getByRole('button',{name:'근무시간 저장',exact:true}).click();
 await page.waitForFunction(()=>window.calls.filter(c=>c.name==='save_employee_work_terms').length===3);
 assert.ok((await page.evaluate(()=>window.calls)).some(c=>c.name==='save_employee_work_terms'&&c.args.p_values.starts_at==='09:00'&&c.args.p_values.effective_from==='2026-11-03'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'mobile work form does not overflow');
 await page.waitForFunction(()=>document.querySelector('#work-qa [aria-label="적용 시작일"]')?.value==='2026-11-04');
 await work.locator('.employee-work-summary').getByText('변경 예정 · 09:00 ~ 12:00 (2026-11-03부터)',{exact:true}).waitFor();
 const boxes=await work.locator('.leave-weekdays label').evaluateAll(labels=>labels.map(l=>{const r=l.getBoundingClientRect(),c=l.querySelector('input').getBoundingClientRect(),t=l.querySelector('span').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,cx:c.x,cr:c.right,cy:c.y,cb:c.bottom,tx:t.x,tr:t.right,ty:t.y,tb:t.bottom};}));
 for(let i=0;i<boxes.length;i++){const a=boxes[i];assert.ok(a.cx>=a.x&&a.cr<=a.right&&a.cy>=a.y&&a.cb<=a.bottom,'checkbox stays in its own day tile');assert.ok(a.tx>=a.x&&a.tr<=a.right&&a.ty>=a.y&&a.tb<=a.bottom&&a.cb<=a.ty,'day text stays below its checkbox without overlap');for(let j=i+1;j<boxes.length;j++){const b=boxes[j];assert.ok(a.right<=b.x||b.right<=a.x||a.bottom<=b.y||b.bottom<=a.y,'weekday touch areas never overlap');}}
 if(width<600)assert.ok(boxes[4].y>boxes[0].y,'mobile weekdays wrap into two rows');
 fs.mkdirSync('leave-admin-qa-artifacts',{recursive:true});await work.screenshot({path:`leave-admin-qa-artifacts/work-time-${width}.png`});
 // Lead may initialize an unconfigured employee once, including an actual zero balance.
 await page.evaluate(()=>{fixtureLeaveContext.can_initialize=true;fixtureLeaveContext.can_adjust=false;fixtureLeaveContext.can_manage_work_terms=true;return window.TaejangEmployeeLeave.open();});
 await page.getByRole('button',{name:'직원별 연차 등록·현황',exact:true}).click();
 await page.getByLabel('직원 선택').selectOption('second');
 await page.getByRole('button',{name:'최초 연차 등록',exact:true}).waitFor();
 await page.getByLabel('지금까지 발생한 연차',{exact:true}).fill('0');await page.getByLabel('현재 남은 연차',{exact:true}).fill('0');await page.getByLabel('입력 근거',{exact:true}).selectOption('ledger');assert.equal(await page.getByLabel('기타 입력 근거',{exact:true}).isVisible(),false);
 await page.getByRole('button',{name:'최초 연차 등록',exact:true}).click();
 await page.getByText('등록된 연차 개수의 변경은 운영총괄에게 요청해주세요.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='initialize_employee_leave').at(-1).args.p_reason),'기존 연차대장 확인','selection becomes server audit reason without manual typing');
 assert.equal(await page.getByRole('button',{name:'최초 연차 등록',exact:true}).count(),0,'registered zero balance is not unconfigured');
 assert.equal(await page.getByText('잔여 연차 조정',{exact:true}).count(),0,'lead cannot adjust registered balance');
 await page.evaluate(()=>{const h=document.createElement('div');h.id='lead-work-qa';document.querySelector('#dashboard-main').append(h);h.append(window.TaejangEmployeeLeave.employeePanel({id:'second'}));});
 await page.locator('#lead-work-qa').getByRole('button',{name:'근무시간 확인·변경',exact:true}).click();
 await page.locator('#lead-work-qa').getByRole('button',{name:'근무시간 저장',exact:true}).waitFor();
 assert.equal(await page.locator('#lead-work-qa').getByRole('button',{name:'최초 연차 등록',exact:true}).count(),0);
 await page.evaluate(()=>{window.fixtureLeaveContext.can_review=false;return window.TaejangEmployeeLeave.open();});
 assert.equal(await page.getByText('연차 대리 등록',{exact:true}).count(),0,'registration follows review capability');
 await page.evaluate(()=>{window.fixtureLeaveContext.can_review=true;return window.TaejangEmployeeLeave.open();});
 const leaveNav=page.getByRole('navigation',{name:'연차 관리 화면'});
 assert.deepEqual(await leaveNav.getByRole('button').allTextContents(),['신청·승인','취소·수정 이력','직원별 연차 등록·현황','연차 대리 등록']);
 assert.equal(await page.getByLabel('대리 등록 직원',{exact:true}).count(),0,'registration form has its own tab');
 const registrationTab=leaveNav.getByRole('button',{name:'연차 대리 등록',exact:true});
 await registrationTab.click();
 await page.getByRole('heading',{name:'연차 대리 등록',exact:true}).waitFor();
 assert.equal(await registrationTab.getAttribute('aria-pressed'),'true');
 assert.equal(await page.getByLabel('신청 직원',{exact:true}).count(),0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'four tabs and registration form fit viewport');
 const proxyEmployee=page.getByLabel('대리 등록 직원',{exact:true});
 assert.equal(await proxyEmployee.locator('option[value=retired]').count(),0);
 const proxyDate=page.getByLabel('연차 사용일',{exact:true});
 assert.deepEqual(await proxyDate.locator('option').evaluateAll(options=>options.map(option=>option.value)),['','2026-11-01','2026-11-02','2026-11-03']);
 await proxyEmployee.selectOption('employee');
 await proxyDate.selectOption('2026-11-03');
 await page.getByLabel('대리 등록 사유',{exact:true}).fill('직원 요청 확인');
 await page.evaluate(()=>{window.failNext=true;});
 const proxySubmit=page.getByRole('button',{name:'연차 등록 및 승인',exact:true});
 await proxySubmit.click();
 await page.getByText('저장하지 못했습니다.',{exact:false}).waitFor();
 assert.equal(await proxyDate.inputValue(),'2026-11-03');
 await proxySubmit.click();
 await page.getByText('연차 대리 등록을 저장했습니다.',{exact:true}).waitFor();
 await page.getByText('대리 등록 사유: 직원 요청 확인',{exact:true}).waitFor();
 assert.equal(await leaveNav.getByRole('button',{name:'신청·승인',exact:true}).getAttribute('aria-pressed'),'true');
 const registrationCalls=await page.evaluate(()=>window.calls.filter(c=>c.name==='admin_register_urgent_employee_leave').map(c=>c.args));
 assert.equal(registrationCalls.length,2);
 assert.deepEqual(registrationCalls[0],registrationCalls[1],'uncertain result retries the same request ID and fields');
 await page.evaluate(()=>{window.rosterMissing=true;return window.TaejangEmployeeLeave.open();});await page.getByText('직원 재직·직급 정보의 서버 업데이트가 필요합니다.',{exact:false}).waitFor();assert.equal(await page.getByLabel('직원 선택').count(),0,'old server never silently shows all employees');
 // Actual dashboard card controller, shared styles and DOM; only RPC results are synthetic.
 await page.evaluate(()=>{document.querySelector('#dashboard-main').innerHTML='<div class="dashboard-grid"></div>';window.attentionRole='operations_manager';window.attentionAllowed=true;window.attentionResult={server_now:'2026-11-06T09:05:00+09:00',missing_clock_ins:[],pending_leaves:[],attendance_allowed:true,leave_allowed:true};window.TaejangApp={getRoute:()=>window.attentionRole,getSession:()=>({user:{id:'actor'}}),can:()=>window.attentionAllowed,rpc:async()=>window.attentionResult};window.TaejangMenuAuthority={allowed:()=>window.attentionAllowed};window.attendanceOpened=false;window.TaejangAttendanceAdmin={openAttendance:()=>{window.attendanceOpened=true;}};window.attentionOpened=false;window.TaejangEmployeeLeave={open:()=>{window.attentionOpened=true;}};});
 await page.addScriptTag({content:fs.readFileSync(new URL('../app/assets/management-attention-cards.js',import.meta.url),'utf8')});
 for(const role of ['operations_manager','promotion_lead']){
  await page.evaluate(role=>{window.attentionRole=role;window.TaejangManagementAttention.clear();window.TaejangManagementAttention.mount(document.querySelector('#dashboard-main'));},role);
  await page.waitForFunction(()=>document.querySelector('[data-management-attention]')?.hidden===true);
  await page.evaluate(()=>{window.attentionResult.missing_clock_ins=[{name:'검수 직원',starts_at:'2026-11-06T09:00:00+09:00'}];window.attentionResult.pending_leaves=[{name:'둘째 직원',work_date:'2026-11-20',kind:'application'}];return window.TaejangManagementAttention.refresh();});
  await page.getByRole('heading',{name:'출근 확인 필요 1명',exact:true}).waitFor();await page.getByRole('heading',{name:'연차 확인 대기 1건',exact:true}).waitFor();
  assert.equal(await page.getByText('검수 직원 · 예정 09:00',{exact:true}).count(),1);await page.locator('[data-management-attention] article').nth(0).getByRole('button',{name:'확인하기'}).click();assert.equal(await page.evaluate(()=>window.attendanceOpened),true);await page.locator('[data-management-attention] article').nth(1).getByRole('button',{name:'확인하기'}).click();assert.equal(await page.evaluate(()=>window.attentionOpened),true);
  await page.locator('[data-management-attention]').screenshot({path:`leave-admin-qa-artifacts/management-attention-${role}-${width}.png`});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'management attention cards fit viewport');
  await page.evaluate(()=>{window.attentionResult.missing_clock_ins=[];window.attentionResult.pending_leaves=[];return window.TaejangManagementAttention.refresh();});
  assert.equal(await page.locator('[data-management-attention]').isVisible(),false,'no pending action produces no card');
 }
 await page.evaluate(()=>{window.attentionDeniedCalls=0;window.TaejangApp.rpc=async()=>{window.attentionDeniedCalls++;throw Object.assign(new Error('FORBIDDEN'),{code:'42501'});};return window.TaejangManagementAttention.refresh();});await page.evaluate(()=>window.TaejangManagementAttention.mount(document.querySelector('#dashboard-main')));assert.equal(await page.evaluate(()=>window.attentionDeniedCalls),1,'server denial hides data without a DOM-driven retry loop');assert.equal(await page.locator('[data-management-attention]').isVisible(),false);
 await page.evaluate(()=>{window.TaejangApp.rpc=()=>new Promise(resolve=>{window.lateAttention=resolve;});void window.TaejangManagementAttention.refresh();});await page.waitForFunction(()=>typeof window.lateAttention==='function');
 await page.evaluate(()=>{window.attentionAllowed=false;document.dispatchEvent(new CustomEvent('taejang-menu-authority-changed'));window.lateAttention({attendance_allowed:true,leave_allowed:true,missing_clock_ins:[{name:'늦은 응답 직원',starts_at:'2026-11-06T09:00:00+09:00'}],pending_leaves:[]});});
 assert.equal(await page.locator('[data-management-attention]').count(),0,'revocation clears cards before a late response');
 assert.deepEqual(errors,[]);await page.close();console.log(`LEAVE_WEB_BROWSER_PASS ${width}px scoped requests, approval/rejection, registration, input preservation, employee switching, secondary days off, schedule wiring`);
}
await browser.close();
