'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const monthly=require('../app/assets/attendance-monthly.js');
const writer=require('../app/assets/attendance-monthly-xlsx.js');
const rosterSort=require('../app/assets/attendance-roster-sort.js');
const month='2026-09', dates=monthly.monthDates(month);
const person={employee_uuid:'synthetic-1',employee_id:'=1+1',display_name:'가상 직원',account_active:true};
function fixture(){return {month,daily:Object.fromEntries(dates.map(d=>[d,{rows:[person],workday:{is_workday:true}}])),ledger:{rows:[],period_fingerprint:'synthetic'}};}
test('strict full-month boundaries include leap day and reject invalid filenames',()=>{
 assert.equal(monthly.monthDates('2024-02').length,29);assert.equal(monthly.monthDates('2026-02').length,28);
 assert.equal(dates.at(-1),'2026-09-30');for(const value of ['2026-13','2026-00','../2026-09'])assert.throws(()=>monthly.monthDates(value));
});
test('KST midnight and missing clocks never invent hours or absence',()=>{
 assert.equal(monthly.time('2026-08-31T15:01:00Z'),'00:01');assert.equal(monthly.time('invalid'),'');
 const model=monthly.buildMonth(fixture());assert.match(model.rows[0].cells[0].label,/누락.*미확정/);assert.equal(model.rows[0].cells[0].clockIn,'');
});
test('confirmed status, holiday assignments and failed reads remain distinct',()=>{
 const f=fixture();f.daily[dates[1]].workday.is_workday=false;delete f.daily[dates[2]];
 f.ledger.rows=[{...person,employee_id_at_confirmation:'=1+1',display_name_at_confirmation:'가상 직원',work_date:dates[0],record_snapshot:{attendance_status:'paid_leave'},revision_no:1}];
 let model=monthly.buildMonth(f);assert.equal(model.rows[0].cells[0].label,'유급휴가');assert.equal(model.rows[0].cells[1].label,'휴일');assert.equal(model.rows[0].cells[2].label,'조회 실패');assert.equal(model.failedDays.length,1);
 f.daily[dates[1]].assignments=[{employee_uuid:person.employee_uuid}];model=monthly.buildMonth(f);assert.match(model.rows[0].cells[1].label,/누락/);
});
test('duplicate current employee/day fails closed; reopened revision is never current',()=>{
 const f=fixture(),r={...person,work_date:dates[0],record_snapshot:{attendance_status:'paid_leave'}};
 f.ledger.rows=[r,r];assert.throws(()=>monthly.buildMonth(f),/DUPLICATE/);
 f.ledger.rows=[{...r,is_reopened:true}];assert.equal(monthly.buildMonth(f).rows[0].confirmedDays,0);
});
test('no privileged metadata can introduce identities or sensitive workbook columns',()=>{
 const f=fixture();f.employees=[{id:'other',full_name:'restricted',resident_registration_number:'SENSITIVE'}];
 const model=monthly.buildMonth(f),sheets=monthly.workbookSheets(model);assert.equal(model.rows.length,1);
 const bytes=writer.buildTableWorkbookXlsx(sheets),text=Buffer.from(bytes).toString('utf8');
 assert.equal(Buffer.from(bytes).readUInt32LE(0),0x04034b50);assert.match(text,/일별 상세/);assert.match(text,/t="inlineStr"/);assert.match(text,/=1\+1/);assert.doesNotMatch(text,/<f>|SENSITIVE|restricted|주민|생년|장애|계좌|급여액/);
});
test('empty month exports valid headers and zero employees',()=>{
 const f=fixture();for(const d of dates)f.daily[d].rows=[];
 const model=monthly.buildMonth(f);assert.equal(model.rows.length,0);assert.equal(monthly.workbookSheets(model)[0].rows.length,0);
 assert.ok(writer.buildTableWorkbookXlsx(monthly.workbookSheets(model)).length>1000);
});

