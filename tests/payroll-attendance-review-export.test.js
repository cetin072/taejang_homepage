'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const exporter = require('../app/assets/payroll-ledger-xlsx.js');

test('attendance review export preserves audit fields without introducing protected HR fields', () => {
  const matrix = exporter.buildAttendanceReviewMatrix([{
    employee_id: 'TJ-TEST-001',
    display_name: 'TEST NAME',
    work_date: '2026-09-01',
    attendance_status: 'manual_evidence_required',
    source_kind: 'xlsx_prefill',
    source_file_name: 'private-source.xls',
    reason: '수기 근거 확인 필요',
  }]);

  assert.deepEqual(matrix.headers.slice(0, 8), ['사번', '성명', '근무일', '상태', '출근', '퇴근', '인정시간', '출처']);
  assert.match(String(matrix.rows[0][3]), /수기 근거 필요/);
  assert.equal(matrix.headers.includes('주민등록번호'), false);
  assert.equal(matrix.headers.includes('장애유형'), false);

  const bytes = exporter.buildAttendanceReviewXlsx(matrix.rows.map((row, index) => ({
    employee_id: row[0], display_name: row[1], work_date: row[2], attendance_status: 'manual_evidence_required', source_kind: row[7], reason: row[11], source_file_name: row[8],
  })), '2026-09');
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
});
