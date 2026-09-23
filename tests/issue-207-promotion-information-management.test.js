'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ux = fs.readFileSync(path.join(root, 'app/assets/issue-207-promotion-information-ux.js'), 'utf8');
const dashboardShell = fs.readFileSync(path.join(root, 'app/assets/dashboard-shell.js'), 'utf8');
const publicationAdmin = fs.readFileSync(path.join(root, 'app/assets/phase-c-publication-admin.js'), 'utf8');
const appUi = fs.readFileSync(path.join(root, 'app/assets/app-ui.js'), 'utf8');
const navigation = fs.readFileSync(path.join(root, 'app/assets/role-navigation-priority.js'), 'utf8');
const navigationStability = fs.readFileSync(path.join(root, 'app/assets/navigation-visual-stability.js'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'app/assets/phase-c-workspace-v2.js'), 'utf8');
const supportCss = fs.readFileSync(path.join(root, 'app/assets/support-radar.css'), 'utf8');
const capabilityFoundation = fs.readFileSync(path.join(root, 'supabase/migrations/20260909150000_issue_148_capability_foundation.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260914070000_issue207_promotion_information_workflow.sql'), 'utf8');
const correction = fs.readFileSync(path.join(root, 'supabase/migrations/20260914071500_issue207_delete_request_and_submitter_correction.sql'), 'utf8');
const finalPolicy = fs.readFileSync(path.join(root, 'supabase/migrations/20260914073000_issue207_final_public_delete_policy.sql'), 'utf8');

function syntaxCheck(file) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
}

test('issue 207 pilot UX parses and loads after earlier promotion modules', () => {
  syntaxCheck('app/assets/issue-207-promotion-information-ux.js');
  syntaxCheck('app/assets/phase-c-publication-admin.js');
  syntaxCheck('app/assets/role-navigation-priority.js');
  syntaxCheck('app/assets/navigation-visual-stability.js');
  syntaxCheck('app/assets/app-ui.js');
  assert.match(appUi, /assets\/issue-207-promotion-information-ux\.js/);
  assert.match(appUi, /assets\/navigation-visual-stability\.js/);
  assert.ok(appUi.indexOf('assets/issue-207-promotion-information-ux.js') > appUi.indexOf('assets/ux-followup-polish.js'));
  assert.ok(appUi.indexOf('assets/navigation-visual-stability.js') > appUi.indexOf('assets/issue-207-promotion-information-ux.js'));
});

