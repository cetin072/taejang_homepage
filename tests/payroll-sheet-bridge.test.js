const test = require('node:test');
const assert = require('node:assert/strict');

const bridge = require('../app/assets/payroll-sheet-bridge.js');
const engine = require('../app/assets/payroll-engine.js');

const employeeMaster = [
  ['employee_id', '성명', '구분', '재직상태', '입사일', '퇴사일', '주민등록번호'],
  ['TJ-TEST-0001', 'SECRET-NAME', '근로자', '재직', '2026-06-09', '', 'SECRET-RRN'],
  ['TJ-TEST-EXEC', 'SECRET-EXEC', '임원', '재직', '2026-06-09', '', 'SECRET-EXEC-RRN'],
];

const employmentTerms = [
  ['employee_id', '성명', '적용시작일', '적용종료일', '급여형태', '일 소정시간', '시급', '월 기본급', '근거/메모'],
  ['TJ-TEST-0001', 'SECRET-NAME', '2026-06-09', '2026-08-23', '시급', '3', '10,320', '', 'old'],
  ['TJ-TEST-0001', 'SECRET-NAME', '2026-08-24', '', '시급', '4', '10,320', '', 'new'],
  ['TJ-TEST-EXEC', 'SECRET-EXEC', '2026-06-09', '', '월급', '', '', '3,000,000', 'salary'],
];

const normalizedAttendance = [
  ['source_key', 'employee_id', '성명', '근무일', '예정시간', '출근_원본', '퇴근_원본', '상태_원본', '매칭상태', '기록상태', '자동판정', '예외유형', '검토상태', '확정근로시간'],
  ['SRC-1', 'TJ-TEST-0001', 'SECRET-NAME', '2026-08-31', '4', '08:30', '13:00', '', '매칭', '출퇴근완전', '기록완전', '', '자동분류', ''],
  ['SRC-2', 'TJ-TEST-0001', 'SECRET-NAME', '2026-09-07', '4', '10:27', '12:00', '', '매칭', '수기', '수기확인', '수기기록', '확정', '2'],
];

const holidayMaster = [
  ['날짜', '명칭', '구분', '유급여부', '근거/상태'],
  ['2026-09-24', '추석 전날', '법정공휴일', '유급', 'fixture'],
  ['2026-09-25', '추석', '법정공휴일', '유급', 'fixture'],
  ['2026-09-26', '추석 다음날', '법정공휴일', '유급', 'fixture'],
];

test('employee bridge keeps only employee_id and employment dates for hourly workers', () => {
  const rows = bridge.adaptEmployeeMaster(employeeMaster);

  assert.deepEqual(rows, [
    {
      employeeId: 'TJ-TEST-0001',
      hiredAt: '2026-06-09',
      terminatedAt: null,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /SECRET/);
});

test('employment term bridge parses comma-formatted hourly rate and preserves effective boundaries', () => {
  const rows = bridge.adaptEmploymentTerms(employmentTerms);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].dailyScheduledHours, 3);
  assert.equal(rows[0].hourlyRate, 10320);
  assert.equal(rows[0].effectiveTo, '2026-08-23');
  assert.equal(rows[1].dailyScheduledHours, 4);
  assert.equal(rows[1].effectiveFrom, '2026-08-24');
  assert.doesNotMatch(JSON.stringify(rows), /SECRET/);
});

test('attendance bridge removes names and clock times while keeping auditable calculation decisions', () => {
  const rows = bridge.adaptNormalizedAttendance(normalizedAttendance);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].sourceKey, 'SRC-1');
  assert.equal(rows[0].autoDecision, '기록완전');
  assert.equal(rows[1].reviewStatus, 'confirmed');
  assert.equal(rows[1].confirmedHours, 2);

  const serialized = JSON.stringify(rows);
  assert.doesNotMatch(serialized, /SECRET-NAME/);
  assert.doesNotMatch(serialized, /08:30/);
  assert.doesNotMatch(serialized, /10:27/);
});

test('holiday bridge preserves paid holiday meaning without Sheet-specific extra columns', () => {
  const rows = bridge.adaptHolidayMaster(holidayMaster);

  assert.deepEqual(rows[0], {
    date: '2026-09-24',
    name: '추석 전날',
    paid: true,
  });
  assert.equal(rows.length, 3);
});

test('bridge output can feed the deterministic engine without reinterpreting Sheet columns', () => {
  const input = bridge.buildEngineInput({
    employeeMaster,
    employmentTerms,
    normalizedAttendance,
    holidayMaster,
  });

  const employee = input.employees[0];
  assert.equal(engine.scheduledHoursForDate(employee, '2026-08-23', input.terms), 3);
  assert.equal(engine.scheduledHoursForDate(employee, '2026-08-24', input.terms), 4);

  const attendanceMap = engine.indexAttendance(input.attendanceRecords);
  const corrected = engine.resolvePayableDay({
    employee,
    date: '2026-09-07',
    terms: input.terms,
    holidays: input.holidays,
    attendanceMap,
    cutoffDate: '2026-09-07',
  });

  assert.equal(corrected.payableHours, 2);
  assert.equal(corrected.attendanceState, engine.AttendanceState.MANUAL_CONFIRMED);
});

test('missing required Sheet headers fails closed rather than silently shifting columns', () => {
  assert.throws(
    () => bridge.adaptEmploymentTerms([
      ['employee_id', '적용시작일', '급여형태'],
      ['TJ-TEST-0001', '2026-06-09', '시급'],
    ]),
    /필수 헤더 누락/
  );
});
