'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260908031219_issue_146_operations_permissions_and_homepage_workflow.sql');
const employeeUi = read('app/assets/employee-management.js');
const workspaceUi = read('app/assets/phase-c-workspace-v2.js');

test('Issue #146 forward migration keeps immutable Employee identity while allowing global lead registration', () => {
  assert.match(migration, /create or replace function public\.create_employee/);
  assert.match(migration, /current_user_has_role\('promotion_lead'\)/);
  assert.match(migration, /private_insert_employee/);
  assert.match(migration, /employee_id/);
  assert.match(migration, /promotion_lead_global/);
  assert.doesNotMatch(migration, /delete from public\.employees/i);
});

test('promotion lead deletion actions preserve audit and public-history boundaries', () => {
  assert.match(migration, /archive_unpublished_promotion_content/);
  assert.match(migration, /PROMOTION_UNPUBLISHED_ARCHIVE_REQUIRES_NO_PUBLIC_HISTORY/);
  assert.match(migration, /recoverable_archive_preserved/);
  assert.match(migration, /PROMOTION_DELETE_REQUEST_REQUIRES_24_HOURS/);
  assert.match(migration, /'revision_id',content_row\.current_revision_id/);
  assert.match(migration, /private_append_audit/g);
});

test('operations manager has the final recoverable promotion archive authority without super_admin conjunction', () => {
  const fn = migration.match(/create or replace function public\.delete_promotion_content[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(fn, /private_is_operations_manager/);
  assert.doesNotMatch(fn, /current_user_has_role\('super_admin'\)/);
  assert.match(fn, /lifecycle='archived'/);
  assert.match(fn, /promotion_review_requests/);
});

test('homepage requests remain allow-listed and offer current-state plus desktop/mobile preview', () => {
  for (const page of ['activities', 'greeting', 'why_minhwa', 'location', 'resources']) assert.match(migration, new RegExp(`page_key = '${page}'`));
  assert.match(migration, /create or replace function public\.create_homepage_change_request/);
  assert.match(migration, /current_user_has_role\('promotion_lead'\) or public\.private_is_operations_manager/);
  assert.match(workspaceUi, /현재 공개 문구/);
  assert.match(workspaceUi, /PC 미리보기/);
  assert.match(workspaceUi, /모바일 미리보기/);
  assert.match(workspaceUi, /p_current_summary: currentSummary\.value\.trim\(\) \|\| null/);
});

test('employee and promotion workspace browser modules parse after the superset changes', () => {
  assert.doesNotThrow(() => new vm.Script(employeeUi, { filename: 'employee-management.js' }));
  assert.doesNotThrow(() => new vm.Script(workspaceUi, { filename: 'phase-c-workspace-v2.js' }));
  assert.match(employeeUi, /promotion_lead_global/);
  assert.match(employeeUi, /'조회 가능한 직원'/);
  assert.match(workspaceUi, /WRITE_ROLES = new Set\(\['promotion_staff', 'promotion_lead', 'operations_manager'\]\)/);
  assert.match(workspaceUi, /save_operations_promotion_draft/);
});
