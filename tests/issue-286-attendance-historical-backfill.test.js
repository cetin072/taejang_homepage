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
const historicalBridge = read('supabase/migrations/20260920211500_issue_286_historical_confirmation_bridge.sql');
const rosterStability = read('supabase/migrations/20260920214500_issue_286_reopen_roster_stability.sql');
const historicalDefaultPresent = read('supabase/migrations/20260920223500_issue_286_historical_default_present.sql');
const historicalReadinessOverride = read('supabase/migrations/20260920224500_issue_286_historical_readiness_override.sql');
const dayStatusRpcGrants = read('supabase/migrations/20260920225500_issue_286_day_status_rpc_grants.sql');
const statusConfirmedPayrollInput = read('supabase/migrations/20260920231500_issue_286_status_confirmed_payroll_input.sql');

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

test('historical confirmed dates bypass obsolete live-evidence blockers and reopen keeps prior roster stable', () => {
  assert.match(historicalBridge, /attendance_exception_unresolved/);
  assert.match(historicalBridge, /attendance_historical_rows/);
  assert.match(historicalBridge, /private_payroll_confirmed_attendance_readiness/);
  assert.match(historicalBridge, /attendance_confirmation_reopens/);
  assert.match(rosterStability, /prior_revision_id/);
  assert.match(rosterStability, /confirmation_revision_id=prior_revision_id/);
  assert.match(rosterStability, /roster_source/);
  assert.match(rosterStability, /prior_revision/);
});


test('operator-directed historical blanks become scheduled work without fabricated timestamps', () => {
  assert.match(historicalDefaultPresent, /historical_default_present/);
  assert.match(historicalDefaultPresent, /운영자 지시: 2026-06~08 공란\/누락 근태 출근 처리/);
  assert.match(historicalDefaultPresent, /when h\.id is null then 'actual_scheduled'/);
  assert.match(historicalDefaultPresent, /when h\.attendance_status in \('blank','review_required','work'\) then 'actual_scheduled'/);
  assert.match(historicalDefaultPresent, /when h\.clock_in_at is null then null/);
  assert.match(historicalDefaultPresent, /when h\.clock_out_at is null then null/);
  assert.doesNotMatch(historicalDefaultPresent, /clock_out_at\s*-\s*interval/i);
});

test('historical attendance survives later archive or departure-state changes', () => {
  assert.match(historicalDefaultPresent, /attendance_historical_rows h/);
  assert.match(historicalDefaultPresent, /h\.attendance_status <> 'out_of_scope'/);
  assert.doesNotMatch(historicalDefaultPresent, /e\.archived_at is null/);
  assert.match(historicalDefaultPresent, /e\.hired_on <= p_work_date/);
  assert.match(historicalDefaultPresent, /e\.departed_on is null or e\.departed_on >= p_work_date/);
});

test('historical scheduled-work records do not fail confirmed duration readiness', () => {
  assert.match(historicalDefaultPresent, /confirmed_duration_invalid/);
  assert.match(historicalDefaultPresent, /payroll_decision',''\) = 'actual_scheduled'/);
  assert.match(historicalDefaultPresent, /historical_default_present','false'\) = 'true'/);
});


test('final historical confirmations supersede obsolete raw-evidence readiness blockers', () => {
  assert.match(historicalReadinessOverride, /attendance_exception_unresolved/);
  assert.match(historicalReadinessOverride, /record\.record_snapshot \? 'historical_source'/);
  assert.match(historicalReadinessOverride, /historical_default_present/);
  assert.match(historicalReadinessOverride, /source_fingerprint/);
  assert.match(historicalReadinessOverride, /attendance_confirmation_reopens/);
});


test('attendance day-status RPC is never executable by anon', () => {
  assert.match(dayStatusRpcGrants, /revoke execute on function public\.set_attendance_day_status\(uuid,date,text,text,text\)/);
  assert.match(dayStatusRpcGrants, /from public, anon/);
  assert.match(dayStatusRpcGrants, /to authenticated/);
});


test('semantic day statuses do not masquerade as time-confirmed corrections', () => {
  assert.match(statusConfirmedPayrollInput, /then 'confirmed'/);
  assert.match(statusConfirmedPayrollInput, /else 'status_confirmed'/);
  assert.match(statusConfirmedPayrollInput, /payroll_decision',''\) = 'confirmed_correction'/);
  assert.match(statusConfirmedPayrollInput, /confirmed_hours/);
  assert.match(statusConfirmedPayrollInput, /payroll-db-input-v6-confirmed-status/);
});
