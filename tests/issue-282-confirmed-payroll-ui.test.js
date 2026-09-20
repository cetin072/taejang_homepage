'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('app/payroll/live.html');
const live = read('app/assets/payroll-operator-live.js');
const editor = read('app/assets/payroll-attendance-editor.js');
const navigation = read('app/assets/role-navigation-priority.js');

test('payroll live makes confirmed-attendance readiness the primary workflow', () => {
  assert.match(html, /id="payroll-confirmed-readiness"/);
  assert.match(html, /급여 계산 준비상태/);
  assert.match(html, /확정 근태로 급여 가안 계산/);
  assert.match(html, /운영팀장이 일일 확정한 근태만 정상 급여 계산 입력으로 사용합니다/);
  assert.match(live, /get_payroll_confirmed_attendance_readiness/);
  assert.match(live, /state\.readiness\?\.ready/);
  assert.match(live, /confirmed-native-/);
});

test('confirmed-native payroll calculation does not require a mutable import batch', () => {
  const calculateBlock = live.match(/async function calculateConfirmedPayroll\(\)[\s\S]*?await loadMonth\(\);\n  }/)?.[0] || '';
  assert.ok(calculateBlock);
  assert.doesNotMatch(calculateBlock, /accepted_import_batch_id/);
  assert.match(calculateBlock, /payroll_month/);
  assert.match(calculateBlock, /cutoff_date/);
  assert.doesNotMatch(editor, /accepted_batch_id|accepted_import_batch_id/);
  assert.doesNotMatch(editor, /async function recalculate\(/);
});

test('manual and Excel attendance are clearly fallback only and no longer auto-recalculate after save', () => {
  assert.match(html, /비상·과거자료 보조입력 열기/);
  assert.match(html, /현재 확정근태 기반 급여 계산의 정상 입력경로가 아닙니다/);
  assert.doesNotMatch(html, /직접 입력이 기본입니다/);
  assert.doesNotMatch(html, /payroll-attendance-recalculate/);
  assert.doesNotMatch(editor, /await recalculate|retryCalculation/);
  assert.match(editor, /보조 근태 \$\{savedCount\}건을 저장했습니다/);
  assert.match(editor, /정상 급여 계산은 상단의 확정 근태 Gate를 사용합니다/);
});

test('production payroll UI does not fall back to a STAGING label', () => {
  assert.doesNotMatch(live, /STAGING · 근태 편집/);
  assert.doesNotMatch(live, /Staging 급여 데이터를/);
  assert.match(live, /업무플랫폼 · 근태·급여/);
  assert.match(live, /급여 데이터를 불러오고 있습니다/);
});

test('external payroll handoff is named explicitly so it is not confused with the normal payroll path', () => {
  assert.match(navigation, /외부 급여초안 상신/);
  assert.match(navigation, /외부 급여초안 검토/);
});
