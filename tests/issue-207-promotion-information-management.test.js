'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ux = fs.readFileSync(path.join(root, 'app/assets/issue-207-promotion-information-ux.js'), 'utf8');
const publicationAdmin = fs.readFileSync(path.join(root, 'app/assets/phase-c-publication-admin.js'), 'utf8');
const appUi = fs.readFileSync(path.join(root, 'app/assets/app-ui.js'), 'utf8');
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
  syntaxCheck('app/assets/app-ui.js');
  assert.match(appUi, /assets\/issue-207-promotion-information-ux\.js/);
  assert.ok(appUi.indexOf('assets/issue-207-promotion-information-ux.js') > appUi.indexOf('assets/ux-followup-polish.js'));
});

test('issue 207 capability kinds stay inside the platform capability contract', () => {
  assert.match(capabilityFoundation, /capability_kind in \('operational', 'technical'\)/);
  const capabilityRows = [...migration.matchAll(/\('(?:promotion|information)\.[^']+',\s*'([^']+)'/g)];
  assert.equal(capabilityRows.length, 5);
  assert.deepEqual([...new Set(capabilityRows.map(match => match[1]))], ['operational']);
  assert.doesNotMatch(migration, /'operation'/);
});

test('promotion staff write screen separates sent and revision queues from composer', () => {
  assert.match(ux, /'새 홍보글 작성'/);
  assert.match(ux, /'보낸 글'/);
  assert.match(ux, /'보완 요청받은 글'/);
  assert.match(ux, /heading === '내 작성글' \|\| heading === '내가 작성한 홍보자료'/);
  assert.match(ux, /item\.lifecycle !== 'needs_revision'/);
  assert.match(ux, /item\.submitted_at/);
});

test('promotion lead navigation uses lightweight existing-content and unified information management', () => {
  assert.match(ux, /review\.textContent = '승인·검토'/);
  assert.match(ux, /write\.textContent = '새 홍보글 작성'/);
  assert.match(ux, /existing\.textContent = '기존 글 관리'/);
  assert.match(ux, /navNode\('공지·안내 관리'/);
  assert.doesNotMatch(ux, /archive\.html\?admin_inventory=/);
  assert.doesNotMatch(ux, /MutationObserver/);
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

test('notice and standing guidance share one submit/review lane without promotion-lead direct publish', () => {
  assert.match(migration, /'information\.submit'/);
  assert.match(migration, /'information\.review'/);
  assert.match(migration, /where role\.code = 'promotion_lead'/);
  assert.doesNotMatch(migration, /cap\.code in \([^)]*notice\.manage/s);
  assert.doesNotMatch(migration, /cap\.code in \([^)]*guidance\.manage/s);
  assert.match(migration, /save_information_publication_request/);
  assert.match(migration, /review_information_publication_request/);
  assert.match(migration, /not public\.current_user_has_role\('operations_manager'\)/);
  assert.match(ux, /운영총괄에게 상신/);
  assert.match(ux, /승인·게시/);
});

test('promotion staff read navigation combines notice and standing guidance', () => {
  assert.match(ux, /'공지·안내 확인'/);
  assert.match(ux, /get_my_notice_list/);
  assert.match(ux, /get_my_staff_guidance_list/);
});