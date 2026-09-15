const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260911235721_payroll_history_record_roles.sql'),
  'utf8'
);

test('historical payroll facts and corrected references are stored as distinct record roles', () => {
  assert.match(migration, /record_role text not null default 'as_paid'/i);
  assert.match(migration, /as_paid/i);
  assert.match(migration, /external_confirmed/i);
  assert.match(migration, /corrected_reference/i);
  assert.match(migration, /historical_reconciliation/i);
});

test('corrected Golden references require an explicit correction reason', () => {
  assert.match(migration, /corrected_reason_required/i);
  assert.match(migration, /record_role <> 'corrected_reference'/i);
  assert.match(migration, /correction_reason/i);
});

test('revision chain cannot cross employee or payroll-month boundaries', () => {
  assert.match(migration, /supersedes_history_id/i);
  assert.match(migration, /unique \(id, employee_uuid, payroll_month\)/i);
  assert.match(
    migration,
    /foreign key \(supersedes_history_id, employee_uuid, payroll_month\)[\s\S]*references public\.payroll_confirmed_deduction_history\(id, employee_uuid, payroll_month\)/i
  );
});

test('historical facts are not forced into one row per month/source anymore', () => {
  assert.match(migration, /drop constraint if exists payroll_confirmed_deduction_h_payroll_month_employee_uuid_s_key/i);
  assert.match(migration, /revision_no integer not null default 1/i);
  assert.match(migration, /unique \(payroll_month, employee_uuid, source_kind, record_role, revision_no\)/i);
});
