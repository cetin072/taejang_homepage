'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const migration = read('supabase/migrations/20260919143000_issue_251_daily_attendance_confirmation_revisions.sql');
const admin = read('app/assets/attendance-admin.js');

test('daily confirmation adds a capability-gated immutable revision and per-employee snapshot', () => {
  assert.match(migration, /'attendance\.confirm'/);
  assert.match(migration, /r\.code = 'promotion_lead'/);
  assert.match(migration, /attendance_confirmation_revisions/);
  assert.match(migration, /attendance_confirmed_records/);
  assert.match(migration, /snapshot_fingerprint/);
  assert.match(migration, /record_fingerprint/);
  assert.match(migration, /attendance_confirmation_revisions_append_only/);
  assert.match(migration, /attendance_confirmed_records_append_only/);
  assert.match(migration, /private_actor_can\('attendance\.confirm'\)/);
  assert.doesNotMatch(migration, /['"]payroll\.manage['"]/);
});

test('confirmation requires explicit exception resolution and protects a confirmed day from silent corrections', () => {
  assert.match(migration, /attendance_confirmation_exception_resolutions/);
  assert.match(migration, /resolve_attendance_confirmation_exception/);
  assert.match(migration, /CONFIRMATION_BLOCKED/);
  assert.match(migration, /external_identity_unmatched/);
  assert.match(migration, /clock_in_mismatch/);
  assert.match(migration, /DAY_CONFIRMED_REOPEN_REQUIRED/);
  assert.match(migration, /attendance_corrections_confirmed_day_guard/);
  assert.doesNotMatch(migration, /update public\.attendance_events/i);
  assert.doesNotMatch(migration, /delete from public\.attendance_events/i);
});

test('reopen preserves the prior revision and reconfirm creates a new numbered revision', () => {
  assert.match(migration, /attendance_confirmation_reopens/);
  assert.match(migration, /reopen_attendance_confirmation/);
  assert.match(migration, /REOPEN_REASON_REQUIRED/);
  assert.match(migration, /coalesce\(max\(revision_no\), 0\) \+ 1/);
  assert.match(migration, /attendance_confirmation_reopened/);
  assert.match(migration, /attendance_day_confirmed/);
});

test('attendance administration shows exception-first whole-day confirmation and recorded reopen', () => {
  assert.match(admin, /get_attendance_confirmation_status/);
  assert.match(admin, /resolve_attendance_confirmation_exception/);
  assert.match(admin, /confirm_attendance_day/);
  assert.match(admin, /reopen_attendance_confirmation/);
  assert.match(admin, /하루 전체 확정/);
  assert.match(admin, /확정 재개방/);
  assert.match(admin, /attendance\.confirm/);
  assert.doesNotMatch(admin, /payroll\.manage/);
});
