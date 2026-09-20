'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const migration = read('supabase/migrations/20260919123500_issue_249_attendance_lead_correction_policy.sql');
const ui = read('app/assets/attendance-integrity-ui.js');
const wrappers = read('supabase/migrations/20260910080000_issue_148_attendance_capability_wrappers.sql');

test('promotion lead receives existing attendance.correct capability without bypassing wrapper authorization', () => {
  assert.match(migration, /r\.code = 'promotion_lead'/);
  assert.match(migration, /'attendance\.correct'/);
  assert.match(wrappers, /private_actor_can\('attendance\.correct'\)/);
  assert.doesNotMatch(migration, /current_user_has_role\('operations_manager'\)/);
});

test('missing effective time can be manually backfilled without an operator-entered reason', () => {
  assert.match(migration, /missing_effective_time := current_value is null or current_value ->> 'event_at' is null/);
  assert.match(migration, /'누락 근태 수기 입력'/);
  assert.match(migration, /'manual_backfill'/);
  assert.match(ui, /isMissingBackfill = isSetTime && !currentRecord\?\.event_at/);
  assert.match(ui, /p_reason: input\.reason/);
});

test('existing-time correction and invalidation still require a reason', () => {
  assert.match(migration, /return jsonb_build_object\('ok', false, 'code', 'REASON_REQUIRED'\)/);
  assert.match(ui, /시간 변경 사유 \(5자 이상\)/);
  assert.match(ui, /무효 처리 사유 \(5자 이상\)/);
  assert.match(ui, /기존 기록을 변경하거나 무효화할 때는 사유를 5자 이상 입력해야 합니다/);
});

test('correction stays append-only and preserves evidence provenance', () => {
  assert.match(migration, /insert into public\.attendance_corrections/);
  assert.match(migration, /target_event_id/);
  assert.match(migration, /attendance_correction_created/);
  assert.match(migration, /entry_mode/);
  assert.doesNotMatch(migration, /update public\.attendance_events/i);
  assert.doesNotMatch(migration, /delete from public\.attendance_events/i);
});
