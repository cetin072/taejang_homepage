'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const monthly=require('../app/assets/attendance-monthly.js');
const writer=require('../app/assets/payroll-ledger-xlsx.js');
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
 assert.equal(monthly.classify(person).department,'미배정');assert.equal(monthly.classify(person).groupState,'미확인');
 const hidden=monthly.classify({...person,account_linked:true,account_active:false});assert.equal(monthly.matches(hidden,{accounts:'normal'}),false);assert.equal(monthly.matches(hidden,{accounts:'all'}),true);
 assert.equal(monthly.matches(monthly.classify({...person,is_test_account:true}),{accounts:'normal'}),false);
});
test('filters match actual multiple group/leader assignments and unassigned states',()=>{
 const row=monthly.classify(person,{groups:['작업반 A','작업반 B'],leaders:['확인 팀장'],groupsKnown:true,department_name:'생산',position_name:'근로자',attendance_required:true,employment_status:'active'});
 assert.equal(monthly.matches(row,{accounts:'all',group:'작업반 B',leader:'확인 팀장',department:'생산',attendance:'대상'}),true);
 assert.equal(monthly.matches(row,{accounts:'all',group:'미배정'}),false);
 assert.equal(monthly.matches(monthly.classify(person,{groupsKnown:true}),{accounts:'all',group:'미배정',leader:'미배정'}),true);
});
test('large monthly XLSX uses bounded ZIP writes',()=>{
 const rows=Array.from({length:150},(_,i)=>Array.from({length:34},()=>`가상 근태 ${i} 미확정 누락`));
 assert.ok(writer.buildTableWorkbookXlsx([{name:'월간',title:'가상 월간',note:'test',headers:Array(34).fill('날짜'),rows}]).length>500000);
});
