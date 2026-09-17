'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const core = require(path.join(root, 'app/assets/issue-221-employee-screen-core.js'));
const switcher = fs.readFileSync(path.join(root, 'app/assets/issue-221-employee-screen-switcher.js'), 'utf8');
const appUi = fs.readFileSync(path.join(root, 'app/assets/app-ui.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260916161000_issue_221_employee_screen_personas.sql'), 'utf8');

const persona = (overrides = {}) => ({
  profile_id: 'profile-1',
  employee_uuid: 'employee-1',
  employee_id: 'TJ001',
  name: '김직원',
  role_code: 'general_worker',
  ...overrides
});

test('employee persona core keeps one safe active-role row per employee and omits current profile', () => {
  const result = core.buildPersonas({ personas: [
    persona(),
    persona({ profile_id: 'profile-duplicate', role_code: 'promotion_staff' }),
    persona({ profile_id: 'profile-2', employee_uuid: 'employee-2', employee_id: 'TJ002', name: '이홍보', role_code: 'promotion_staff' }),
    persona({ profile_id: 'profile-3', employee_uuid: 'employee-3', employee_id: 'TJ003', name: '박팀장', role_code: 'promotion_lead' }),
    persona({ profile_id: 'profile-current', employee_uuid: 'employee-current', name: '현재사용자' }),
    persona({ profile_id: 'profile-invalid', employee_uuid: 'employee-invalid', name: '잘못된역할', role_code: 'operations_manager' })
  ] }, { currentProfileId: 'profile-current' });

  assert.deepEqual(result.map(item => [item.name, item.roleCode]), [
    ['김직원', 'general_worker'],
    ['박팀장', 'promotion_lead'],
    ['이홍보', 'promotion_staff']
  ]);
  assert.equal(new Set(result.map(item => item.employeeUuid)).size, result.length);
  for (const item of result) {
    assert.deepEqual(Object.keys(item).sort(), ['employeeId', 'employeeUuid', 'name', 'profileId', 'roleCode', 'roleName'].sort());
  }
});

test('role preview is offered only for roles without a real employee persona', () => {
  assert.deepEqual(core.missingRoleCodes([
    { roleCode: 'general_worker' },
    { roleCode: 'promotion_staff' }
  ]), ['promotion_lead']);
  assert.deepEqual(core.missingRoleCodes([
    { roleCode: 'general_worker' },
    { roleCode: 'promotion_staff' },
    { roleCode: 'promotion_lead' }
  ]), []);
});

test('exact-account QA mode fails closed outside local and the known Netlify deploy-preview host', () => {
  assert.equal(core.isExactQaPreviewHost('localhost'), true);
  assert.equal(core.isExactQaPreviewHost('127.0.0.1'), true);
  assert.equal(core.isExactQaPreviewHost('deploy-preview-221--taejang-homepage.netlify.app'), true);
  assert.equal(core.isExactQaPreviewHost('taejang.co.kr'), false);
  assert.equal(core.isExactQaPreviewHost('taejang-homepage.netlify.app'), false);
  assert.equal(core.isExactQaPreviewHost('deploy-preview-221--other-site.netlify.app'), false);
});

test('browser switcher uses production-safe persona RPC and exposes only employee name plus role copy', () => {
  assert.match(switcher, /get_operations_employee_screen_personas/);
  assert.match(switcher, /employeeGroup\.label = '직원 계정'/);
  assert.match(switcher, /`\$\{persona\.name\} · \$\{persona\.roleName\}`/);
  assert.match(switcher, /core\.missingRoleCodes\(personas\)/);
  assert.match(switcher, /context\(\)\?\.role_simulation\?\.can_switch/);
  assert.match(switcher, /set_role_simulation_mode/);
  assert.match(switcher, /if \(!isExactQaHost\(\)\) return setSafeRolePreview/);
  assert.doesNotMatch(switcher, /functions\/v1\/qa-account-preview/);
  assert.doesNotMatch(switcher, /password|service[_-]?role/i);
  assert.doesNotMatch(switcher, /access_token|refresh_token/);
});

test('database persona RPC filters active linked employees and auth-ready users without returning auth secrets', () => {
  assert.match(migration, /get_operations_employee_screen_personas/);
  assert.match(migration, /profile\.account_status = 'active'/);
  assert.match(migration, /employee\.employment_status = 'active'/);
  assert.match(migration, /employee\.archived_at is null/);
  assert.match(migration, /account_link\.revoked_at is null/);
  assert.match(migration, /assignment\.revoked_at is null/);
  assert.match(migration, /auth_user\.confirmed_at is not null/);
  assert.match(migration, /auth_user\.deleted_at is null/);
  assert.match(migration, /auth_user\.banned_until is null or auth_user\.banned_until <= now\(\)/);
  assert.match(migration, /partition by employee\.id/);
  assert.match(migration, /role\.code in \('general_worker', 'promotion_staff', 'promotion_lead'\)/);
  assert.match(migration, /role\.code = 'operations_manager'/);
  assert.match(migration, /private_actor_can\('account\.view_management'\)/);
  assert.doesNotMatch(migration, /access_token|refresh_token|password|service[_-]?role/i);
  assert.doesNotMatch(migration, /auth_user\.email|profile\.work_email/);
});

test('general employee simulation reuses the existing operations-manager-only privilege-reduction boundary', () => {
  assert.match(migration, /normalized_role not in \('general_worker', 'promotion_staff', 'promotion_lead'\)/);
  assert.match(migration, /role\.code = 'operations_manager'/);
  assert.match(migration, /ROLE_SIMULATION_FORBIDDEN/);
  assert.match(migration, /mode_expires_at := now\(\) \+ interval '2 hours'/);
  assert.doesNotMatch(migration, /impersonat/i);
});

test('Issue 221 modules load immediately after the existing role simulation module', () => {
  const base = appUi.indexOf("['assets/phase-c-role-simulation.js', 'phase-c-role-simulation']");
  const coreIndex = appUi.indexOf("['assets/issue-221-employee-screen-core.js', 'issue-221-employee-screen-core']");
  const switcherIndex = appUi.indexOf("['assets/issue-221-employee-screen-switcher.js', 'issue-221-employee-screen-switcher']");
  assert.ok(base >= 0 && coreIndex > base && switcherIndex > coreIndex);
});
