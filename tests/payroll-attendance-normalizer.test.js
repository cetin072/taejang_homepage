const test = require('node:test');
const assert = require('node:assert/strict');

const normalizer = require('../app/assets/payroll-attendance-normalizer.js');

const E1 = 'TJ-NORM-0001';
const E2 = 'TJ-NORM-0002';

function employee(overrides = {}) {
  return {
    employeeId: E1,
    sourceEmployeeNumber: '101',
    name: '익명A',
    hiredAt: '2026-06-09',
    terminatedAt: null,
    ...overrides,
  };
}

function term(overrides = {}) {
  return {
    employeeId: E1,
    effectiveFrom: '2026-06-09',
    effectiveTo: null,
    dailyScheduledHours: 3,
    hourlyRate: 10320,
    ...overrides,
  };
}

function raw(overrides = {}) {
  return {
    sourceKey: 'SRC|8월|3|2026-08-03',
    sourceName: '익명A',
    date: '2026-08-03',
    clockInRaw: '08:45',
    clockOutRaw: '12:00',
    sourceStatus: '',
    manualFlag: 'N',
    note: '원본헤더=8월 3일; 원본수정=2026-08-27T06:23:03.000Z',
    sourceFile: '익명 출퇴근부.xlsx',
    sourceRow: 3,
    ...overrides,
  };
}

test('unique name match produces deterministic employee_id and complete-record decision', () => {
  const result = normalizer.normalizeAttendanceRows({
    rawRows: [raw()],
    employees: [employee()],
    terms: [term()],
  });

  assert.equal(result.criticalIssueCount, 0);
  assert.equal(result.rows[0].employeeId, E1);
  assert.equal(result.rows[0].matchStatus, '매칭');
  assert.equal(result.rows[0].recordStatus, '출퇴근완전');
  assert.equal(result.rows[0].autoDecision, '기록완전');
  assert.equal(result.rows[0].scheduledHours, 3);
  assert.equal(result.rows[0].confirmedHours, null);
});

test('duplicate names may match only when exactly one candidate is active on the work date', () => {
  const employees = [
    employee({ employeeId: E1, terminatedAt: '2026-07-31' }),
    employee({ employeeId: E2, sourceEmployeeNumber: '202', hiredAt: '2026-08-01' }),
  ];
  const terms = [term({ employeeId: E2, effectiveFrom: '2026-08-01' })];

  const result = normalizer.normalizeAttendanceRows({ rawRows: [raw()], employees, terms });
  assert.equal(result.criticalIssueCount, 0);
  assert.equal(result.rows[0].employeeId, E2);
  assert.equal(result.rows[0].matchMethod, 'unique_active_name');
});

test('duplicate active names fail closed instead of picking the first person', () => {
  const employees = [
    employee({ employeeId: E1 }),
    employee({ employeeId: E2, sourceEmployeeNumber: '202' }),
  ];

  const result = normalizer.normalizeAttendanceRows({ rawRows: [raw()], employees, terms: [term()] });
  assert.equal(result.criticalIssueCount, 1);
  assert.equal(result.rows[0].employeeId, null);
  assert.equal(result.rows[0].matchStatus, '중복이름');
  assert.equal(result.rows[0].autoDecision, '확인필요');
});

test('an explicit source employee number never falls back to a same-name employee when the number is unknown', () => {
  const result = normalizer.normalizeAttendanceRows({
    rawRows: [raw({ sourceEmployeeNumber: 'DOES-NOT-EXIST' })],
    employees: [employee()],
    terms: [term()],
  });

  assert.equal(result.criticalIssueCount, 1);
  assert.equal(result.rows[0].employeeId, null);
  assert.equal(result.rows[0].matchStatus, '사번미매칭');
});

test('attendance outside employment lifecycle is not silently paid', () => {
  const result = normalizer.normalizeAttendanceRows({
    rawRows: [raw({ date: '2026-08-28' })],
    employees: [employee({ terminatedAt: '2026-08-27' })],
    terms: [term({ effectiveTo: '2026-08-27' })],
  });

  assert.equal(result.rows[0].scheduledHours, 0);
  assert.equal(result.rows[0].recordStatus, '재직기간충돌');
  assert.equal(result.rows[0].autoDecision, '확인필요');
  assert.equal(result.rows[0].exceptionType, '재직기간충돌');
});

test('termination marker outside lifecycle remains a termination marker rather than a lifecycle collision', () => {
  const result = normalizer.normalizeAttendanceRows({
    rawRows: [raw({ date: '2026-08-28', clockInRaw: '퇴사', clockOutRaw: '', sourceStatus: '퇴사' })],
    employees: [employee({ terminatedAt: '2026-08-27' })],
    terms: [term({ effectiveTo: '2026-08-27' })],
  });

  assert.equal(result.rows[0].recordStatus, '퇴사표시');
  assert.equal(result.rows[0].autoDecision, '원본_퇴사표시');
});

