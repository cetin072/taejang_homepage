const test = require('node:test');
const assert = require('node:assert/strict');

const ledger = require('../app/assets/payroll-ledger-xlsx.js');

const context = {
  employees: [{
    employee_id: 'T001',
    display_name: '테스트직원',
    hired_on: '2026-06-09',
    departed_on: null,
    actual_work_hours: 72,
    absence_day_count: 1,
    paid_leave_day_count: 1,
    paid_holiday_day_count: 1,
    weekly_holiday_actual_hours: 12,
    weekly_holiday_expected_hours: 0,
    hourly_rate: 10320,
    rate_status: 'single_rate',
    gross_pay_preview: 866880,
    national_pension_preview: 40000,
    health_insurance_preview: 30000,
    long_term_care_preview: 3000,
    employment_insurance_preview: 7000,
    statutory_deduction_preview: 80000,
    net_pay_preview: 786880,
    statutory_status: 'complete',
    unresolved_count: 0,
    attendance_days: {
      '2026-08-03': { hours: 3, decision: 'actual_scheduled' },
      '2026-08-04': { hours: 0, decision: 'unpaid_absence' },
      '2026-08-05': { hours: 3, decision: 'paid_leave' },
    },
  }],
};

test('payroll ledger matrix follows practical Taejang payroll fields without sensitive value columns', () => {
  const matrix = ledger.buildPayrollLedgerMatrix(context, '2026-08');
  assert.equal(matrix.rows.length, 1);
  assert.ok(matrix.headers.includes('기본급'));
  assert.ok(matrix.headers.includes('주휴수당'));
  assert.ok(matrix.headers.includes('총지급액'));
  assert.ok(matrix.headers.includes('국민연금'));
  assert.ok(matrix.headers.includes('건강보험'));
  assert.ok(matrix.headers.includes('장기요양'));
  assert.ok(matrix.headers.includes('고용보험'));
  assert.ok(matrix.headers.includes('공제계'));
  assert.ok(matrix.headers.includes('실지급액'));
  assert.ok(matrix.headers.includes('결근일수'));
  assert.ok(matrix.headers.includes('유급휴가일수'));
  assert.ok(matrix.headers.includes('유급공휴일수'));
  assert.ok(matrix.headers.some(header => String(header).startsWith('8/3')));
  assert.ok(!matrix.headers.includes('주민등록번호'));
  assert.ok(!matrix.headers.includes('급여계좌'));
});

test('hourly gross is split into base pay and weekly holiday pay without changing total gross', () => {
  const split = ledger.payrollSplit(context.employees[0]);
  assert.equal(split.weeklyHolidayPay, 123840);
  assert.equal(split.basicPay, 743040);
  assert.equal(split.basicPay + split.weeklyHolidayPay, context.employees[0].gross_pay_preview);
});

test('ledger xlsx is a valid ZIP-based xlsx payload with expected workbook parts', () => {
  const bytes = ledger.buildPayrollLedgerXlsx(context, '2026-08');
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const raw = Buffer.from(bytes).toString('utf8');
  assert.match(raw, /xl\/workbook\.xml/);
  assert.match(raw, /xl\/worksheets\/sheet1\.xml/);
  assert.match(raw, /농업회사법인 태장\(주\)/);
  assert.match(raw, /테스트직원/);
  assert.match(raw, /총지급액/);
  assert.match(raw, /실지급액/);
});
