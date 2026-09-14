const test = require('node:test');
const assert = require('node:assert/strict');

const analyzer = require('../app/assets/payroll-attendance-xlsx.js');

test('attendance analyzer finds common Korean security-vendor headers', () => {
  const result = analyzer.analyzeMatrix([
    ['근태현황'],
    ['사번', '성명', '근무일자', '출근시간', '퇴근시간'],
    ['A001', '홍길동', '2026-09-01', '08:59', '12:01'],
    ['A002', '김태장', '2026.09.01', '오전 9:01', '오후 1:00'],
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.headerRow, 2);
  assert.deepEqual(result.mapping, { employeeId: 0, name: 1, date: 2, clockIn: 3, clockOut: 4 });
  assert.equal(result.rowCount, 2);
  assert.equal(result.validCount, 2);
  assert.equal(result.invalidCount, 0);
});

test('attendance analyzer accepts name when employee number is absent', () => {
  const result = analyzer.analyzeMatrix([
    ['이름', '날짜', '입실시각', '퇴실시각'],
    ['홍길동', '2026/09/02', '09:00', '12:00'],
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.mapping.employeeId, undefined);
  assert.equal(result.mapping.name, 0);
  assert.equal(result.validCount, 1);
});

test('attendance analyzer flags bad dates, missing times and exact duplicate rows', () => {
  const result = analyzer.analyzeMatrix([
    ['성명', '일자', '출근', '퇴근'],
    ['홍길동', '2026-09-03', '09:00', '12:00'],
    ['홍길동', '2026-09-03', '09:00', '12:00'],
    ['김태장', '잘못된날짜', '', ''],
  ]);
  assert.equal(result.rowCount, 3);
  assert.equal(result.validCount, 1);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.invalidCount, 2);
  assert.ok(result.issueRows.some(row => row.issues.includes('duplicate_row')));
  assert.ok(result.issueRows.some(row => row.issues.includes('date_invalid')));
  assert.ok(result.issueRows.some(row => row.issues.includes('time_missing')));
});

test('attendance analyzer normalizes Excel serial dates and fractional times', () => {
  assert.equal(analyzer.normalizeDateCell(46266), '2026-09-01');
  assert.equal(analyzer.normalizeTimeCell(0.375), '09:00');
  assert.equal(analyzer.normalizeTimeCell('오후 1:05'), '13:05');
});

test('attendance analyzer refuses weak tables without identity/date/time headers', () => {
  const result = analyzer.analyzeMatrix([
    ['부서', '비고', '상태'],
    ['영업', '정상', '재직'],
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'attendance_header_not_detected');
});