test('missing effective-dated term is visible and cannot become a complete record', () => {
  const result = normalizer.normalizeAttendanceRows({
    rawRows: [raw({ date: '2026-08-15' })],
    employees: [employee()],
    terms: [term({ effectiveTo: '2026-08-10' })],
  });

  assert.equal(result.highIssueCount, 1);
  assert.equal(result.rows[0].scheduledHours, null);
  assert.equal(result.rows[0].autoDecision, '근로조건확인필요');
  assert.equal(result.rows[0].exceptionType, '근로조건누락');
});

test('manual and partial records are review exceptions and clock span never becomes paid hours', () => {
  const result = normalizer.normalizeAttendanceRows({
    rawRows: [
      raw({ sourceKey: 'M', clockInRaw: '10:27 (수기)', clockOutRaw: '12:00', manualFlag: 'Y' }),
      raw({ sourceKey: 'P', date: '2026-08-04', clockInRaw: '09:00', clockOutRaw: '' }),
    ],
    employees: [employee()],
    terms: [term()],
  });

  assert.equal(result.rows[0].recordStatus, '수기기록');
  assert.equal(result.rows[0].exceptionType, '수기기록');
  assert.equal(result.rows[0].confirmedHours, null);
  assert.equal(result.rows[1].recordStatus, '출퇴근누락');
  assert.equal(result.rows[1].autoDecision, '확인필요');
  assert.equal(result.rows[1].confirmedHours, null);
});

test('a merged-cell holiday marker propagates to same-date blank worker rows like the Golden Sheet formula', () => {
  const result = normalizer.normalizeAttendanceRows({
    rawRows: [
      raw({ sourceKey: 'HOL-A', date: '2026-08-17', clockInRaw: '대체공휴일', clockOutRaw: '', sourceStatus: '대체공휴일' }),
      raw({ sourceKey: 'HOL-B', sourceName: '익명B', date: '2026-08-17', clockInRaw: '', clockOutRaw: '', sourceStatus: '' }),
    ],
    employees: [
      employee(),
      employee({ employeeId: E2, sourceEmployeeNumber: '202', name: '익명B' }),
    ],
    terms: [term(), term({ employeeId: E2 })],
  });

  assert.equal(result.rows[1].recordStatus, '휴일표시');
  assert.equal(result.rows[1].autoDecision, '원본_유급휴일');
});

test('scheduled future row after source modification date is explicitly expected, not complete actual attendance', () => {
  const result = normalizer.normalizeAttendanceRows({
    rawRows: [raw({
      date: '2026-08-31',
      clockInRaw: '',
      clockOutRaw: '12:00',
      note: '원본수정=2026-08-27T06:23:03.000Z',
    })],
    employees: [employee()],
    terms: [term()],
  });

  assert.equal(result.rows[0].recordStatus, '예상근무');
  assert.equal(result.rows[0].autoDecision, '예상_정상근무');
  assert.equal(result.rows[0].reviewStatus, 'expected');
});

test('paid leave and unpaid absence source markers are preserved as payroll decisions', () => {
  const result = normalizer.normalizeAttendanceRows({
    rawRows: [
      raw({ sourceKey: 'L', clockInRaw: '월차(유급)', clockOutRaw: '', sourceStatus: '월차(유급)' }),
      raw({ sourceKey: 'A', date: '2026-08-04', clockInRaw: '결근(개인사정) (무급)', clockOutRaw: '', sourceStatus: '결근(개인사정) (무급)' }),
    ],
    employees: [employee()],
    terms: [term()],
  });

  assert.equal(result.rows[0].autoDecision, '원본_유급월차');
  assert.equal(result.rows[1].autoDecision, '원본_무급결근');
});

test('latest confirmed correction is separate from the raw clocks and becomes the only confirmed-hours value', () => {
  const result = normalizer.normalizeAttendanceRows({
    rawRows: [raw({ sourceKey: 'CORR', clockInRaw: '10:27 (수기)', manualFlag: 'Y' })],
    employees: [employee()],
    terms: [term()],
    corrections: [
      { sourceKey: 'CORR', field: '확정근로시간', newValue: 2, status: '확정' },
      { sourceKey: 'CORR', field: '확정근로시간', newValue: 3, status: '확정' },
    ],
  });

  assert.equal(result.rows[0].confirmedHours, 3);
  assert.equal(result.rows[0].reviewStatus, 'confirmed');
  assert.equal(result.rows[0].correctionApplied, true);
});
