const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const migration = read('supabase/migrations/20260921050000_issue_309_secure_resident_age_insurance.sql');
const employeeUi = read('app/assets/employee-management.js');
const statutory = read('app/assets/payroll-statutory-deductions.js');
const edgeIndex = read('supabase/functions/payroll-calculate/index.ts');

test('resident number is stored only through Supabase Vault and private metadata', () => {
  assert.match(migration, /create table if not exists private\.employee_sensitive_identity/);
  assert.match(migration, /vault\.create_secret/);
  assert.match(migration, /vault\.update_secret/);
  assert.match(migration, /resident_secret_id uuid not null unique/);
  const tableStart = migration.indexOf('create table if not exists private.employee_sensitive_identity');
  const tableEnd = migration.indexOf(');', tableStart);
  const sensitiveTableDdl = migration.slice(tableStart, tableEnd);
  assert.doesNotMatch(sensitiveTableDdl, /resident_number\s+text/i);
  assert.doesNotMatch(sensitiveTableDdl, /resident_registration_number\s+text/i);
  assert.match(migration, /revoke all on private\.employee_sensitive_identity from public, anon, authenticated/);
});

test('sensitive identity management is an operations-manager auto-grant capability', () => {
  assert.match(migration, /employee\.sensitive_identity_manage/);
  assert.match(migration, /operations_manager_auto_grant/);
  assert.match(migration, /private_actor_can\('employee\.sensitive_identity_manage'\)/);
  assert.match(migration, /EMPLOYEE_SENSITIVE_IDENTITY_FORBIDDEN/);
});

test('browser-facing context returns derived age facts but never resident-number plaintext', () => {
  assert.match(migration, /resident_number_registered/);
  assert.match(migration, /birth_date/);
  assert.match(migration, /age_years/);
  assert.match(migration, /national_pension_age_status/);
  assert.match(migration, /employment_insurance_age_status/);
  assert.doesNotMatch(migration, /decrypted_secret[^;]*jsonb_build_object/i);
});

test('payroll statutory input receives age-derived facts without resident number', () => {
  assert.match(migration, /national_pension_age_lost_on/);
  assert.match(migration, /employment_insurance_age_65_on/);
  assert.match(migration, /employment_insurance_over65_status/);
  const statutoryInputBlock = migration.slice(migration.indexOf('create or replace function public.private_get_payroll_statutory_input'));
  assert.doesNotMatch(statutoryInputBlock, /decrypted_secret|resident_secret_id|normalized/);
});

test('employee UI uses password entry, clears it, and shows only registration/age status', () => {
  assert.doesNotThrow(() => new vm.Script(employeeUi, { filename: 'employee-management.js' }));
  assert.match(employeeUi, /set_employee_resident_registration_number/);
  assert.match(employeeUi, /rrn = input\('password'\)/);
  assert.match(employeeUi, /rrn\.autocomplete = 'off'/);
  assert.match(employeeUi, /rrn\.value = ''/);
  assert.match(employeeUi, /암호화 등록됨/);
  assert.match(employeeUi, /60세 이상 · 의무가입 비대상/);
  assert.match(employeeUi, /65세 이후 · 연속가입 확인 필요/);
});

test('age rules distinguish pension automatic age exclusion from employment continuity review', () => {
  assert.match(statutory, /nationalPensionAgeLostOn/);
  assert.match(statutory, /voluntary_continuation_confirmed/);
  assert.match(statutory, /employment_insurance_age_continuity_review_required/);
  assert.match(statutory, /employed_after_65_excluded/);
  assert.match(statutory, /continuous_before_65_confirmed/);
  assert.match(edgeIndex, /payroll-engine-workweek-golden-v5-age-insurance-eligibility/);
});

test('audit metadata deliberately excludes resident-number values', () => {
  const auditStart = migration.indexOf("'employee_sensitive_identity_saved'");
  const auditEnd = migration.indexOf('return private.employee_age_insurance_snapshot', auditStart);
  const auditBlock = migration.slice(auditStart, auditEnd);
  assert.match(auditBlock, /resident_number_registered/);
  assert.doesNotMatch(auditBlock, /normalized|p_resident_number|birth_date/);
});


test('bulk resident import is atomic, operations-only, and never echoes resident numbers', () => {
  const bulkMigration = read('supabase/migrations/20260921054500_issue_309_bulk_resident_import.sql');
  assert.match(bulkMigration, /bulk_set_employee_resident_registration_numbers/);
  assert.match(bulkMigration, /private_actor_can\('employee\.sensitive_identity_manage'\)/);
  assert.match(bulkMigration, /jsonb_array_length\(p_rows\)/);
  assert.match(bulkMigration, /row_count < 1 or row_count > 100/);
  assert.match(bulkMigration, /perform public\.set_employee_resident_registration_number/);
  assert.match(bulkMigration, /EMPLOYEE_SENSITIVE_IDENTITY_BULK_SAVED/);
  assert.doesNotMatch(bulkMigration, /jsonb_build_object\([^;]*resident_number/i);
});

test('employee UI supports safe spreadsheet paste without persisting resident values client-side', () => {
  assert.match(employeeUi, /bulk_set_employee_resident_registration_numbers/);
  assert.match(employeeUi, /residentNumberChecksumValid/);
  assert.match(employeeUi, /생년월일만 있어 주민번호 등록 제외/);
  assert.match(employeeUi, /현재 직원 DB 미등록으로 제외/);
  assert.match(employeeUi, /textarea\.value = ''/);
  assert.doesNotMatch(employeeUi, /localStorage\.setItem\([^)]*resident/i);
  assert.doesNotMatch(employeeUi, /sessionStorage\.setItem\([^)]*resident/i);
  assert.doesNotMatch(employeeUi, /console\.(log|info|debug)\([^)]*resident/i);
});
