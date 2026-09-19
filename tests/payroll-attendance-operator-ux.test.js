const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ux = require('../app/assets/payroll-attendance-operator-ux.js');
const editorSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'payroll-attendance-editor.js'), 'utf8');
const uxSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'payroll-attendance-operator-ux.js'), 'utf8');

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

test('operator queue classifies normal, missing-source, partial and already-resolved attendance', () => {
  assert.equal(ux.classifyOperatorRow('work', '09:01', '12:03'), 'normal');
  assert.equal(ux.classifyOperatorRow('', '', ''), 'no_source');
  assert.equal(ux.classifyOperatorRow('review_required', '09:01', ''), 'exception');
  assert.equal(ux.classifyOperatorRow('paid_leave', '', ''), 'resolved');
  assert.equal(ux.classifyOperatorRow('termination', '', ''), 'resolved');
  assert.equal(ux.classifyOperatorRow('out_of_scope', '', ''), 'resolved');
  assert.equal(ux.classifyOperatorRow('manual_evidence_required', '', ''), 'resolved');
  assert.equal(ux.classifyOperatorRow('work', '09:01', ''), 'exception');
  assert.equal(
    ux.queueSummaryText({ normal: 19, exception: 2, no_source: 2, resolved: 0 }),
    '정상 자동대조 19명 · 확인 필요 4명 · 지문기록 없음 2명'
  );
});

test('legacy xls is selectable directly and is not diverted to conversion guidance', () => {
  assert.equal(ux.isLegacyXlsFileName('출근부.xls'), true);
  assert.equal(ux.isLegacyXlsFileName('출근부.XLS'), true);
  assert.equal(ux.isLegacyXlsFileName('출근부.xlsx'), false);
  assert.match(uxSource, /accept', '\.xlsx,\.xls'/);
  assert.doesNotMatch(uxSource, /Excel에서 \.xlsx로 저장한 뒤 다시 선택해 주세요/);
  assert.match(uxSource, /stopImmediatePropagation/);
});

test('Excel prefill warns before it can overwrite unsaved screen edits', () => {
  assert.equal(ux.dirtyCountFromSummaryText('2026-09-13 · 입력 23명 · 변경 0건'), 0);
  assert.equal(ux.dirtyCountFromSummaryText('2026-09-13 · 입력 23명 · 변경 4건'), 4);
  assert.match(uxSource, /Excel 자동채움은 같은 직원·날짜 값을 바꿀 수 있습니다/);
  assert.match(uxSource, /현재 변경사항을 먼저 저장해 주세요/);
});

test('vendor xls summary exposes content period, exceptions and re-download changes', () => {
  const text = ux.vendorImportSummaryText({
    snapshot: { period: { start: '2026-08-03', end: '2026-08-31' }, rows: new Array(388).fill({}) },
    reconciliation: { exceptionCounts: { clock_in_missing: 3, clock_out_missing: 4, no_fingerprint_record: 0 } },
    sourceIndexPersistence: { diff: { added: 1, changed: 2, missing: 3 } },
  });
  assert.match(text, /원본 388건/);
  assert.match(text, /실제기간 2026-08-03~2026-08-31/);
  assert.match(text, /출퇴근 한쪽누락 7건/);
  assert.match(text, /재다운로드 변경 6건/);
  assert.match(text, /초단위 원본 보존/);
});

test('exception-focus UX is present without changing server permission semantics', () => {
  assert.match(uxSource, /오늘 근태대조/);
  assert.match(uxSource, /예외만 보기/);
  assert.match(uxSource, /data-payroll-exception-summary/);
  assert.match(uxSource, /selectedDateWithinImportedPeriod/);
  assert.doesNotMatch(uxSource, /payroll\.manage|operations_manager|service_role/);
});

test('attendance save success is never reported as save failure when recalculation fails later', () => {
  assert.doesNotMatch(editorSource, /근태 저장\/계산 실패/);
  assert.match(editorSource, /근태 저장 실패:/);
  assert.match(editorSource, /clearSavedDirty\(entries\);/);
  assert.match(editorSource, /근태 \$\{savedCount\}건은 저장되었습니다\. 급여 가안 재계산에 실패했습니다:/);
  assert.match(editorSource, /급여 가안 다시 계산/);
});

test('saved attendance can retry payroll calculation without writing attendance again', () => {
  assert.match(editorSource, /async function retryCalculation\(\)/);
  assert.match(editorSource, /저장하지 않은 근태 변경 \$\{state\.dirty\.size\}건이 있습니다/);
  assert.match(editorSource, /await recalculate\(state\.context\)/);
  assert.match(editorSource, /저장된 근태는 그대로 유지됩니다/);
  assert.match(editorSource, /payroll-attendance-recalculate/);
  assert.match(editorSource, /setEditorBusy\(true\)/);
  assert.match(editorSource, /setEditorBusy\(false\)/);
});
