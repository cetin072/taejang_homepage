'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const migration = read('supabase/migrations/20260904133000_operations_manager_recoverable_delete.sql');
const controls = read('app/assets/operations-delete-controls.js');
const publicationAdmin = read('app/assets/phase-c-publication-admin.js');
const appUi = read('app/assets/app-ui.js');

function functionBlock(name) {
  return migration.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`))?.[0] || '';
}

test('operations delete browser module parses and is loaded by the protected app', () => {
  execFileSync(process.execPath, ['--check', path.join(ROOT, 'app/assets/operations-delete-controls.js')], { stdio: 'pipe' });
  assert.match(appUi, /operations-delete-controls\.js/);
  assert.match(controls, /getRoute\?\.\(\) === 'operations_manager'/);
  assert.match(controls, /직원 삭제/);
  assert.match(controls, /일정 삭제/);
  assert.match(controls, /공지 삭제/);
  assert.match(controls, /안내 삭제/);
});

test('delete button flow requires confirmation and reason then refreshes the screen', () => {
  const flow = controls.match(/async function confirmAndDelete[\s\S]*?\n  }/)?.[0] || '';
  assert.match(flow, /window\.confirm/);
  assert.match(flow, /window\.prompt/);
  assert.match(flow, /app\(\)\.rpc\(rpc/);
  assert.match(flow, /await refresh\?\.\(\)/);
  assert.match(controls, /data-ops-delete-employee/);
  assert.match(controls, /data-ops-delete-schedule/);
  assert.match(controls, /data-ops-delete-notice/);
  assert.match(controls, /data-ops-delete-guidance/);
  assert.match(controls, /taejang-open-employee-management/);
  assert.match(controls, /refresh-schedule-admin/);
  assert.match(controls, /refresh-notice-admin/);
  assert.match(controls, /refresh-guidance-admin/);
});

test('employee delete is operations-only, recoverable, and blocks a linked test account', () => {
  const fn = functionBlock('archive_employee');
  assert.match(migration, /add column if not exists archived_at timestamptz/);
  assert.match(fn, /current_user_has_role\('operations_manager'\)/);
  assert.match(fn, /private_employee_is_protected/);
  assert.match(fn, /account_status = 'deleted'/);
  assert.match(fn, /account_status_history/);
  assert.match(fn, /account_person_links[\s\S]*revoked_at = now\(\)/);
  assert.match(fn, /employee_deleted/);
  assert.doesNotMatch(fn, /delete from public\.employees/i);
  assert.match(migration, /where e\.archived_at is null/);
  assert.match(migration, /e\.employment_status='active'[\s\S]*e\.archived_at is null/);
  assert.match(controls, /employee\.protected/);
  assert.match(controls, /archive_employee/);
});

test('schedule notice and guidance delete use inactive state and disappear from normal manager lists', () => {
  for (const [name, audit] of [
    ['delete_schedule_item', 'schedule_deleted'],
    ['delete_notice', 'notice_deleted'],
    ['delete_staff_guidance', 'staff_guidance_deleted']
  ]) {
    const fn = functionBlock(name);
    assert.match(fn, /current_user_has_role\('operations_manager'\)/);
    assert.match(fn, /status='inactive'/);
    assert.match(fn, new RegExp(audit));
    assert.doesNotMatch(fn, /delete from public\./i);
  }
  assert.match(migration, /schedule\.status <> 'inactive'/);
  assert.match(migration, /notice\.status <> 'inactive'/);
  assert.match(migration, /guidance\.status <> 'inactive'/);
  assert.match(controls, /delete_schedule_item/);
  assert.match(controls, /delete_notice/);
  assert.match(controls, /delete_staff_guidance/);
});

test('promotion delete is visible to operations manager and requires exact title confirmation', () => {
  const fn = functionBlock('delete_promotion_content');
  assert.match(fn, /current_user_has_role\('operations_manager'\)/);
  assert.doesNotMatch(fn, /current_user_has_role\('super_admin'\)/);
  assert.match(fn, /PROMOTION_DELETE_TITLE_CONFIRMATION_MISMATCH/);
  assert.match(fn, /set lifecycle='archived'/);
  assert.match(publicationAdmin, /can_permanently_delete/);
  assert.match(publicationAdmin, /delete_promotion_content/);
  assert.match(publicationAdmin, /p_confirm_title/);
});

test('all destructive operations require a reason and retain audit history', () => {
  assert.match(functionBlock('archive_employee'), /EMPLOYEE_DELETE_REASON_REQUIRED/);
  assert.match(functionBlock('delete_schedule_item'), /SCHEDULE_DELETE_REASON_REQUIRED/);
  assert.match(functionBlock('delete_notice'), /NOTICE_DELETE_REASON_REQUIRED/);
  assert.match(functionBlock('delete_staff_guidance'), /STAFF_GUIDANCE_DELETE_REASON_REQUIRED/);
  assert.match(functionBlock('delete_promotion_content'), /PROMOTION_DELETE_REASON_REQUIRED/);
  assert.match(migration, /private_append_audit/g);
  assert.match(controls, /삭제 이유를 적어주세요/);
});
