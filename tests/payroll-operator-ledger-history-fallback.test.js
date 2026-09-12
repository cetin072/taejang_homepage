const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20260912024500_payroll_operator_ledger_history_fallback.sql'),
  'utf8'
);

test('practical ledger prefers calculated deductions and only falls back to immutable as-paid history', () => {
  assert.match(sql, /get_payroll_operator_ledger_context/i);
  assert.match(sql, /get_payroll_operator_month_context/i);
  assert.match(sql, /record_role='as_paid'/i);
  assert.match(sql, /source_kind='payroll_ledger_confirmed'/i);
  assert.match(sql, /coalesce\([\s\S]*statutory_deduction_preview[\s\S]*hist\.total_deduction/i);
  assert.match(sql, /deduction_source/i);
  assert.match(sql, /historical_as_paid/i);
});

test('historical fallback is read-only and does not rewrite calculated results or paid history', () => {
  assert.doesNotMatch(sql, /insert\s+into\s+public\.payroll_/i);
  assert.doesNotMatch(sql, /update\s+public\.payroll_/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.payroll_/i);
  assert.doesNotMatch(sql, /create\s+table/i);
});

test('ledger context remains authenticated-only', () => {
  assert.match(sql, /revoke all on function public\.get_payroll_operator_ledger_context\(date\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_payroll_operator_ledger_context\(date\) to authenticated/i);
});