test('issue 207 capability kinds stay inside the platform capability contract', () => {
  assert.match(capabilityFoundation, /capability_kind in \('operational', 'technical'\)/);
  const capabilityRows = [...migration.matchAll(/\('(?:promotion|information)\.[^']+',\s*'([^']+)'/g)];
  assert.equal(capabilityRows.length, 5);
  assert.deepEqual([...new Set(capabilityRows.map(match => match[1]))], ['operational']);
  assert.doesNotMatch(migration, /'operation'/);
});

test('promotion writing uses canonical shared sidebar labels owned by dashboard shell', () => {
  assert.match(dashboardShell, /key: 'promotion\.write'[\s\S]*홍보 글 작성/);
  assert.match(dashboardShell, /key: 'promotion\.revision'[\s\S]*보완 요청받은 글/);
  assert.match(dashboardShell, /key: 'promotion\.sent'[\s\S]*보낸 글/);
  assert.match(dashboardShell, /promotion\.write/);
  assert.match(dashboardShell, /promotion\.edit_own/);
  assert.match(ux, /heading === '내 작성글' \|\| heading === '내가 작성한 홍보자료'/);
  assert.match(ux, /item\.lifecycle !== 'needs_revision'/);
  assert.match(ux, /item\.submitted_at/);
  assert.doesNotMatch(ux, /nav\.append\(|insertBefore\(/);
});

test('promotion and homepage management sidebar slots are capability-driven by the canonical shell', () => {
  assert.match(dashboardShell, /key: 'promotion\.existing'[\s\S]*promotion\.manage_recent_public[\s\S]*promotion\.archive/);
  assert.match(dashboardShell, /key: 'homepage\.content'[\s\S]*homepage\.draft[\s\S]*homepage\.review[\s\S]*homepage\.approve_apply/);
  assert.match(dashboardShell, /function openExistingPromotion\(\)/);
  assert.match(dashboardShell, /function openHomepageManagement\(\)/);
  assert.match(ux, /openInformationHub/);
  assert.match(dashboardShell, /window\.TaejangPromotionWorkspaceV2Api\?\.openHomepageManagement/);
  assert.match(dashboardShell, /window\.TaejangPublicationAdmin\?\.openPublicationAdmin/);
  assert.doesNotMatch(ux, /nav\.append\(|insertBefore\(/);
  assert.doesNotMatch(ux, /MutationObserver/);
  assert.doesNotMatch(ux, /archive\.html\?admin_inventory=/);
});

test('issue 216 navigation stability uses one canonical composer without feature-owned sidebar observers', () => {
  assert.match(workspace, /Sidebar DOM is owned exclusively by dashboard-shell/);
  assert.doesNotMatch(workspace, /new MutationObserver\(/);
  assert.match(navigation, /function ensureIssue207RoleContract/);
  assert.match(navigation, /const MASTER_ORDER = Object\.freeze/);
  assert.match(navigation, /const MASTER_SECTIONS = Object\.freeze/);
  assert.match(navigation, /LABEL_RENAMES/);
  assert.match(navigation, /function removeLegacySupportGroups/);
  assert.doesNotMatch(navigation, /supportGroupPriority/);
  assert.match(navigation, /'출근부', '근태 보정', '근태·급여관리'/);
  assert.match(navigation, /navigationComposerObserver/);
  assert.match(navigation, /observe\(nav, \{ childList: true, subtree: false \}\)/);
  assert.match(navigationStability, /INITIAL_SETTLE_MS = 190/);
  assert.match(navigationStability, /style\.visibility = 'hidden'/);
  assert.match(navigationStability, /taejang-navigation-stable/);
  assert.doesNotMatch(navigation, /data-support-radar-nav-group[^\n]*append/);
});

test('review queue identifies originating employee and current submitter without permanent DOM observer', () => {
  assert.match(ux, /get_promotion_review_submitter/);
  assert.match(ux, /작성자: \$\{owner\} · 현재 상신: \$\{submitter\}/);
  assert.match(correction, /'owner_name', owner_name/);
  assert.match(correction, /'submitted_by_name', submitter_name/);
  assert.doesNotMatch(correction, /request_promotion_deletion/);
});

test('existing content pilot avoids hidden archive iframe and provides manual static-content modification request', () => {
  assert.match(publicationAdmin, /get_promotion_publication_admin/);
  assert.match(publicationAdmin, /전체 소식·기록 열기/);
  assert.match(publicationAdmin, /기타 공개글 수정 요청/);
  assert.match(publicationAdmin, /p_target_kind: 'archive'/);
  assert.doesNotMatch(publicationAdmin, /iframe/);
  assert.doesNotMatch(publicationAdmin, /MutationObserver/);
  assert.doesNotMatch(migration, /create table if not exists public\.public_content_inventory/);
});

test('existing-content review exposes only actions supported end-to-end in the pilot', () => {
  assert.match(publicationAdmin, /reviewChangeRequest\(request, 'approve'\)/);
  assert.match(publicationAdmin, /reviewChangeRequest\(request, 'reject'\)/);
  assert.doesNotMatch(publicationAdmin, /reviewChangeRequest\(request, 'changes_requested'\)/);
  assert.match(ux, /reviewInformation\(request, 'changes_requested'\)/);
});

test('public content policy allows recent direct edit/archive but forbids deletion after 24 hours', () => {
  assert.match(migration, /lead_update_recent_promotion_content/);
  assert.match(migration, /PROMOTION_PUBLIC_EDIT_WINDOW_EXPIRED/);
  assert.match(migration, /lead_archive_recent_promotion_content/);
  assert.match(migration, /PROMOTION_PUBLIC_DELETE_WINDOW_EXPIRED/);
  assert.match(migration, /create_public_content_change_request/);
  assert.match(publicationAdmin, /24시간 내 삭제/);
  assert.match(publicationAdmin, /24시간 경과 · 삭제 불가/);
  assert.doesNotMatch(publicationAdmin, /request_promotion_deletion/);
  assert.match(finalPolicy, /PROMOTION_DELETE_REQUEST_POLICY_RETIRED/);
  assert.match(finalPolicy, /PROMOTION_PUBLIC_DELETE_WINDOW_EXPIRED/);
  assert.doesNotMatch(finalPolicy, /private_request_promotion_deletion_pre148/);
});

test('notice approval lane remains operations-approved while the UI removes standing-guidance authoring', () => {
  assert.match(migration, /'information\.submit'/);
  assert.match(migration, /'information\.review'/);
  assert.match(migration, /where role\.code = 'promotion_lead'/);
  assert.match(migration, /save_information_publication_request/);
  assert.match(migration, /review_information_publication_request/);
  assert.match(migration, /not public\.current_user_has_role\('operations_manager'\)/);
  assert.match(ux, /p_information_kind: 'notice'/);
  assert.match(ux, /item\.information_kind === 'notice'/);
  assert.match(ux, /'새 공지 작성'/);
  assert.match(ux, /'공지 관리'/);
  assert.match(ux, /'승인·게시'/);
  assert.doesNotMatch(ux, /guidanceKinds/);
  assert.doesNotMatch(ux, /get_my_staff_guidance_list/);
  assert.doesNotMatch(ux, /option\('guidance'/);
  assert.doesNotMatch(ux, /setPage\('공지·안내/);
  assert.doesNotMatch(ux, /navNode\('공지·안내/);
});

test('notice data remains user-scoped after navigation is simplified', () => {
  assert.doesNotMatch(dashboardShell, /label: '공지 확인'/);
  assert.match(ux, /setPage\('공지 확인'/);
  assert.match(ux, /get_my_notice_list/);
  assert.doesNotMatch(ux, /get_my_staff_guidance_list/);
  assert.doesNotMatch(ux, /setPage\('공지·안내 확인'/);
});
