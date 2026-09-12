const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ux = require('../app/assets/payroll-attendance-operator-ux.js');
const editorSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'payroll-attendance-editor.js'), 'utf8');

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

test('attendance save success is never reported as save failure when recalculation fails later', () => {
  assert.doesNotMatch(editorSource, /근태 저장\/계산 실패/);
  assert.match(editorSource, /근태 저장 실패:/);
  assert.match(editorSource, /근태 \$\{savedCount\}건은 저장되었습니다\. 급여 가안 재계산에 실패했습니다:/);
  assert.match(editorSource, /새로고침 후 다시 확인해 주세요/);
});
