'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const legacyMigration = read('supabase/migrations/20260904133000_operations_manager_recoverable_delete.sql');
const recoveryMigration = read('supabase/migrations/20260910171000_issue_150_recovery_audit_foundation.sql');
const authorityBridge = read('supabase/migrations/20260910172000_issue_150_recovery_authority_and_legacy_bridge.sql');
const recoveryFeed = read('supabase/migrations/20260910173000_issue_150_archived_recovery_feed.sql');
const controls = read('app/assets/operations-delete-controls.js');
const publicationAdmin = read('app/assets/phase-c-publication-admin.js');
const appUi = read('app/assets/app-ui.js');

function functionBlock(source, name) {
  return source.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`))?.[0] || '';
}

test('operations recovery browser module parses, is loaded, and uses capability-first operations gating', () => {
  execFileSync(process.execPath, ['--check', path.join(ROOT, 'app/assets/operations-delete-controls.js')], { stdio: 'pipe' });
  assert.match(appUi, /operations-delete-controls\.js/);
  assert.match(controls, /audit\.target_history\.read/);
  assert.match(controls, /hasCapabilityContract/);
  assert.match(controls, /getRoute\?\.\(\) === 'operations_manager'/, 'route remains only as v1 fallback');
  assert.match(controls, /taejang-capabilities-ready/);
});

test('employee delete remains operations-only and recoverable', () => {
  const fn = functionBlock(legacyMigration, 'archive_employee');
  assert.match(fn, /current_user_has_role\('operations_manager'\)/);
  assert.match(fn, /private_employee_is_protected/);
  assert.match(fn, /account_status = 'deleted'/);
  assert.match(fn, /account_status_history/);
  assert.match(fn, /employee_deleted/);
  assert.doesNotMatch(fn, /delete from public\.employees/i);
  assert.match(controls, /직원 삭제/);
  assert.match(controls, /archive_employee/);
});

test('schedule notice and guidance delete aliases now enter recoverable archive instead of inactive-only legacy delete', () => {
  for (const [deleteName, archiveName] of [
    ['delete_schedule_item', 'archive_schedule_item'],
    ['delete_notice', 'archive_notice'],
    ['delete_staff_guidance', 'archive_staff_guidance']
  ]) {
    const bridge = functionBlock(authorityBridge, deleteName);
    assert.match(bridge, new RegExp(`public\\.${archiveName}`), `${deleteName} delegates to ${archiveName}`);
    assert.doesNotMatch(bridge, /delete from public\./i);
  }

  for (const [archiveName, restoreName] of [
    ['archive_schedule_item', 'restore_schedule_item'],
    ['archive_notice', 'restore_notice'],
    ['archive_staff_guidance', 'restore_staff_guidance']
  ]) {
    assert.match(recoveryMigration, new RegExp(`function public\\.${archiveName}`));
    assert.match(recoveryMigration, new RegExp(`function public\\.${restoreName}`));
  }
  assert.match(recoveryMigration, /archive_previous_status/);
  assert.match(recoveryMigration, /ARCHIVED_RESOURCE_UPDATE_FORBIDDEN/);
  assert.doesNotMatch(recoveryMigration, /delete from public\.(schedule_items|notices|staff_guidance_items)/i);
});

test('recovery authority preserves the pre-existing operations-only delete boundary', () => {
  const helper = functionBlock(authorityBridge, 'private_actor_can_manage_recovery_target');
  assert.match(helper, /private_actor_can\(p_capability\)/);
  assert.match(helper, /operations_manager/);
  assert.match(helper, /private_effective_role_codes/);
  assert.match(authorityBridge, /revoke all on function public\.private_actor_can_manage_recovery_target[\s\S]*authenticated/);
});

test('normal manager lists stay clean while operations receives a dedicated archived recovery feed', () => {
  assert.match(legacyMigration, /schedule\.status <> 'inactive'/);
  assert.match(legacyMigration, /notice\.status <> 'inactive'/);
  assert.match(legacyMigration, /guidance\.status <> 'inactive'/);
  assert.match(recoveryFeed, /get_archived_recovery_items/);
  assert.match(recoveryFeed, /audit\.target_history\.read/);
  assert.match(recoveryFeed, /archived_at is not null/g);
  assert.match(recoveryFeed, /RECOVERY_ARCHIVE_READ_FORBIDDEN/);
  assert.match(controls, /get_archived_recovery_items/);
  assert.match(controls, /보관함/);
});

test('recovery UI requires confirmation and reason, supports restore, and exposes target history', () => {
  assert.match(controls, /async function archiveItem/);
  assert.match(controls, /async function restoreItem/);
  assert.match(controls, /window\.confirm/);
  assert.match(controls, /window\.prompt/);
  assert.match(controls, /archive_schedule_item/);
  assert.match(controls, /restore_schedule_item/);
  assert.match(controls, /archive_notice/);
  assert.match(controls, /restore_notice/);
  assert.match(controls, /archive_staff_guidance/);
  assert.match(controls, /restore_staff_guidance/);
  assert.match(controls, /get_target_audit_trail/);
  assert.match(controls, /변경 이력/);
  assert.match(controls, /data-target-audit-panel/);
});

test('recovery observer avoids repeatedly reloading the archive section it just rendered', () => {
  assert.match(controls, /archivedSection && cards\.every/);
  assert.match(controls, /data-ops-archive-schedule/);
  assert.match(controls, /data-ops-archive-notice/);
  assert.match(controls, /data-ops-archive-guidance/);
  assert.match(controls, /function hasRelevantAddedNode\(records\)/);
  assert.match(controls, /if \(hasRelevantAddedNode\(records\)\) scheduleSync\(\)/);
});

test('target audit is business-scoped and not the raw technical audit browser', () => {
  const fn = functionBlock(recoveryMigration, 'get_target_audit_trail');
  assert.match(fn, /audit\.target_history\.read/);
  assert.match(fn, /INVALID_TARGET_TYPE/);
  assert.match(fn, /actor_display_name/);
  assert.match(fn, /reason_summary/);
  assert.match(fn, /metadata/);
  assert.doesNotMatch(fn, /audit\.system_raw_read/);
});

test('promotion recoverable delete remains unchanged by Issue 150 schedule/notice/guidance work', () => {
  const fn = functionBlock(legacyMigration, 'delete_promotion_content');
  assert.match(fn, /current_user_has_role\('operations_manager'\)/);
  assert.match(fn, /PROMOTION_DELETE_TITLE_CONFIRMATION_MISMATCH/);
  assert.match(fn, /set lifecycle='archived'/);
  assert.match(publicationAdmin, /delete_promotion_content/);
  assert.match(publicationAdmin, /p_confirm_title/);
});
