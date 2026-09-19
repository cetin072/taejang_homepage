'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260919144000_issue_252_confirmed_attendance_ledger.sql');
const admin = read('app/assets/attendance-admin.js');

test('confirmed-attendance period ledger derives from immutable daily revisions without duplicate stores', () => {
  assert.match(migration, /private_confirmed_attendance_ledger_rows/);
  assert.match(migration, /get_confirmed_attendance_period/);
  assert.match(migration, /attendance_confirmed_records/);
  assert.match(migration, /attendance_confirmation_revisions/);
  assert.match(migration, /attendance_confirmation_reopens/);
  assert.match(migration, /record_snapshot/);
  assert.match(migration, /period_fingerprint/);
  assert.match(migration, /p_include_reopened/);
  assert.match(migration, /private_actor_can\('attendance\.admin_view'\)/);
  assert.doesNotMatch(migration, /create table public\.attendance_(weekly|monthly|yearly)/i);
});

test('period query keeps private source inaccessible and validates its bounds', () => {
  assert.match(migration, /revoke all on function public\.private_confirmed_attendance_ledger_rows\(date,date,uuid,boolean\)/);
  assert.match(migration, /grant execute on function public\.get_confirmed_attendance_period\(date,date,uuid,boolean\)\s+to authenticated/);
  assert.match(migration, /INVALID_ATTENDANCE_PERIOD/);
  assert.match(migration, /security definer/);
});

test('attendance administration exposes a period ledger and distinguishes current from reopened revisions', () => {
  assert.match(admin, /get_confirmed_attendance_period/);
  assert.match(admin, /확정 근태 대장/);
  assert.match(admin, /재개방된 이전 revision도 포함/);
  assert.match(admin, /현재 확정본/);
  assert.match(admin, /attendance\.admin_view/);
  assert.doesNotMatch(admin, /payroll\.manage/);
});
