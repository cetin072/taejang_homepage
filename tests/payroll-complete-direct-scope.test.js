const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20260913134500_payroll_complete_direct_scope.sql'),
  'utf8'
);

test('direct-entry calculation scope includes canonical attendance workers with payroll terms', () => {
  assert.match(sql, /e\.attendance_required\s*=\s*true/i);
  assert.match(sql, /from public\.payroll_employment_terms t[\s\S]*t\.employee_uuid\s*=\s*e\.id/i);
  assert.match(sql, /t\.effective_from\s*<=\s*month_end/i);
  assert.match(sql, /t\.effective_to is null or t\.effective_to\s*>=\s*month_start/i);
  assert.match(sql, /payroll-db-input-v4-canonical-term-scope/i);
});

test('employee scope does not require a prior manual attendance row or vendor mapping', () => {
  const employeeScope = sql.slice(sql.indexOf('into extra_employees'), sql.indexOf('into extra_terms'));
  assert.doesNotMatch(employeeScope, /payroll_attendance_manual_entries/i);
  assert.doesNotMatch(employeeScope, /payroll_source_identity_mappings/i);
});

test('scope migration changes only calculation input and has no payroll close or payment side effects', () => {
  const executableSql = sql
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(executableSql, /update\s+public\.payroll_months|insert\s+into\s+public\.payroll_months|locked_at|bank_transfer|kakao|payment_execute/i);
});
