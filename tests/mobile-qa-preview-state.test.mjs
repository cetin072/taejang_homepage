import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const source = readFileSync(new URL('../mobile/src/features/qa/qa-preview-state.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(output, { exports, require: name => {
  throw new Error(`unexpected runtime dependency ${name}`);
} });
const { buildQaPreviewDay, showQaWorkPlatform, QA_DAY_LABELS } = exports;

test('pinned 2026 Hangul Day is a blocked normal employee holiday fixture, not a live calendar policy', () => {
  const holiday = buildQaPreviewDay('hangul');
  assert.equal(holiday.work_date, '2026-10-09');
  assert.equal(holiday.is_workday, false);
  assert.equal(holiday.day_reason, '한글날');
  assert.equal(holiday.attendance_required, true);
  assert.equal(holiday.holiday_work_assigned, false);
  assert.equal(holiday.clock_in, null);
  assert.equal(holiday.clock_out, null);
  assert.match(QA_DAY_LABELS.hangul, /공휴일/);
});

test('preview normal weekday is explicitly simulated and does not borrow the real executive attendance flag', () => {
  const workday = buildQaPreviewDay('workday');
  assert.equal(workday.work_date, '2026-10-08');
  assert.equal(workday.attendance_required, true);
  assert.equal(workday.is_workday, true);
  assert.equal(workday.clock_in_available, true);
});

test('today uses only server KST calendar outcome, including nonstandard company holidays', () => {
  const today = buildQaPreviewDay('today', { work_date: '2026-11-03', is_workday: false, reason: '회사 지정 휴무' });
  assert.equal(today.work_date, '2026-11-03');
  assert.equal(today.is_workday, false);
  assert.equal(today.day_reason, '회사 지정 휴무');
  assert.equal(today.attendance_required, true);
  assert.throws(() => buildQaPreviewDay('today'), /서버 근무일 달력/);
});

test('QA persona only decides whether the work-platform shortcut is visible', () => {
  assert.equal(showQaWorkPlatform('operations_lead'), true);
  assert.equal(showQaWorkPlatform('employee'), false);
});
