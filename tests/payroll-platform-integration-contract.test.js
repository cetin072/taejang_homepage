const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const employeeSql = read('supabase/migrations/20260904083000_employee_identity_foundation_v1.sql');
const securitySql = read('supabase/migrations/20260723000100_phase1a_security_foundation.sql');
const payrollSql = read('prototypes/payroll-backend/schema.sql');
const contract = read('prototypes/payroll-backend/PLATFORM_INTEGRATION_CONTRACT.md');

test('payroll reuses the canonical employee UUID instead of creating a parallel employee master', () => {
  assert.match(employeeSql, /create table if not exists public\.employees/i);
  assert.match(employeeSql, /id uuid primary key default gen_random_uuid\(\)/i);
  assert.match(payrollSql, /references public\.employees\(id\)/i);
  assert.doesNotMatch(payrollSql, /create table if not exists public\.payroll_employees\b/i);
  assert.match(contract, /public\.employees\(id\).*employee identity key/i);
});

test('payroll preserves account-person-employee separation and does not persist copied identity fields', () => {
  assert.match(employeeSql, /create table if not exists public\.people/i);
  assert.match(employeeSql, /create table if not exists public\.account_person_links/i);
  assert.doesNotMatch(payrollSql, /\bfull_name\b/i);
  assert.doesNotMatch(payrollSql, /\bwork_email\b/i);
  assert.doesNotMatch(payrollSql, /resident_registration/i);
  assert.doesNotMatch(payrollSql, /disability_(?:type|grade|number|card)/i);
  assert.doesNotMatch(payrollSql, /bank_(?:account|number)/i);
  assert.match(contract, /Do not create a parallel payroll employee master/i);
});

test('employee foundation demonstrates the fail-closed table plus guarded RPC pattern payroll must preserve', () => {
  assert.match(employeeSql, /alter table public\.employees enable row level security/i);
  assert.match(employeeSql, /revoke all on public\.people, public\.employees[\s\S]*from public, anon, authenticated/i);
  assert.match(employeeSql, /create or replace function public\.get_employee_management_context\(\)/i);
  assert.match(employeeSql, /grant execute on function public\.get_employee_management_context\(\) to authenticated/i);
  assert.match(contract, /must not be directly selectable or writable by `anon` or ordinary `authenticated` clients/i);
});

test('approved MVP access model is operations_manager only and never implicit super-admin payroll authority', () => {
  assert.match(securitySql, /\('operations_manager', '운영총괄'\)/);
  assert.match(securitySql, /\('super_admin', '시스템 최고관리자'\)/);
  assert.match(contract, /Option A approved/i);
  assert.match(contract, /`operations_manager`: \*\*the only payroll operator role\*\*/i);
  assert.match(contract, /`super_admin` alone is \*\*not\*\* a payroll authorization rule/i);
  assert.match(contract, /Do not create a new `payroll_operator` role/i);
  assert.match(contract, /does not authorize applying that candidate to a live Supabase environment/i);
});

test('payroll integration contract requires active-account and operations-manager checks at the RPC boundary', () => {
  assert.match(securitySql, /create or replace function public\.current_profile_is_active\(\)/i);
  assert.match(securitySql, /create or replace function public\.current_user_has_role\(p_role_code text\)/i);
  assert.match(contract, /Every payroll read or mutation RPC must reject unauthenticated or inactive profiles/i);
  assert.match(contract, /current_profile_is_active\(\) AND current_user_has_role\('operations_manager'\)/i);
  assert.match(contract, /No other role may be OR-ed into this predicate without a new approval/i);
});

test('generic audit logs stay free of payroll amounts and sensitive payroll payloads', () => {
  assert.match(securitySql, /comment on table public\.audit_logs[\s\S]*Never store passwords, tokens, keys, health details, or consultation text/i);
  assert.match(securitySql, /UNSAFE_AUDIT_METADATA_KEY/);
  assert.match(contract, /should not copy payroll amounts or employee-sensitive payloads into generic `audit_logs\.metadata`/i);
  assert.match(contract, /Do not place employee names, gross\/net pay, deductions, bank data/i);
});

test('authoritative payroll mutations are reserved for reviewed transaction-safe server boundaries', () => {
  assert.match(contract, /must not directly INSERT\/UPDATE\/DELETE authoritative payroll rows/i);
  assert.match(contract, /transaction-safe RPC\/server boundaries/i);
  assert.match(contract, /lock a payroll month after atomically rechecking all blockers/i);
  assert.match(contract, /A final locked payroll month is immutable/i);
});

test('role decision is approved while real DB application remains a separate gate', () => {
  assert.match(contract, /ACCESS MODEL APPROVED \/ DB APPLICATION NOT APPROVED/i);
  assert.match(contract, /\[x\].*Option A \/ `operations_manager` only/i);
  assert.match(contract, /\[ \] exact payroll read RPC contract is reviewed/i);
  assert.match(contract, /\[ \] exact payroll mutation RPCs are implemented transactionally/i);
  assert.match(contract, /Not approved now: introducing a dedicated `payroll_operator` role/i);
});
