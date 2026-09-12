const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20260912040000_payroll_history_fallback_gross_guard.sql'),
  'utf8'
);

test('historical deduction fallback requires current and historical gross to match', () => {
  assert.match(sql, /fallback_eligible/i);
  assert.match(sql, /round\(nullif\(emp\.value->>'gross_pay_preview',''\)::numeric\)\s*=\s*round\(h\.gross_pay\)/i);
  assert.match(sql, /when hist\.fallback_eligible then hist\.total_deduction/i);
  assert.match(sql, /when hist\.fallback_eligible then hist\.net_pay/i);
});

test('gross mismatch fails closed instead of mixing current gross with historical deductions', () => {
  assert.match(sql, /when hist\.id is not null then 'review_required'/i);
  assert.match(sql, /historical_gross_mismatch/i);
  assert.doesNotMatch(sql, /coalesce\([\s\S]*statutory_deduction_preview[\s\S]*hist\.total_deduction/i);
});

test('gross-basis guard remains read-only and authenticated-only', () => {
  assert.doesNotMatch(sql, /insert\s+into\s+public\.payroll_/i);
  assert.doesNotMatch(sql, /update\s+public\.payroll_/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.payroll_/i);
  assert.match(sql, /revoke all on function public\.get_payroll_operator_ledger_context\(date\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_payroll_operator_ledger_context\(date\) to authenticated/i);
});
