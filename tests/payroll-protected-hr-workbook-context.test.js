const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20260918065045_payroll_protected_hr_workbook_context.sql'), 'utf8');

test('protected HR profile is one-to-one, RLS-protected, and excludes prohibited detail', () => {
  const tableSql = sql.slice(sql.indexOf('create table public.payroll_protected_hr_profiles'), sql.indexOf('alter table public.payroll_protected_hr_profiles'));
  assert.match(sql, /employee_uuid uuid primary key references public\.employees/i);
  assert.match(sql, /alter table public\.payroll_protected_hr_profiles enable row level security/i);
  assert.match(sql, /revoke all on public\.payroll_protected_hr_profiles from public, anon, authenticated/i);
  assert.doesNotMatch(tableSql, /resident_registration|bank_(?:account|number)|diagnosis|medical/i);
});

test('workbook context is payroll-operator-only and fails closed without exactly one HR record', () => {
  assert.match(sql, /private_require_payroll_operator\(\)/i);
  assert.match(sql, /profile_count <> employee_count/i);
  assert.match(sql, /PAYROLL_CONFIRMED_ATTENDANCE_PROTECTED_HR_MISSING/i);
  assert.match(sql, /revoke all on function public\.get_payroll_confirmed_attendance_workbook_context/i);
  assert.match(sql, /grant execute on function public\.get_payroll_confirmed_attendance_workbook_context\(date\) to authenticated/i);
  assert.match(sql, /payroll_confirmed_attendance_workbook_context_read/i);
});
