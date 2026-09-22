import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('employee app home resolves one common feature registry for all active accounts', async () => {
  const home = await text('mobile/app/index.tsx');
  const registry = await text('mobile/src/features/common/employee-feature-registry.ts');

  assert.match(home, /resolveEmployeeAppFeatures/);
  assert.match(home, /employeeFeatures\.get\('attendance\.clock'\)/);
  assert.match(home, /employeeFeatures\.get\('notice\.read'\)/);
  assert.match(home, /employeeFeatures\.get\('work-platform\.open'\)/);
  assert.match(home, /disabled=\{!canOpenWorkPlatform \|\| platformOpening\}/);

  assert.match(registry, /attendance\.clock/);
  assert.match(registry, /notice\.read/);
  assert.match(registry, /work-platform\.open/);
  assert.match(registry, /attendance\.qa_validate/);
});

test('operations QA attendance uses the no-write RPC and never exposes exception-request writes', async () => {
  const api = await text('mobile/src/features/attendance/attendance-api.ts');
  const card = await text('mobile/src/features/attendance/attendance-card.tsx');

  assert.match(api, /qa_validate_attendance_event/);
  assert.match(api, /p_has_qa_clock_in/);
  assert.match(card, /validateAttendanceQa/);
  assert.match(card, /검수 모드 · 실제 근태에 반영되지 않음/);
  assert.match(card, /result\.writes_attendance !== false/);
  assert.match(card, /mode === 'record' && exceptionTarget/);
  assert.match(card, /if \(mode === 'qa' \|\|/);
});

test('employee attendance button copy is shared while excluded employees stay disabled', async () => {
  const card = await text('mobile/src/features/attendance/attendance-card.tsx');

  assert.match(card, /title = '출근했습니다'/);
  assert.match(card, /title = '퇴근했습니다'/);
  assert.match(card, /근태 기록 제외 대상입니다/);
  assert.match(card, /다시 검수/);
});
