const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const baseSql = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260912024500_payroll_operator_ledger_history_fallback.sql'),
  'utf8'
);
const correctedSql = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260913043500_payroll_corrected_reference_gross_guard.sql'),
  'utf8'
);

test('practical ledger originally falls back to immutable as-paid history', () => {
  assert.match(baseSql, /get_payroll_operator_ledger_context/i);
  assert.match(baseSql, /get_payroll_operator_month_context/i);
  assert.match(baseSql, /record_role='as_paid'/i);
  assert.match(baseSql, /source_kind='payroll_ledger_confirmed'/i);
  assert.match(baseSql, /coalesce\([\s\S]*statutory_deduction_preview[\s\S]*hist\.total_deduction/i);
});

test('latest ledger fallback prefers corrected Golden history over older as-paid history', () => {
  assert.match(correctedSql, /record_role='corrected_reference'/i);
  assert.match(correctedSql, /source_kind='historical_reconciliation'/i);
  assert.match(correctedSql, /record_role='as_paid'/i);
  assert.match(correctedSql, /source_kind='payroll_ledger_confirmed'/i);
  assert.match(
    correctedSql,
    /case[\s\S]*corrected_reference[\s\S]*historical_reconciliation[\s\S]*then 0[\s\S]*else 1/i
  );
  assert.match(correctedSql, /revision_no desc/i);
  assert.match(correctedSql, /deduction_source/i);
  assert.match(correctedSql, /historical_as_paid/i);
});

test('calculated statutory values still win before any historical fallback', () => {
  assert.match(
    correctedSql,
    /when nullif\(emp\.value->>'statutory_deduction_preview',''\) is not null[\s\S]*then nullif\(emp\.value->>'statutory_deduction_preview',''\)::numeric/i
  );
  assert.match(
    correctedSql,
    /when nullif\(emp\.value->>'net_pay_preview',''\) is not null[\s\S]*then nullif\(emp\.value->>'net_pay_preview',''\)::numeric/i
  );
});

test('historical fallback is read-only and does not rewrite calculated results or paid history', () => {
  assert.doesNotMatch(correctedSql, /insert\s+into\s+public\.payroll_/i);
  assert.doesNotMatch(correctedSql, /update\s+public\.payroll_/i);
  assert.doesNotMatch(correctedSql, /delete\s+from\s+public\.payroll_/i);
  assert.doesNotMatch(correctedSql, /create\s+table/i);
});

test('ledger context remains authenticated-only', () => {
  assert.match(correctedSql, /revoke all on function public\.get_payroll_operator_ledger_context\(date\) from public, anon, authenticated/i);
  assert.match(correctedSql, /grant execute on function public\.get_payroll_operator_ledger_context\(date\) to authenticated/i);
});
