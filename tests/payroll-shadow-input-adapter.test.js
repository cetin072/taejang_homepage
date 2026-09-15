const test = require('node:test');
const assert = require('node:assert/strict');

const adapter = require('../app/assets/payroll-shadow-input-adapter.js');

const workerUuid = '11111111-1111-4111-8111-111111111111';
const executiveUuid = '22222222-2222-4222-8222-222222222222';

test('an executive fixed-monthly subject is a separate payroll lane, not an unmatched attendance anomaly', () => {
  const result = adapter.buildShadowPayrollDtos({
    employeeRows: [
      { employee_id: 'WORKER-01', 구분: '근로자' },
      { employee_id: 'EXEC-01', 구분: '임원' },
    ],
    termRows: [
      { employee_id: 'WORKER-01', 급여형태: '시급', 시급: '10320', 적용시작일: '2026-07-01' },
      { employee_id: 'EXEC-01', 급여형태: '월급', '월 기본급': '3000000', 적용시작일: '2026-07-01' },
    ],
    attendanceRows: [
      { employee_id: 'WORKER-01', source_key: 'WORKER-ATTENDANCE', 근무일: '2026-07-01', 예정시간: '3' },
    ],
    mappings: [
      { source_system: 'payroll_sheet', source_employee_key: 'WORKER-01', employee_uuid: workerUuid, status: 'active' },
      { source_system: 'payroll_sheet', source_employee_key: 'EXEC-01', employee_uuid: executiveUuid, status: 'active' },
    ],
  });

  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.lanes.attendanceHourlyWorkers.employeeLinks.length, 1);
  assert.equal(result.lanes.attendanceHourlyWorkers.employmentTerms.length, 1);
  assert.equal(result.lanes.attendanceHourlyWorkers.calculationAttendance.length, 1);
  assert.equal(result.lanes.executiveFixedMonthly.employeeLinks.length, 1);
  assert.equal(result.lanes.executiveFixedMonthly.employmentTerms.length, 1);
  assert.equal(result.lanes.executiveFixedMonthly.employmentTerms[0].payType, 'monthly');
  assert.equal(result.lanes.executiveFixedMonthly.employmentTerms[0].payrollLane, 'executive_fixed_monthly');
  assert.deepEqual(result.lanes.executiveFixedMonthly.attendanceEvidence, []);
  assert.equal(result.blockers.some((item) => /mapping_missing|unmatched/.test(item.code)), false);
});

test('an executive with an hourly term fails closed instead of entering the attendance lane', () => {
  const result = adapter.buildShadowPayrollDtos({
    employeeRows: [{ employee_id: 'EXEC-01', 구분: '임원' }],
    termRows: [{ employee_id: 'EXEC-01', 급여형태: '시급', 시급: '10320', 적용시작일: '2026-07-01' }],
    mappings: [{ source_system: 'payroll_sheet', source_employee_key: 'EXEC-01', employee_uuid: executiveUuid, status: 'active' }],
  });

  assert.equal(result.ready, false);
  assert.equal(result.blockers[0].code, 'executive_fixed_monthly_pay_type_required');
});