test('classification uses real metadata, preserves unlinked employees and never infers disability/test from role or name',()=>{
 const real=monthly.classify({...person,account_linked:false,display_name:'테스트라는 실제 이름',role:'general_worker'},{department_name:'운영',position_name:'일반 근로자',attendance_required:true});
 assert.equal(real.department,'운영');assert.equal(real.testAccount,false);assert.equal(real.account,'미연결');assert.equal(real.job,'일반 근로자');assert.equal('disability' in real,false);assert.equal(monthly.matches(real,{accounts:'normal'}),true);
 assert.equal(monthly.classify(person).department,'미확인');assert.equal(monthly.classify(person).groupState,'미확인');
 const hidden=monthly.classify({...person,account_linked:true,account_active:false});assert.equal(monthly.matches(hidden,{accounts:'normal'}),false);assert.equal(monthly.matches(hidden,{accounts:'all'}),true);
 assert.equal(monthly.matches(monthly.classify({...person,is_test_account:true}),{accounts:'normal'}),false);
});
test('filters match actual multiple group/leader assignments and unassigned states',()=>{
 const row=monthly.classify(person,{groups:['작업반 A','작업반 B'],leaders:['확인 팀장'],groupsKnown:true,department_name:'생산',position_name:'근로자',attendance_required:true,employment_status:'active'});
 assert.equal(monthly.matches(row,{accounts:'all',group:'작업반 B',leader:'확인 팀장',department:'생산',attendance:'대상'}),true);
 assert.equal(monthly.matches(row,{accounts:'all',group:'미배정'}),false);
 assert.equal(monthly.matches(monthly.classify(person,{groupsKnown:true}),{accounts:'all',group:'미배정',leader:'미배정'}),true);
});
test('KST as-of labels future attendance as scheduled rather than missing',()=>{
 const futureMonth='2026-10',days=monthly.monthDates(futureMonth);
 const f={
  month:futureMonth,
  queriedAt:'2026-10-08T15:05:00Z', // Already 2026-10-09 in Korea.
  daily:Object.fromEntries(days.map(d=>[d,{rows:[person],workday:{is_workday:true}}])),
  ledger:{rows:[],period_fingerprint:'future-fixture'}
 };
 f.daily['2026-10-12'].workday.is_workday=false;
 const model=monthly.buildMonth(f),employee=model.rows[0];
 assert.equal(model.asOfDay,'2026-10-09');
 assert.match(employee.cells[8].label,/누락.*미확정/,'today is not silently marked complete');
 assert.equal(employee.cells[9].label,'근무 예정');
 assert.equal(employee.cells[9].review,false,'tomorrow is not a missing punch');
 assert.equal(employee.cells[11].label,'휴일 예정');
 assert.equal(employee.cells[29].label,'근무 예정');
 assert.equal(employee.reviewDays,9,'future dates do not inflate exception totals');
 const exported=monthly.workbookSheets(model)[0].rows[0];
 assert.match(exported[11],/근무 예정/,'monthly Excel uses the same status');
 assert.doesNotMatch(exported[11],/09:00|18:00|누락/,'no synthetic clock times or missing label');
});
test('approved historical scheduled work is distinct from unresolved confirmed missing clocks',()=>{
 const f=fixture();
 const confirmed=(date,flags)=>({
  ...person,employee_id_at_confirmation:person.employee_id,
  display_name_at_confirmation:person.display_name,work_date:date,
  clock_in_at:null,clock_out_at:null,revision_no:1,
  record_snapshot:{attendance_status:'work',...flags}
 });
 f.ledger.rows=[
  confirmed(dates[0],{historical_default_present:true,payroll_decision:'actual_scheduled'}),
  confirmed(dates[1],{historical_default_present:false,payroll_decision:'actual_scheduled'}),
 ];
 const row=monthly.buildMonth(f).rows[0];
 assert.equal(row.cells[0].label,'기준근무 확정 · 시각 미기재');
 assert.equal(row.cells[0].confirmed,true);
 assert.equal(row.cells[0].review,false);
 assert.equal(row.cells[0].clockIn,'');
 assert.equal(row.cells[0].clockOut,'');
 assert.equal(row.cells[1].label,'누락 · 확정 확인 필요');
 assert.equal(row.cells[1].confirmed,true);
 assert.equal(row.cells[1].review,true);
 const detail=monthly.workbookSheets(monthly.buildMonth(f))[1];
 assert.equal(detail.rows[0][3],'기준근무 확정 · 시각 미기재');
 assert.equal(detail.rows[0][4],'');
 assert.equal(detail.rows[0][5],'');
});

