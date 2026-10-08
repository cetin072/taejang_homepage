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
