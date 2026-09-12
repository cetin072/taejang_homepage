const test = require('node:test');
const assert = require('node:assert/strict');

const ux = require('../app/assets/payroll-attendance-operator-ux.js');

test('clock-only entry infers normal work only when both clock values exist', () => {
  assert.equal(ux.inferAttendanceStatus('09:01', '12:03'), 'work');
  assert.equal(ux.inferAttendanceStatus('09:01', ''), 'review_required');
  assert.equal(ux.inferAttendanceStatus('', '12:03'), 'review_required');
  assert.equal(ux.inferAttendanceStatus('', ''), null);
});

test('clock-only entry trims values before status inference', () => {
  assert.equal(ux.inferAttendanceStatus(' 09:01 ', ' 12:03 '), 'work');
  assert.equal(ux.inferAttendanceStatus('   ', '12:03'), 'review_required');
});
