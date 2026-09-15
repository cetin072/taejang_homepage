const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20260912100000_payroll_operator_effective_attendance.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');

const appliedLedgerMigration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260912023000_payroll_operator_ledger_detail.sql'),
  'utf8'
);

test('effective attendance fix is additive and leaves the already-applied ledger migration intact', () => {
  assert.match(sql, /Do not edit that applied migration/i);
  assert.match(sql, /create or replace function public\.get_payroll_operator_month_context\(p_payroll_month date\)/i);
  assert.match(appliedLedgerMigration, /from public\.payroll_attendance_rows ar/i);
});

test('latest manual attendance shadows the same employee-day imported row', () => {
  assert.match(sql, /latest_manual as \(/i);
  assert.match(sql, /distinct on \(m\.employee_uuid, m\.work_date\)/i);
  assert.match(sql, /order by m\.employee_uuid, m\.work_date, m\.created_at desc, m\.id desc/i);
  assert.match(
    sql,
    /where not exists \([\s\S]*from latest_manual m[\s\S]*m\.employee_uuid = r\.employee_uuid[\s\S]*m\.work_date = r\.work_date[\s\S]*\)/i
  );
});

test('manual attendance status maps to the same effective decisions used by calculation input', () => {
  assert.match(sql, /m\.attendance_status = 'work' and m\.confirmed_hours is not null then 'confirmed_correction'/i);
  assert.match(sql, /m\.attendance_status = 'work' then 'actual_scheduled'/i);
  assert.match(sql, /m\.attendance_status = 'paid_leave' then 'paid_leave'/i);
  assert.match(sql, /m\.attendance_status = 'unpaid_absence' then 'unpaid_absence'/i);
  assert.match(sql, /m\.attendance_status = 'paid_holiday' then 'paid_holiday'/i);
  assert.match(sql, /m\.attendance_status = 'off' then 'out_of_scope'/i);
});

test('ledger day hours use confirmed edits first and effective-dated scheduled hours otherwise', () => {
  assert.match(sql, /when c\.attendance_row_id is not null then c\.new_confirmed_hours/i);
  assert.match(sql, /when m\.attendance_status = 'work' and m\.confirmed_hours is not null then m\.confirmed_hours/i);
  assert.match(sql, /m\.attendance_status in \('work', 'paid_leave', 'paid_holiday'\)/i);
  assert.match(sql, /from public\.payroll_employment_terms t/i);
  assert.match(sql, /t\.effective_from <= m\.work_date/i);
  assert.match(sql, /t\.effective_to is null or t\.effective_to >= m\.work_date/i);
  assert.match(sql, /when m\.attendance_status = 'unpaid_absence' then 0/i);
});

test('confirmed correction remains above imported evidence when no manual edit exists', () => {
  assert.match(sql, /latest_corrections as \(/i);
  assert.match(sql, /c\.status = 'confirmed'/i);
  assert.match(sql, /order by c\.attendance_row_id, c\.created_at desc, c\.id desc/i);
  assert.match(sql, /when c\.attendance_row_id is not null then 'confirmed_correction'/i);
});

test('operator ledger reads only the private effective-attendance projection and keeps access gates', () => {
  assert.match(
    sql,
    /left join lateral public\.private_payroll_operator_effective_attendance_summary\([\s\S]*e\.id,[\s\S]*p_payroll_month[\s\S]*\) att on true/i
  );
  assert.match(
    sql,
    /revoke all on function public\.private_payroll_operator_effective_attendance_summary\(uuid,date\)[\s\S]*from public, anon, authenticated/i
  );
  assert.match(
    sql,
    /revoke all on function public\.get_payroll_operator_month_context\(date\) from public, anon, authenticated/i
  );
  assert.match(sql, /grant execute on function public\.get_payroll_operator_month_context\(date\) to authenticated/i);
  assert.doesNotMatch(sql, /resident_registration|bank_account|disability|livelihood|dependent_count/i);
});
