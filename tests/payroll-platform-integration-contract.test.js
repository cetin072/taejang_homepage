const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const employeeSql = read('supabase/migrations/20260904083000_employee_identity_foundation_v1.sql');
const securitySql = read('supabase/migrations/20260723000100_phase1a_security_foundation.sql');
const payrollSql = read('prototypes/payroll-backend/schema.sql');
const capabilitySql = read('prototypes/payroll-backend/payroll_capability_candidate.sql');
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

test('payroll preserves fail-closed table access plus guarded server boundaries', () => {
  assert.match(employeeSql, /alter table public\.employees enable row level security/i);
  assert.match(employeeSql, /revoke all on public\.people, public\.employees[\s\S]*from public, anon, authenticated/i);
  assert.match(contract, /Payroll tables must not be directly selectable or writable by `anon` or ordinary `authenticated` clients/i);
  assert.match(contract, /transaction-safe server\/RPC boundaries/i);
});

test('approved audience remains operations_manager only while current-main implementation becomes capability based', () => {
  assert.match(securitySql, /\('operations_manager', '운영총괄'\)/);
  assert.match(securitySql, /\('super_admin', '시스템 최고관리자'\)/);
  assert.match(contract, /Option A approved/i);
  assert.match(contract, /`operations_manager`: \*\*only payroll operator/i);
  assert.match(contract, /`super_admin`: no automatic payroll access/i);
  assert.match(contract, /`payroll\.manage`/i);
  assert.match(contract, /current_profile_is_active\(\) AND private_actor_can\('payroll\.manage'\)/i);
  assert.match(capabilitySql, /operations_manager_auto_grant[\s\S]*true/i);
  assert.doesNotMatch(capabilitySql, /insert into public\.role_capability_grants/i);
  assert.match(contract, /Do not create a new `payroll_operator` role/i);
});

test('lower-role simulation and internal service persistence both remain fail-closed', () => {
  assert.match(contract, /lower-role simulation removes payroll operational access/i);
  assert.match(contract, /actual account still has `operations_manager`/i);
  assert.match(contract, /active lower-role simulation has not removed operational permissions/i);
  assert.match(capabilitySql, /role_simulation_modes/i);
  assert.match(capabilitySql, /s\.role_code <> 'operations_manager'/i);
});

test('Issue 21 classification keeps authoritative payroll deterministic and AI optional', () => {
  assert.match(contract, /Central AI architecture candidate — Issue #21 classification/i);
  assert.match(contract, /\*\*Code \/ deterministic rules\*\*/i);
  assert.match(contract, /\*\*Official data ledger\*\*/i);
  assert.match(contract, /\*\*AI-appropriate optional work\*\*/i);
  assert.match(contract, /Realtime AI requirement[\s\S]*none for the current payroll MVP/i);
  assert.match(contract, /Deterministic by Default, AI by Necessity/i);
  assert.match(contract, /AI must not determine authoritative wages, permissions, month locks, attendance facts, or payment amounts/i);
});

test('vendor payroll attendance and mobile operational attendance remain separate sources', () => {
  assert.match(contract, /accepted vendor\/fingerprint Excel import batch remains the payroll calculation attendance source of truth/i);
  assert.match(contract, /mobile attendance remains separate operational evidence/i);
  assert.match(contract, /not automatically merged, summed or used to overwrite each other/i);
  assert.match(contract, /clock-in\/out elapsed time never becomes paid hours by implicit subtraction/i);
});

test('generic audit logs stay free of payroll amounts and sensitive payroll payloads', () => {
  assert.match(securitySql, /comment on table public\.audit_logs[\s\S]*Never store passwords, tokens, keys, health details, or consultation text/i);
  assert.match(securitySql, /UNSAFE_AUDIT_METADATA_KEY/);
  assert.match(contract, /must not copy payroll amounts or employee-sensitive payloads/i);
  assert.match(contract, /Do not place employee names, gross\/net pay, deductions, bank data/i);
});

test('authoritative payroll mutations are reserved for reviewed transaction-safe server boundaries', () => {
  assert.match(contract, /must not directly INSERT\/UPDATE\/DELETE authoritative payroll rows/i);
  assert.match(contract, /lock a payroll month after atomically rechecking all blockers/i);
  assert.match(contract, /A locked payroll month is immutable/i);
});

test('current-main resync is a hard blocker before staging promotion', () => {
  assert.match(contract, /Current-main resync is now a hard pre-staging blocker/i);
  assert.match(contract, /Issue #148 capability authorization/i);
  assert.match(contract, /Issue #149 attendance-integrity migrations/i);
  assert.match(contract, /\[ \] #112 \/ #143 controlled resync against current main is complete/i);
  assert.match(contract, /DB APPLICATION NOT APPROVED/i);
});
