const test = require('node:test');
const assert = require('node:assert/strict');

const bridge = require('../app/assets/payroll-sheet-bridge.js');
const engine = require('../app/assets/payroll-engine.js');

const employeeMaster = [
  ['employee_id', '기존 사번', '성명', '구분', '재직상태', '입사일', '퇴사일', '주민등록번호'],
  ['TJ-TEST-0001', '1', 'SECRET-NAME', '근로자', '재직', '2026-06-09', '', 'SECRET-RRN'],
  ['TJ-TEST-EXEC', '2', 'SECRET-EXEC', '임원', '재직', '2026-06-09', '', 'SECRET-EXEC-RRN'],
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

function rawAttendance(rows) {
  return [
    ['source_key', '원본파일', '원본시트', '원본행', '성명_원본', '근무일', '출근_원본', '퇴근_원본', '상태_원본', '수기표시', '가져온시각', '가져온사람', '비고', '원본파일ID'],
    ...rows,
  ];
}

function rawRow({ key = 'RAW-1', name = 'SECRET-NAME', date = '2026-08-31', clockIn = '08:30', clockOut = '13:00', status = '', manual = 'N' } = {}) {
  return [
    key,
    '익명 출퇴근부.xlsx',
    '8월',
    3,
    name,
    date,
    clockIn,
    clockOut,
    status,
    manual,
    '2026-08-27 15:00:00',
    'qa@example.invalid',
    '원본헤더=익명; 원본수정=2026-08-27T06:23:03.000Z',
    'anonymous-file-id',
  ];
}

const emptyCorrections = [
  ['adjustment_id', 'source_key', 'employee_id', '성명', '대상일', '수정항목', '변경전', '변경후', '사유', '증빙/근거', '변경자', '변경시각', '상태'],
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

test('raw bridge now owns name matching and 기록완전 classification in versioned code', () => {
  const input = bridge.buildEngineInputFromRaw({
    employeeMaster,
    employmentTerms,
    rawAttendance: rawAttendance([rawRow()]),
    holidayMaster,
    corrections: emptyCorrections,
  });

  assert.equal(input.normalization.rowCount, 1);
  assert.equal(input.normalization.criticalIssueCount, 0);
  assert.equal(input.attendanceRecords.length, 1);
  assert.equal(input.attendanceRecords[0].employeeId, 'TJ-TEST-0001');
  assert.equal(input.attendanceRecords[0].autoDecision, '기록완전');
  assert.doesNotMatch(JSON.stringify(input.attendanceRecords), /SECRET-NAME|08:30|13:00/);
});

test('future scheduled-out row is audited as expected but not misrepresented as actual attendance to the engine', () => {
  const input = bridge.buildEngineInputFromRaw({
    employeeMaster,
    employmentTerms,
    rawAttendance: rawAttendance([rawRow({ date: '2026-08-31', clockIn: '', clockOut: '13:00' })]),
    holidayMaster,
    corrections: emptyCorrections,
  });

  assert.equal(input.normalization.rowCount, 1);
  assert.equal(input.attendanceRecords.length, 0);
});

test('unresolved manual record blocks the raw bridge until a confirmed correction exists', () => {
  assert.throws(
    () => bridge.buildEngineInputFromRaw({
      employeeMaster,
      employmentTerms,
      rawAttendance: rawAttendance([rawRow({ key: 'MANUAL', clockIn: '10:27 (수기)', manual: 'Y' })]),
      holidayMaster,
      corrections: emptyCorrections,
    }),
    (error) => error && error.code === 'payroll_attendance_review_required'
  );

  const corrections = [
    emptyCorrections[0],
    ['ADJ-1', 'MANUAL', 'TJ-TEST-0001', 'SECRET-NAME', '2026-08-31', '확정근로시간', '', '2', '확인', '익명근거', 'qa', '2026-09-01', '확정'],
  ];
  const input = bridge.buildEngineInputFromRaw({
    employeeMaster,
    employmentTerms,
    rawAttendance: rawAttendance([rawRow({ key: 'MANUAL', clockIn: '10:27 (수기)', manual: 'Y' })]),
    holidayMaster,
    corrections,
  });
  assert.equal(input.attendanceRecords[0].reviewStatus, 'confirmed');
  assert.equal(input.attendanceRecords[0].confirmedHours, 2);
});

test('ambiguous duplicate active names fail closed before payroll calculation', () => {
  const duplicateMaster = [
    employeeMaster[0],
    employeeMaster[1],
    ['TJ-TEST-0002', '9', 'SECRET-NAME', '근로자', '재직', '2026-06-09', '', 'SECRET-RRN-2'],
  ];

  assert.throws(
    () => bridge.buildEngineInputFromRaw({
      employeeMaster: duplicateMaster,
      employmentTerms,
      rawAttendance: rawAttendance([rawRow()]),
      holidayMaster,
      corrections: emptyCorrections,
    }),
    (error) => error
      && error.code === 'payroll_attendance_matching_failed'
      && error.normalization.criticalIssueCount > 0
  );
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
