'use strict';
const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path'); const test=require('node:test');
const sql=fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20260919145000_issue_253_confirmed_payroll_attendance_snapshot.sql'),'utf8');
test('native payroll input is gated by immutable confirmed attendance instead of changing formulas',()=>{
  assert.match(sql,/private_payroll_confirmed_attendance_readiness/); assert.match(sql,/PAYROLL_CONFIRMED_ATTENDANCE_REQUIRED/); assert.match(sql,/day_unconfirmed/); assert.match(sql,/attendance_exception_unresolved/); assert.match(sql,/attendance_confirmed_records/); assert.match(sql,/payroll-db-input-v5-confirmed-native/); assert.match(sql,/employee_uuid/); assert.doesNotMatch(sql,/app\/assets\/payroll-engine\.js/);
});
test('persisted payroll calculation records exact snapshot fingerprints and keeps legacy fallback private',()=>{
  assert.match(sql,/payroll_confirmed_attendance_snapshots/); assert.match(sql,/confirmed_attendance_snapshot_id/); assert.match(sql,/confirmed_attendance_fingerprint/); assert.match(sql,/payroll_calculation_runs_confirmed_attendance_snapshot/); assert.match(sql,/payroll_confirmed_attendance_snapshots_append_only/); assert.match(sql,/private_build_payroll_calculation_input_legacy_v4/); assert.match(sql,/revoke all on function public\.private_build_payroll_calculation_input_legacy_v4/);
});
