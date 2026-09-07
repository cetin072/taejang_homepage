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
  assert.ok(employeeReferences.length >= 5);
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
    'payroll_carryover_applications',
    'payroll_accounting_comparisons',
    'payroll_accounting_difference_rows',
  ];

  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }

  assert.match(sql, /revoke all on[\s\S]*payroll_carryover_applications[\s\S]*from public, anon, authenticated;/i);
  assert.doesNotMatch(sql, /create\s+policy/i);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete|all)[\s\S]*authenticated/i);
});

test('hourly employment terms reject a zero hourly rate at the persistence boundary', () => {
  assert.match(sql, /pay_type='hourly'[\s\S]*hourly_rate\s*>\s*0/i);
});

test('month latest-run pointer cannot reference another payroll month', () => {
  assert.match(sql, /unique\s*\(id,\s*payroll_month_id\)/i);
  assert.match(
    sql,
    /foreign key\s*\(latest_run_id,\s*id\)[\s\S]*references public\.payroll_calculation_runs\(id,\s*payroll_month_id\)/i
  );
});

test('carryover adjustment stores amount readiness separately from hour difference', () => {
  assert.match(sql, /create table if not exists public\.payroll_adjustments[\s\S]*source_hourly_rate/i);
  assert.match(sql, /create table if not exists public\.payroll_adjustments[\s\S]*difference_amount/i);
  assert.match(sql, /amount_status text not null default 'review_required'/i);
  assert.match(sql, /amount_status='review_required'[\s\S]*source_hourly_rate is not null[\s\S]*difference_amount is not null/i);
});

test('carryover application is an immutable target-run audit record rather than a rewrite of work hours', () => {
  assert.match(sql, /create table if not exists public\.payroll_carryover_applications/i);
  assert.match(sql, /application_key text not null unique/i);
  assert.match(sql, /adjustment_id uuid not null references public\.payroll_adjustments\(id\) on delete restrict/i);
  assert.match(sql, /difference_amount numeric\(14,2\) not null/i);
  assert.match(sql, /status text not null default 'applied' check \(status='applied'\)/i);
  assert.match(sql, /unique \(adjustment_id, applied_run_id\)/i);
});

test('carryover applied run must belong to the same target payroll month', () => {
  assert.match(
    sql,
    /foreign key\s*\(applied_run_id,\s*target_payroll_month_id\)[\s\S]*references public\.payroll_calculation_runs\(id,\s*payroll_month_id\)/i
  );
});

test('accounting comparison run must belong to the same payroll month', () => {
  assert.match(
    sql,
    /foreign key\s*\(run_id,\s*payroll_month_id\)[\s\S]*references public\.payroll_calculation_runs\(id,\s*payroll_month_id\)/i
  );
});

test('prototype records migration-promotion blockers instead of silently treating itself as executable-ready', () => {
  assert.match(sql, /preventing overlapping employment-term date ranges/i);
  assert.match(sql, /persist gross-pay previews as null while unresolved\/rate-review items remain/i);
  assert.match(sql, /independently review payroll read\/write role mapping/i);
  assert.match(sql, /source payroll month locked before carryover application/i);
  assert.match(sql, /bind confirmed accounting to the exact adjusted-payroll basis/i);
});

test('prototype does not smuggle in a new payroll role or executable month-lock RPC', () => {
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function/i);
  assert.doesNotMatch(sql, /current_user_has_role\s*\(\s*'payroll/i);
  assert.match(sql, /payroll operator role mapping/i);
  assert.match(sql, /real month lock RPC/i);
});
