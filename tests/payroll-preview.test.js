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
  assert.match(html, /payroll-operator-workflow\.js/);
  assert.match(html, /payroll-operator-preview\.js/);
  assert.match(html, /익명 UX PREVIEW/);
  assert.match(html, /가져오기/);
  assert.match(html, /예외/);
  assert.match(html, /가안/);
  assert.match(html, /회계/);
  assert.match(html, /확정/);
});

test('general work-platform entry does not load payroll engine or preview assets', () => {
  const appIndex = read('app/index.html');

  assert.doesNotMatch(appIndex, /payroll-engine\.js/);
  assert.doesNotMatch(appIndex, /payroll-operator-workflow\.js/);
  assert.doesNotMatch(appIndex, /payroll-operator-preview\.js/);
  assert.doesNotMatch(appIndex, /payroll-operator\.css/);
});

test('anonymous preview does not embed sensitive payroll or HR identifiers', () => {
  const files = [
    read('app/payroll/index.html'),
    read('app/assets/payroll-operator-preview.js'),
    read('app/assets/payroll-operator-workflow.js'),
    read('app/assets/payroll-engine.js'),
  ].join('\n');

  assert.doesNotMatch(files, /\d{6}-\d{7}/);
  assert.doesNotMatch(files, /주민등록번호\s*[:=]\s*["'`]?\d/);
  assert.doesNotMatch(files, /계좌번호\s*[:=]\s*["'`]?\d/);
  assert.doesNotMatch(files, /장애인등록번호\s*[:=]\s*["'`]?\d/);
});
