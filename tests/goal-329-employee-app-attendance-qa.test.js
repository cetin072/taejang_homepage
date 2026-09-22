'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const migration = read('supabase/migrations/20260922010000_goal_329_employee_app_attendance_qa.sql');
const registry = read('mobile/src/features/common/employee-feature-registry.ts');
const home = read('mobile/app/index.tsx');
const api = read('mobile/src/features/attendance/attendance-api.ts');
const card = read('mobile/src/features/attendance/attendance-card.tsx');

function functionBlock(source, name, nextName = null) {
  const start = source.indexOf(`create or replace function public.${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = nextName
    ? source.indexOf(`create or replace function public.${nextName}`, start + 1)
    : source.indexOf('\ncommit;', start + 1);
  assert.ok(end > start, `${name} must have a bounded definition`);
  return source.slice(start, end);
}

test('Goal 329 makes Employee.attendance_required the attendance subject source of truth', () => {
  const block = functionBlock(migration, 'private_employee_is_attendance_subject', 'private_validate_attendance_attempt');
  assert.match(block, /e\.attendance_required/);
  assert.match(block, /e\.archived_at is null/);
  assert.match(block, /e\.employment_status = 'active'/);
  assert.doesNotMatch(block, /ceo|operations_manager|profile_roles|positions/i);

  const correction = functionBlock(migration, 'private_create_attendance_correction_pre148');
  assert.match(correction, /private_employee_is_attendance_subject\(p_employee_uuid\)/);
  assert.doesNotMatch(correction, /coalesce\(position_code|r\.code in \('ceo', 'operations_manager'\)/);
});

test('Goal 329 operations QA uses a dedicated capability and a no-write server validator', () => {
  assert.match(migration, /'attendance\.qa_validate'/);
  assert.match(migration, /operations_manager_auto_grant/);
  const qa = functionBlock(migration, 'qa_validate_attendance_event', 'private_create_attendance_correction_pre148');
  assert.match(qa, /private_actor_can\('attendance\.qa_validate'\)/);
  assert.match(qa, /private_validate_attendance_attempt/);
  assert.match(qa, /'writes_attendance', false/);
  assert.doesNotMatch(qa, /\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b/i);
});

test('Goal 329 real attendance and QA share the same validation helper while only real attendance delegates to the writer', () => {
  const validation = functionBlock(migration, 'private_validate_attendance_attempt', 'record_attendance_event');
  assert.match(validation, /private_attendance_is_workday/);
  assert.match(validation, /private_attendance_distance_m/);
  assert.match(validation, /LOCATION_UNCERTAIN/);
  assert.match(validation, /OUTSIDE_GEOFENCE/);
  assert.match(validation, /CLOCK_IN_REQUIRED/);

  const real = functionBlock(migration, 'record_attendance_event', 'qa_validate_attendance_event');
  assert.match(real, /private_attendance_employee_uuid_for_profile/);
  assert.match(real, /private_validate_attendance_attempt/);
  assert.match(real, /private_record_attendance_event_pre149/);
});

test('Goal 329 employee app home is driven by one shared feature registry', () => {
  for (const key of ['attendance.clock', 'notice.read', 'work-platform.open']) {
    assert.match(registry, new RegExp(key.replace('.', '\\.')));
  }
  assert.match(registry, /attendance\.qa_validate/);
  assert.match(registry, /attendanceMode: qaAttendance \? 'qa' : 'record'/);
  assert.match(home, /resolveEmployeeAppFeatures/);
  assert.match(home, /employeeFeatures\.get\('attendance\.clock'\)/);
  assert.match(home, /employeeFeatures\.get\('notice\.read'\)/);
  assert.match(home, /employeeFeatures\.get\('work-platform\.open'\)/);
  assert.match(home, /disabled=!canOpenWorkPlatform|disabled=\{!canOpenWorkPlatform/);
});

test('Goal 329 operations attendance QA is explicit, reusable, and cannot request a real attendance exception', () => {
  assert.match(api, /qa_validate_attendance_event/);
  assert.match(card, /mode = 'record'/);
  assert.match(card, /검수 모드 · 실제 근태에 반영되지 않음/);
  assert.match(card, /출근했습니다/);
  assert.match(card, /퇴근했습니다/);
  assert.match(card, /validateAttendanceQa/);
  assert.match(card, /const qaMode = mode === 'qa' && today\?\.attendance_required === false/);
  assert.match(card, /result\.writes_attendance !== false/);
  assert.match(card, /!qaMode && exceptionTarget/);
  assert.match(card, /mode === 'qa' && today\?\.attendance_required === false/);
  assert.match(card, /다시 검수/);
});

test('Goal 329 keeps excluded ordinary employees visible but disables real attendance', () => {
  assert.match(card, /today\?\.attendance_required === false/);
  assert.match(card, /근태 기록 제외 대상입니다/);
  assert.match(card, /mode === 'record'/);
});
