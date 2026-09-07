const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'prototypes/payroll-backend/schema.sql'), 'utf8');

test('payroll backend remains a rollback-only prototype, not an applied migration', () => {
  assert.match(sql, /Status: PROTOTYPE ONLY/i);
  assert.match(sql, /begin;/i);
  assert.match(sql, /rollback;/i);
  assert.doesNotMatch(__filename, /supabase[\\/]migrations/);
});

test('payroll backend reuses the existing employee source of truth', () => {
  const employeeReferences = sql.match(/references public\.employees\(id\)/g) || [];
  assert.ok(employeeReferences.length >= 4);
  assert.doesNotMatch(sql, /create table if not exists public\.payroll_employees\b/i);
});

test('payroll persistence contract contains no Sensitive HR identity columns', () => {
  assert.doesNotMatch(sql, /\bfull_name\b/i);
  assert.doesNotMatch(sql, /resident_registration/i);
  assert.doesNotMatch(sql, /disability_(?:type|grade|number|card)/i);
  assert.doesNotMatch(sql, /bank_(?:account|number)/i);
});

test('all payroll tables are fail-closed until a separate access decision is approved', () => {
  const tables = [
    'payroll_employment_terms',
    'payroll_holidays',
    'payroll_months',
    'payroll_calculation_runs',
    'payroll_employee_results',
    'payroll_adjustments',
    'payroll_accounting_comparisons',
    'payroll_accounting_difference_rows',
  ];

  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }

  assert.match(sql, /revoke all on[\s\S]*from public, anon, authenticated;/i);
  assert.doesNotMatch(sql, /create\s+policy/i);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete|all)[\s\S]*authenticated/i);
});

test('prototype does not smuggle in a new payroll role or executable month-lock RPC', () => {
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function/i);
  assert.doesNotMatch(sql, /current_user_has_role\s*\(\s*'payroll/i);
  assert.match(sql, /payroll operator role mapping/i);
  assert.match(sql, /real month lock RPC/i);
});
