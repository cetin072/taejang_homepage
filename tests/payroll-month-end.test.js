const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../app/assets/payroll-month-end-core.js');

function payrollReply() {
  const header = [
    [null,'사원번호','성  명','기본급','직책수당','월차수당','식대','자가운전보조금','야간근로수당','기타수당','국민연금','건강보험','장기요양보험','소득세','지방소득세','미제출비과세'],
    [null,'입 사 일','직  위','보육수당',null,null,null,null,null,null,'고용보험','국민연금정산',null,null,null,'공제합계'],
    [null,'퇴 사 일','부  서',null,null,null,null,null,null,'지급합계',null,null,null,null,'농특세','차인지급액'],
  ];
  const row = (id,name) => [
    [null,id,name,'1,200,000',null,null,'50,000',null,null,null,null,'35,000'],
    [null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,'35,000'],
    [null,null,null,null,null,null,null,null,null,'1,250,000',null,null,null,null,null,'1,215,000'],
  ];
  return [{matrix:[[null,'2026년 10월분 급여대장'],[null,'지급일 : 2026년 10월 31일'],
    ...header,...row('0017','가상 직원'),[],...header,...row('0018','가상 퇴사자')]}];
}

test('tax reply supports its three-line layout and repeated print headers', () => {
  const reply = core.parseTaxLedger(payrollReply(),'2026-10');
  assert.deepEqual(reply[0],{tax_id:'17',name:'가상 직원',gross:1250000,deduction:35000,net:1215000,
    earnings:[{label:'기본급',amount:1200000},{label:'식대',amount:50000}],deductions:[{label:'건강보험',amount:35000}]});
  assert.equal(reply.length,2);
  assert.throws(() => core.parseTaxLedger(payrollReply(),'2026-09'),/급여월/);
  const inconsistent = payrollReply();
  inconsistent[0].matrix[5][6] = '50,001';
  assert.throws(() => core.parseTaxLedger(inconsistent,'2026-10'),/합계/);
  const duplicate = payrollReply();
  duplicate[0].matrix[12][1] = '017';
  assert.throws(() => core.parseTaxLedger(duplicate,'2026-10'),/중복/);
});

test('comparison puts amount, identity and missing recipients ahead of matches', () => {
  const reply = core.parseTaxLedger(payrollReply(),'2026-10');
  const correct = {tax_id:'17',name:'가상 직원',gross:1250000,deduction:35000};
  const changed = {...reply[1],deduction:36000};
  assert.deepEqual(core.compare([correct,changed],reply).map(row => row.status),['금액 차이','일치']);
  assert.deepEqual(core.compare([{...correct,name:'다른 직원'}],reply).map(row => row.status),['이름 불일치','ERP 대상 없음']);
});

test('Excel preserves the cutoff and separates planned attendance from unresolved attendance', () => {
  const capture = {buildTableWorkbookXlsx: sheets => sheets};
  const draft = {cutoff:'2026-10-28',rows:[{employee_id:'TJ-000017',tax_id:'17',name:'가상 직원',staff:true,
    gross:1250000,deduction:35000,basis:'기본급과 식대',
    days:[{date:'2026-10-27',label:'확인 필요'},{date:'2026-10-29',label:'예정 근무',minutes:240}]}]};
  const [ledger,attendance]=core.draftWorkbook('2026-10',draft,1,capture);
  assert.match(ledger.note,/2026-10-28/);
  assert.equal(ledger.rows[0][6],1215000);
  assert.deepEqual(attendance.rows[0].slice(2),['확인 필요','예정 근무 (240)']);
});
