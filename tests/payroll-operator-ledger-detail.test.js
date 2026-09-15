const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20260912023000_payroll_operator_ledger_detail.sql'),
  'utf8'
);

test('operator ledger detail enriches the existing month context instead of creating another payroll store', () => {
  assert.match(sql, /create or replace function public\.get_payroll_operator_month_context\(p_payroll_month date\)/i);
  assert.doesNotMatch(sql, /create\s+table/i);
  assert.match(sql, /absence_day_count/i);
  assert.match(sql, /paid_leave_day_count/i);
  assert.match(sql, /paid_holiday_day_count/i);
  assert.match(sql, /attendance_days/i);
});

test('ledger attendance detail only reads accepted source evidence in the selected calendar month', () => {
  assert.match(sql, /payroll_attendance_import_batches/i);
  assert.match(sql, /b\.status='accepted'/i);
  assert.match(sql, /ar\.work_date>=p_payroll_month/i);
  assert.match(sql, /ar\.work_date<\(p_payroll_month \+ interval '1 month'\)::date/i);
  assert.doesNotMatch(sql, /expected_scheduled.*jsonb_build_object/is);
});

test('operator ledger RPC remains authenticated-only and does not add sensitive HR fields', () => {
  assert.match(sql, /revoke all on function public\.get_payroll_operator_month_context\(date\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_payroll_operator_month_context\(date\) to authenticated/i);
  assert.doesNotMatch(sql, /resident_registration|bank_account|disability|livelihood|dependent_count/i);
});
