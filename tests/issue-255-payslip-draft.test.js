const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260919074804_issue_255_payslip_draft.sql'), 'utf8');
const page = fs.readFileSync(path.join(root, 'app/payroll/payslip.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'app/assets/payroll-payslip-draft.js'), 'utf8');

test('payslip draft is an operator-guarded read model from persisted payroll employee results', () => {
  assert.match(migration, /get_payroll_employee_payslip_draft/i);
  assert.match(migration, /private_payroll_operator_allowed/i);
  assert.match(migration, /payroll_employee_results/i);
  assert.match(migration, /PAYROLL_DRAFT_RUN_REQUIRED/i);
  assert.match(migration, /revoke all on function public\.get_payroll_employee_payslip_draft/i);
  assert.match(migration, /grant execute on function public\.get_payroll_employee_payslip_draft\(date, uuid\) to authenticated/i);
});

test('payslip draft shows only current calculated previews and does not add payment actions', () => {
  assert.match(migration, /gross_pay_preview/i);
  assert.match(migration, /statutory_deduction_preview/i);
  assert.match(migration, /net_pay_preview/i);
  assert.match(migration, /재계산·발송·지급·송금·세금 또는 보험 신고를 수행하지 않습니다/i);
  assert.doesNotMatch(migration, /insert into public\.payroll_employee_results/i);
  assert.doesNotMatch(script, /payroll-calculate|private_persist_payroll_calculation|payment|remittance/i);
});

test('operator payroll ledger links to a read-only per-employee draft page', () => {
  assert.match(page, /개인 급여명세서 초안/i);
  assert.match(page, /noindex,nofollow/i);
  assert.match(script, /get_payroll_employee_payslip_draft/i);
  assert.match(script, /재계산·발송·지급을 실행하지 않습니다/i);
});
