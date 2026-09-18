'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Employee App is the documented primary attendance target while vendor import remains a fallback', () => {
  const plan = read('docs/planning/PAYROLL_ATTENDANCE_AUTOMATION_V1.md');
  assert.match(plan, /Employee App 출퇴근 event를 Primary source/);
  assert.match(plan, /employee_app \| vendor_fingerprint \| manual_evidence/);
  assert.match(plan, /`vendor_fingerprint`:[\s\S]*importer를 삭제하지 않는다/);
  assert.match(plan, /source-neutral `confirmed attendance`와 `payroll effective attendance`만 사용/);
});

test('existing Employee App attendance keeps its server-authoritative raw-event safety contract', () => {
  const worker = read('app/assets/employee-common-home-v1.js');
  const policy = read('docs/planning/ATTENDANCE_INTEGRITY_POLICY_V1.md');
  const migration = read('supabase/migrations/20260903234500_worker_mobile_attendance_v1.sql');

  assert.match(worker, /record_attendance_event/);
  assert.match(worker, /TaejangAttendanceLocation\.getBestPosition/);
  assert.match(worker, /loadAttendance\(\)/);
  assert.match(worker, /loadNotices\(\)/);
  assert.match(policy, /서버 시각을 사용/);
  assert.match(policy, /GPS 60m geofence/);
  assert.match(policy, /attendance_events`를 UPDATE\/DELETE하지 않는다/);
  assert.match(migration, /unique \(profile_id, work_date, event_type\)/i);
});

test('payroll is explicitly tracked as awaiting the Employee App event adapter, not silently coupled to vendor import', () => {
  const plan = read('docs/planning/PAYROLL_ATTENDANCE_AUTOMATION_V1.md');
  const builder = read('supabase/migrations/20260912043000_payroll_manual_attendance_editor.sql');

  assert.match(plan, /Employee App event → confirmed\/effective attendance → payroll draft \| 미구현/);
  assert.match(builder, /payroll_attendance_rows/);
  assert.doesNotMatch(builder, /from public\.attendance_events/);
});
