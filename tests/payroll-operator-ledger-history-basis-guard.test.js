const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20260913043500_payroll_corrected_reference_gross_guard.sql'),
  'utf8'
);

test('historical deduction fallback requires current and selected historical gross to match', () => {
  assert.match(sql, /fallback_eligible/i);
  assert.match(sql, /round\(nullif\(emp\.value->>'gross_pay_preview',''\)::numeric\)\s*=\s*round\(h\.gross_pay\)/i);
  assert.match(sql, /when hist\.fallback_eligible then hist\.total_deduction\s+else null\s+end/i);
  assert.match(sql, /when hist\.fallback_eligible then hist\.net_pay\s+else null\s+end/i);
});

test('corrected Golden history is selected before older as-paid history', () => {
  assert.match(sql, /record_role='corrected_reference'/i);
  assert.match(sql, /source_kind='historical_reconciliation'/i);
  assert.match(sql, /record_role='as_paid'/i);
  assert.match(sql, /source_kind='payroll_ledger_confirmed'/i);
  assert.match(sql, /then 0[\s\S]*else 1/i);
});

test('gross mismatch fails closed instead of mixing current gross with historical deductions', () => {
  assert.match(sql, /when hist\.id is not null then 'review_required'/i);
  assert.match(sql, /when hist\.id is not null then 'historical_gross_mismatch'/i);
});

test('gross-basis guard remains read-only and authenticated-only', () => {
  assert.doesNotMatch(sql, /insert\s+into\s+public\.payroll_/i);
  assert.doesNotMatch(sql, /update\s+public\.payroll_/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.payroll_/i);
  assert.match(sql, /revoke all on function public\.get_payroll_operator_ledger_context\(date\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_payroll_operator_ledger_context\(date\) to authenticated/i);
});
