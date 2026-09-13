const test = require('node:test');
const assert = require('node:assert/strict');

const adapter = require('../app/assets/payroll-db-input-adapter.js');
const engine = require('../app/assets/payroll-engine.js');

const employeeUuid = '11111111-1111-4111-8111-111111111111';

function canonical(overrides = {}) {
  return {
    payroll_month: '2026-09-01',
    cutoff_date: '2026-09-07',
    input_basis_fingerprint: 'db-input-fingerprint-001',
    input_window: {
      boundary_start: '2026-08-31',
      prior_boundary_missing: false,
    },
    attendance_batches: {
      current_batch_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      prior_batch_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
    employees: [
      {
        employee_uuid: employeeUuid,
        employee_id: 'TJ-TEST-0001',
        hired_on: '2026-06-09',
        departed_on: null,
        employment_status: 'active',
      },
    ],
    terms: [
      {
        term_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        employee_uuid: employeeUuid,
        effective_from: '2026-06-09',
        effective_to: null,
        pay_type: 'hourly',
        daily_scheduled_hours: 3,
        hourly_rate: 10320,
        monthly_salary: null,
      },
    ],
    holidays: [
      { date: '2026-09-24', name: '추석 전날', paid: true },
      { date: '2026-09-25', name: '추석', paid: true },
    ],
    attendance: [
      {
        attendance_row_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
        source_key: 'source-0831',
        employee_uuid: employeeUuid,
        work_date: '2026-08-31',
        match_status: 'matched',
        record_status: 'complete_actual',
        auto_decision: 'actual_scheduled',
        review_status: 'not_required',
        confirmed_hours: null,
      },
      {
        attendance_row_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd02',
        source_key: 'source-0901',
        employee_uuid: employeeUuid,
        work_date: '2026-09-01',
        match_status: 'matched',
        record_status: 'complete_actual',
        auto_decision: 'actual_scheduled',
        review_status: 'not_required',
        confirmed_hours: null,
      },
      {
        attendance_row_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd03',
        source_key: 'source-0902',
        employee_uuid: employeeUuid,
        work_date: '2026-09-02',
        match_status: 'matched',
        record_status: 'leave_paid',
        auto_decision: 'paid_leave',
        review_status: 'not_required',
        confirmed_hours: null,
      },
      {
        attendance_row_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd04',
        source_key: 'source-0903',
        employee_uuid: employeeUuid,
        work_date: '2026-09-03',
        match_status: 'matched',
        record_status: 'absence_unpaid',
        auto_decision: 'unpaid_absence',
        review_status: 'not_required',
        confirmed_hours: null,
      },
      {
        attendance_row_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd05',
        source_key: 'source-0904',
        employee_uuid: employeeUuid,
        work_date: '2026-09-04',
        match_status: 'matched',
        record_status: 'manual_review',
        auto_decision: 'confirmed_correction',
        review_status: 'confirmed',
        confirmed_hours: 2,
      },
      {
        attendance_row_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd06',
        source_key: 'source-0908-future',
        employee_uuid: employeeUuid,
        work_date: '2026-09-08',
        match_status: 'matched',
        record_status: 'expected_future',
        auto_decision: 'expected_scheduled',
        review_status: 'not_required',
        confirmed_hours: null,
      },
    ],
    ...overrides,
  };
}

test('canonical UUID records become the existing engine employee-id contract without copying names', () => {
  const mapped = adapter.toEnginePayrollInputs(canonical());
  assert.deepEqual(mapped.employees, [
    { employeeId: 'TJ-TEST-0001', hiredAt: '2026-06-09', terminatedAt: null },
  ]);
  assert.equal(mapped.terms[0].employeeId, 'TJ-TEST-0001');
  assert.equal(mapped.terms[0].dailyScheduledHours, 3);
  assert.equal(mapped.terms[0].hourlyRate, 10320);
  assert.equal(mapped.inputBasisFingerprint, 'db-input-fingerprint-001');
  assert.equal(mapped.acceptedBatchId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal('displayName' in mapped.employees[0], false);
});

test('DB decisions map to the exact engine attendance semantics', () => {
  const mapped = adapter.toEnginePayrollInputs(canonical());
  const byDate = new Map(mapped.attendanceRecords.map((row) => [row.date, row]));
  assert.equal(byDate.get('2026-08-31').autoDecision, '기록완전');
  assert.equal(byDate.get('2026-09-02').autoDecision, '원본_유급월차');
  assert.equal(byDate.get('2026-09-03').autoDecision, '원본_무급결근');
  assert.equal(byDate.get('2026-09-04').reviewStatus, 'confirmed');
  assert.equal(byDate.get('2026-09-04').confirmedHours, 2);
  assert.equal(engine.classifyAttendanceRecord(byDate.get('2026-09-04')), engine.AttendanceState.MANUAL_CONFIRMED);
});

test('future expected DB row is omitted so engine projection is not mistaken for actual attendance', () => {
  const mapped = adapter.toEnginePayrollInputs(canonical());
  assert.equal(mapped.attendanceRecords.some((row) => row.date === '2026-09-08'), false);

  const result = engine.resolvePayableDay({
    employee: mapped.employees[0],
    date: '2026-09-08',
    terms: mapped.terms,
    holidays: mapped.holidays,
    attendanceMap: engine.indexAttendance(mapped.attendanceRecords),
    cutoffDate: mapped.cutoffDate,
  });
  assert.equal(result.kind, engine.DayValueKind.EXPECTED);
  assert.equal(result.payableHours, 3);
});

test('unmatched or ambiguous attendance never gets silently assigned and becomes an explicit input blocker', () => {
  const source = canonical();
  source.attendance.push({
    attendance_row_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    source_key: 'ambiguous-0907',
    employee_uuid: null,
    work_date: '2026-09-07',
    match_status: 'ambiguous',
    record_status: 'review_required',
    auto_decision: 'review_required',
    review_status: 'pending',
    confirmed_hours: null,
    exception_type: '동명이인',
  });

  const mapped = adapter.toEnginePayrollInputs(source);
  assert.equal(mapped.inputBlockers.length, 1);
  assert.deepEqual(mapped.inputBlockers[0], {
    code: 'attendance_employee_match_required',
    sourceKey: 'ambiguous-0907',
    date: '2026-09-07',
    matchStatus: 'ambiguous',
    exceptionType: '동명이인',
  });
  assert.equal(mapped.attendanceRecords.some((row) => row.sourceKey === 'ambiguous-0907'), false);
});

test('matched attendance pointing at a non-canonical employee fails closed', () => {
  const source = canonical();
  source.attendance.push({
    attendance_row_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    source_key: 'bad-employee',
    employee_uuid: '99999999-9999-4999-8999-999999999999',
    work_date: '2026-09-07',
    match_status: 'matched',
    record_status: 'complete_actual',
    auto_decision: 'actual_scheduled',
    review_status: 'not_required',
  });
  assert.throws(
    () => adapter.toEnginePayrollInputs(source),
    (error) => error && error.code === 'attendance_employee_not_canonical'
  );
});

test('monthly salary term is preserved but cannot masquerade as an hourly rate', () => {
  const source = canonical({
    terms: [
      {
        term_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        employee_uuid: employeeUuid,
        effective_from: '2026-06-09',
        effective_to: null,
        pay_type: 'monthly',
        daily_scheduled_hours: 8,
        hourly_rate: null,
        monthly_salary: 3000000,
      },
    ],
  });
  const mapped = adapter.toEnginePayrollInputs(source);
  assert.equal(mapped.terms[0].payType, 'monthly');
  assert.equal(mapped.terms[0].hourlyRate, null);
  assert.equal(mapped.terms[0].monthlySalary, 3000000);
});