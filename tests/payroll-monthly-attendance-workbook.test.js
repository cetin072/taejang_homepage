const test = require('node:test');
const assert = require('node:assert/strict');

const exporter = require('../app/assets/payroll-ledger-xlsx.js');

const input = {
  month: '2026-08',
  employees: [{ employee_uuid: 'employee-1', display_name: '익명 근로자', hired_on: '2026-01-02' }],
  protectedHrRows: [{
    employee_uuid: 'employee-1',
    gender: '여',
    birth_date: '1990-01-01',
    disability_type: '익명유형',
    monthly_leave_accrued: 1,
    monthly_leave_used: 0,
    monthly_leave_balance: 3,
    work_supporter: '익명 지도원',
  }],
  confirmedAttendance: [
    { employee_uuid: 'employee-1', work_date: '2026-08-03', attendance_status: 'work', clock_in_display: '08:59', clock_out_display: '12:01', confirmed_hours: 3 },
    { employee_uuid: 'employee-1', work_date: '2026-08-04', attendance_status: 'work', clock_in_display: '09:00', clock_out_display: '13:00', confirmed_hours: 4 },
    { employee_uuid: 'employee-1', work_date: '2026-08-05', attendance_status: 'paid_leave' },
    { employee_uuid: 'employee-1', work_date: '2026-08-06', attendance_status: 'unpaid_absence' },
    { employee_uuid: 'employee-1', work_date: '2026-08-07', attendance_status: 'paid_holiday' },
  ],
};

test('monthly workbook model keeps protected HR join separate from confirmed attendance and sums only confirmed work', () => {
  const model = exporter.buildMonthlyAttendanceWorkbookModel(input);
  assert.equal(model.days.length, 31);
  assert.equal(model.rows.length, 1);
  assert.equal(model.rows[0].workedHours, 7);
  assert.equal(model.rows[0].paidLeave, 1);
  assert.equal(model.rows[0].unpaidAbsence, 1);
  assert.equal(model.rows[0].paidHoliday, 1);
  assert.deepEqual(model.rows[0].daily[4], ['', '', '유급휴가']);
});

test('monthly attendance workbook requires an explicit one-to-one protected HR source', () => {
  assert.throws(
    () => exporter.buildMonthlyAttendanceWorkbookModel({ ...input, protectedHrRows: [] }),
    /monthly_attendance_workbook_protected_hr_missing/
  );
  assert.throws(
    () => exporter.buildMonthlyAttendanceWorkbookModel({ ...input, protectedHrRows: undefined }),
    /monthly_attendance_workbook_protected_hr_contract_required/
  );
});

test('monthly attendance workbook preserves the familiar day, morning/afternoon and HR column structure in a valid xlsx package', () => {
  const bytes = exporter.buildMonthlyAttendanceWorkbookXlsx(input);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const raw = Buffer.from(bytes).toString('utf8');
  assert.match(raw, /월간 출퇴근부 2026-08/);
  assert.match(raw, /오전 \/ 오후/);
  assert.match(raw, /출근\n오전/);
  assert.match(raw, /퇴근\n오후/);
  assert.match(raw, /월 근무시간/);
  assert.match(raw, /월차 발생/);
  assert.match(raw, /장애유형/);
  assert.match(raw, /protected HR join contract/);
  assert.match(raw, /<mergeCell ref="G3:I3"\/>/);
  assert.match(raw, /<v>7<\/v>/);
});

test('monthly attendance workbook rejects duplicated confirmed employee-days instead of choosing one', () => {
  assert.throws(
    () => exporter.buildMonthlyAttendanceWorkbookModel({
      ...input,
      confirmedAttendance: [...input.confirmedAttendance, { ...input.confirmedAttendance[0] }],
    }),
    /monthly_attendance_workbook_duplicate_confirmed_day/
  );
});
