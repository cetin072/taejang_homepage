'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const correction = read('app/assets/attendance-integrity-ui.js');
const attendance = read('app/assets/attendance-admin.js');
const migration = read('supabase/migrations/20260920203000_issue_286_confirmed_status_historical_backfill.sql');

test('time picker regex accepts real HH:MM values and rejects malformed values', () => {
  const literal = correction.match(/const TIME_VALUE_PATTERN = (\/\^.*?\$\/);/)?.[1];
  assert.ok(literal, 'TIME_VALUE_PATTERN regex literal should be present');
  const pattern = Function(`return ${literal}`)();
  assert.equal(pattern.test('09:00'), true);
  assert.equal(pattern.test('18:59'), true);
  assert.equal(pattern.test('23:59'), true);
  assert.equal(pattern.test('24:00'), false);
  assert.equal(pattern.test('09:60'), false);
  assert.equal(pattern.test('09\\:00'), false);
});

test('attendance admin exposes explicit day status editing with reopen protection', () => {
  assert.match(attendance, /set_attendance_day_status/);
  assert.match(attendance, /유급휴가·월차/);
  assert.match(attendance, /무급 결근/);
  assert.match(attendance, /유급공휴일/);
  assert.match(attendance, /확정 재개방/);
  assert.match(attendance, /DAY_CONFIRMED_REOPEN_REQUIRED/);
});

test('historical attendance contract is immutable, date-aware, and status-aware', () => {
  assert.match(migration, /create table public\.attendance_historical_import_batches/);
  assert.match(migration, /create table public\.attendance_historical_rows/);
  assert.match(migration, /create table public\.attendance_day_status_changes/);
  assert.match(migration, /private_employee_is_attendance_subject_on/);
  assert.match(migration, /source_fingerprint text not null unique/);
  assert.match(migration, /attendance_status in \('work','paid_leave','unpaid_absence','paid_holiday'/);
  assert.match(migration, /source_count<>1 or usable_count<>1/);
  assert.match(migration, /'reason','source_incomplete'/);
  assert.match(migration, /historical_attendance_backfilled/);
  assert.match(migration, /payroll_decision/);
  assert.match(migration, /when 'paid_leave' then 'paid_leave'/);
  assert.match(migration, /when 'unpaid_absence' then 'unpaid_absence'/);
  assert.match(migration, /when 'paid_holiday' then 'paid_holiday'/);
});

test('new private historical/status helpers are not browser-executable', () => {
  assert.match(migration, /revoke all on function public\.private_attendance_effective_status\(uuid,date\) from public,anon,authenticated/);
  assert.match(migration, /revoke all on function public\.private_attendance_effective_event\(uuid,date,text\) from public,anon,authenticated/);
  assert.match(migration, /revoke all on function public\.private_build_payroll_calculation_input\(date,date,uuid\) from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.private_backfill_historical_attendance_batch\(uuid\) to service_role/);
});
