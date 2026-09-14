const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const preflight = require('../app/assets/payroll-attendance-vendor-preflight-ux.js');
const liveHtml = fs.readFileSync(path.join(__dirname, '..', 'app', 'payroll', 'live.html'), 'utf8');

test('vendor preflight only intercepts legacy xls files', () => {
  assert.equal(preflight.isLegacyVendorFile({ name: '근태이력_20260914162704.xls' }), true);
  assert.equal(preflight.isLegacyVendorFile({ name: '근태이력_20260914162704.XLS' }), true);
  assert.equal(preflight.isLegacyVendorFile({ name: '근태이력.xlsx' }), false);
  assert.equal(preflight.isLegacyVendorFile(null), false);
});

test('attendance save success detection commits source index only after attendance write succeeds', () => {
  assert.equal(preflight.isAttendanceSaveSuccessMessage('근태 388건은 저장되었습니다. 급여 가안을 다시 계산하는 중…'), true);
  assert.equal(preflight.isAttendanceSaveSuccessMessage('388건 저장 완료 · 급여 가안 재계산 완료'), true);
  assert.equal(preflight.isAttendanceSaveSuccessMessage('근태 저장 실패: 확인 필요'), false);
  assert.equal(preflight.isAttendanceSaveSuccessMessage('Excel 388건 채움'), false);
});

test('identical vendor reupload is explicitly non-mutating', () => {
  const text = preflight.preflightSummary({
    snapshot: { period: { start: '2026-08-03', end: '2026-08-31' } },
    identical: true,
    previousFound: true,
    diff: { added: 0, changed: 0, missing: 0 },
  });
  assert.match(text, /동일 원본 재업로드/);
  assert.match(text, /변경 없음/);
  assert.match(text, /기존 확정 근태 유지/);
});

test('changed re-download summary preserves confirmed attendance instead of deleting it', () => {
  const text = preflight.preflightSummary({
    snapshot: { period: { start: '2026-08-03', end: '2026-08-31' } },
    identical: false,
    previousFound: true,
    diff: { added: 1, changed: 2, missing: 3 },
  });
  assert.equal(preflight.sourceDiffTotal({ added: 1, changed: 2, missing: 3 }), 6);
  assert.match(text, /source change 6건/);
  assert.match(text, /기존 확정 근태는 삭제하지 않음/);
});

test('live payroll page loads the preflight guard after the editor and operator UX', () => {
  const editor = liveHtml.indexOf('payroll-attendance-editor.js');
  const operator = liveHtml.indexOf('payroll-attendance-operator-ux.js');
  const guard = liveHtml.indexOf('payroll-attendance-vendor-preflight-ux.js');
  assert.ok(editor >= 0 && operator > editor && guard > operator);
});