test('large monthly XLSX uses bounded ZIP writes',()=>{
 const rows=Array.from({length:150},(_,i)=>Array.from({length:34},()=>`가상 근태 ${i} 미확정 누락`));
 assert.ok(writer.buildTableWorkbookXlsx([{name:'월간',title:'가상 월간',note:'test',headers:Array(34).fill('날짜'),rows}]).length>500000);
});


test('future approved full and half leave labels precede generic work plans',()=>{
 const day='2026-11-10';
 for(const [portion,status,label] of [['full','paid_leave','연차(승인)'],['first_half','work','앞 반차(승인)'],['second_half','work','뒤 반차(승인)']]){
  const model=monthly.buildMonth({month:'2026-11',ledger:{rows:[]},daily:{[day]:{rows:[{employee_uuid:'leave-worker',display_name:'직원',attendance_status:{status,leave_portion:portion,leave_request_id:'approved'}}],workday:{is_workday:true}}},queriedAt:'2026-11-02T00:00:00Z'});
  const cell=model.rows[0].cells[9];assert.equal(cell.label,label);assert.equal(cell.review,false);
 }
});

test('attendance roster sorts by personnel position then Korean name regardless of review count',()=>{
 const context={positions:[
  {id:'worker',code:'general_worker'},{id:'lead',code:'department_lead'},
  {id:'ops',code:'operations_manager'},{id:'ceo',code:'ceo'}
 ],employees:[
  {id:'w',position_id:'worker'},{id:'l1',position_id:'lead'},
  {id:'l2',position_id:'lead'},{id:'o',position_id:'ops'},{id:'c',position_id:'ceo'}
 ]};
 const rows=[
  {employee_uuid:'w',display_name:'가은',employee_id:'A',reviewDays:20},
  {employee_uuid:'l1',display_name:'나연',employee_id:'B',reviewDays:2},
  {employee_uuid:'l2',display_name:'가연',employee_id:'C',reviewDays:0},
  {employee_uuid:'o',display_name:'아름',employee_id:'D'},
  {employee_uuid:'c',display_name:'차윤',employee_id:'E'},
  {employee_uuid:'unknown',display_name:'가람',employee_id:'F'}
 ];
 const original=rows.map(row=>row.employee_uuid);
 const ordered=rosterSort.sortRows(rows,rosterSort.positionOrders(context));
 assert.deepEqual(ordered.map(row=>row.employee_uuid),['c','o','l2','l1','w','unknown']);
 assert.deepEqual(rows.map(row=>row.employee_uuid),original,'sorting never mutates source attendance records');
});
test('same-position ties sort by Korean name, then employee number; missing rank stays last',()=>{
 const rows=[
  {employee_uuid:'c',display_name:'나리',employee_id:'003',position_order:40},
  {employee_uuid:'b',display_name:'가람',employee_id:'002',position_order:40},
  {employee_uuid:'a',display_name:'가람',employee_id:'001',position_order:40},
  {employee_uuid:'unknown',display_name:'가희',employee_id:'000'},
  {employee_uuid:'ops',display_name:'다영',employee_id:'010',position_order:20}
 ];
 assert.deepEqual(rosterSort.sortRows(rows).map(row=>row.employee_uuid),['ops','a','b','c','unknown']);
 assert.deepEqual(rosterSort.sortRows([{employee_uuid:'2',display_name:'하늘'},{employee_uuid:'1',display_name:'가영'}])
  .map(row=>row.employee_uuid),['1','2']);
});
