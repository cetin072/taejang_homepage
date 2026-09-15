const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '../scripts/staging/verify-payroll-july-executive-lanes-db-owner.mjs'), 'utf8');

test('July executive-lane Staging verifier is aggregate-only and read-only', () => {
  assert.match(script, /read_only:\s*true/);
  assert.match(script, /PAYROLL_JULY_EXECUTIVE_EMPLOYEE_UUIDS/);
  assert.match(script, /exactly two distinct canonical UUIDs/);
  assert.match(script, /july_canonical_executives/);
  assert.match(script, /pay_type = 'monthly'/);
  assert.match(script, /monthly_salary > 0/);
  assert.match(script, /join public\.payroll_employment_terms t on t\.employee_uuid = e\.id/);
  assert.match(script, /payroll_source_identity_mappings/);
  assert.match(script, /canonical_executive_employee_ids: '2'/);
  assert.match(script, /july_executive_full_monthly_terms: '2'/);
  assert.match(script, /active_payroll_source_mappings: '2'/);
  assert.match(script, /attendance_hourly_workers: '21'/);
  assert.match(script, /console\.log\('July lane verification passed: 21 attendance-driven workers plus 2 canonical executive fixed-monthly payroll subjects; no identifiers or amounts were printed\.'/);
  assert.match(script, /Aggregate counts only; no identifiers or amounts were returned/);
  assert.doesNotMatch(script, /console\.log\([^\n]*(employee_uuid|monthly_salary)/i);
});
