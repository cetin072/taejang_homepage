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

test('automatic clock inference only changes empty/work/review statuses', () => {
  for (const value of ['', 'work', 'review_required']) {
    assert.equal(ux.shouldAutoUpdateStatus(value), true);
  }
  for (const value of ['paid_leave', 'unpaid_absence', 'paid_holiday', 'off']) {
    assert.equal(ux.shouldAutoUpdateStatus(value), false);
  }
});
