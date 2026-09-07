const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('payroll preview loads only isolated payroll assets', () => {
  const html = read('app/payroll/index.html');

  assert.match(html, /payroll-operator\.css/);
  assert.match(html, /payroll-output\.js/);
  assert.match(html, /payroll-operator-workflow\.js/);
  assert.match(html, /payroll-operator-preview\.js/);
  assert.match(html, /익명 UX PREVIEW/);
  assert.match(html, /가져오기/);
  assert.match(html, /예외/);
  assert.match(html, /가안/);
  assert.match(html, /회계/);
  assert.match(html, /확정/);
});

test('operator preview exposes a separate carryover breakdown instead of mixing prior-month adjustments into work hours', () => {
  const html = read('app/payroll/index.html');
  const preview = read('app/assets/payroll-operator-preview.js');

  assert.match(html, /data-payroll-breakdown/);
  assert.match(html, /data-payroll-base-gross/);
  assert.match(html, /data-payroll-carryover/);
  assert.match(html, /data-payroll-adjusted-gross/);
  assert.match(html, /data-payroll-carryover-status/);
  assert.match(html, /전월 조정은 이번 달 근로시간에 섞지 않고 별도 금액으로 반영/);

  assert.match(preview, /incomingCarryoverCount:\s*2/);
  assert.match(preview, /incomingCarryoverStatus:\s*'review_required'/);
  assert.match(preview, /incomingCarryoverStatus:\s*'complete'/);
  assert.match(preview, /전월 조정 반영 필요/);
  assert.match(preview, /반영 후 계산/);
  assert.match(preview, /건 반영 완료/);
});

test('preview demonstrates adjusted gross only after incoming carryover is complete', () => {
  const preview = read('app/assets/payroll-operator-preview.js');

  assert.match(preview, /baseGrossPay:\s*18240000/);
  assert.match(preview, /carryoverAdjustmentAmount:\s*-61920/);
  assert.match(preview, /grossPayPreview:\s*18178080/);
  assert.match(preview, /incomingCarryoverStatus:\s*'complete'/);
});

test('locked preview exposes a read-only final summary instead of another finalization action', () => {
  const html = read('app/payroll/index.html');
  const preview = read('app/assets/payroll-operator-preview.js');
  const workflow = read('app/assets/payroll-operator-workflow.js');

  assert.match(html, /data-payroll-output/);
  assert.match(html, /확정 요약/);
  assert.match(html, /읽기 전용 산출물/);
  assert.match(preview, /id:\s*'locked'/);
  assert.match(preview, /label:\s*'5\. 확정 완료'/);
  assert.match(preview, /buildLockedPayrollOutput/);
  assert.match(preview, /view_locked_output/);
  assert.match(workflow, /label:\s*'확정 요약 보기'/);
});

test('general work-platform entry does not load payroll engine, output or preview assets', () => {
  const appIndex = read('app/index.html');

  assert.doesNotMatch(appIndex, /payroll-engine\.js/);
  assert.doesNotMatch(appIndex, /payroll-output\.js/);
  assert.doesNotMatch(appIndex, /payroll-operator-workflow\.js/);
  assert.doesNotMatch(appIndex, /payroll-operator-preview\.js/);
  assert.doesNotMatch(appIndex, /payroll-operator\.css/);
});

test('anonymous preview does not embed sensitive payroll or HR identifiers', () => {
  const files = [
    read('app/payroll/index.html'),
    read('app/assets/payroll-output.js'),
    read('app/assets/payroll-operator-preview.js'),
    read('app/assets/payroll-operator-workflow.js'),
    read('app/assets/payroll-engine.js'),
  ].join('\n');

  assert.doesNotMatch(files, /\d{6}-\d{7}/);
  assert.doesNotMatch(files, /주민등록번호\s*[:=]\s*["'`]?\d/);
  assert.doesNotMatch(files, /계좌번호\s*[:=]\s*["'`]?\d/);
  assert.doesNotMatch(files, /장애인등록번호\s*[:=]\s*["'`]?\d/);
});
