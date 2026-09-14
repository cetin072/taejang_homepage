'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const migrationPath = 'supabase/migrations/20260903224000_phase_c_live_publication_controls.sql';
const compatibilityPath = 'supabase/migrations/20260903225000_phase_c_live_publication_compatibility.sql';
const recoverableDeletePath = 'supabase/migrations/20260903230000_phase_c_recoverable_publication_delete.sql';
const operationsDeletePath = 'supabase/migrations/20260904133000_operations_manager_recoverable_delete.sql';
const issue207PolicyPath = 'supabase/migrations/20260914073000_issue207_final_public_delete_policy.sql';
const migration = read(migrationPath);
const compatibility = read(compatibilityPath);
const recoverableDelete = read(recoverableDeletePath);
const operationsDelete = read(operationsDeletePath);
const issue207Policy = read(issue207PolicyPath);
const feedFunction = read('netlify/functions/public-promotion-feed.mjs');
const externalContent = read('assets/js/external-content.js');
const detailScript = read('assets/js/promotion-detail.js');
const publicationAdmin = read('app/assets/phase-c-publication-admin.js');
const appUi = read('app/assets/app-ui.js');

function syntaxCheck(file) {
  execFileSync(process.execPath, ['--check', path.join(ROOT, file)], { stdio: 'pipe' });
}

test('live publication browser and Netlify modules compile', () => {
  syntaxCheck('netlify/functions/public-promotion-feed.mjs');
  syntaxCheck('assets/js/external-content.js');
  syntaxCheck('assets/js/promotion-detail.js');
  syntaxCheck('app/assets/phase-c-publication-admin.js');
});

test('final approval moves content to published while hidden content stays out of public feed', () => {
  assert.match(migration, /promotion_contents_publish_after_approval/);
  assert.match(migration, /set lifecycle = 'published'/);
  assert.match(migration, /where content\.lifecycle = 'published'/);
  assert.doesNotMatch(migration.match(/create or replace function public\.list_public_promotion_feed\(\)[\s\S]*?\$\$;/)?.[0] || '', /hidden/);
});

test('public feed exposes only public-safe RPCs to anonymous visitors', () => {
  assert.match(migration, /grant execute on function\s+public\.list_public_promotion_feed\(\),\s+public\.get_public_promotion_content\(uuid\)\s+to anon, authenticated;/s);
  assert.doesNotMatch(feedFunction, /service_role|sb_secret_|SUPABASE_SERVICE/i);
  assert.match(feedFunction, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(feedFunction, /Netlify\.env\.get/);
  assert.match(feedFunction, /get_public_promotion_content/);
  assert.match(feedFunction, /list_public_promotion_feed/);
});

test('public hub loads live feed before the existing content hub renders', () => {
  assert.match(externalContent, /typeof document !== 'undefined'/);
  assert.match(externalContent, /document\.readyState === 'loading'/);
  assert.match(externalContent, /document\.write\('<script data-live-promotion-feed src="\/\.netlify\/functions\/public-promotion-feed"/);
  assert.match(feedFunction, /window\.TAEJANG_CONTENT/);
  assert.match(feedFunction, /content\.hub\.push/);
});

test('Issue 207 retires deletion requests and caps public deletion at 24 hours', () => {
  const requestFunction = issue207Policy.match(/create or replace function public\.request_promotion_deletion[\s\S]*?\$\$;/)?.[0] || '';
  const deleteFunction = issue207Policy.match(/create or replace function public\.delete_promotion_content[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(requestFunction, /PROMOTION_DELETE_REQUEST_POLICY_RETIRED/);
  assert.match(deleteFunction, /private_actor_can\('promotion\.archive'\)/);
  assert.match(deleteFunction, /PROMOTION_PUBLIC_DELETE_WINDOW_EXPIRED/);
  assert.match(deleteFunction, /private_delete_promotion_content_pre148/);
});

test('underlying promotion delete primitive remains recoverable rather than physically destructive', () => {
  const deleteFunction = operationsDelete.match(/create or replace function public\.delete_promotion_content[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(deleteFunction, /lifecycle='archived'/);
  assert.match(deleteFunction, /decision='withdrawn'/);
  assert.match(deleteFunction, /status='cancelled'/);
  assert.match(deleteFunction, /'recoverable',true/);
  assert.match(deleteFunction, /recoverable_archive_preserved/);
  assert.doesNotMatch(deleteFunction, /delete from public\.promotion_content_revisions/i);
  assert.doesNotMatch(deleteFunction, /delete from public\.promotion_contents/i);
  assert.match(operationsDelete, /content\.lifecycle <> 'archived'/);
});

test('legacy publication queue remains compatible after immediate live publication', () => {
  const approvalCheck = compatibility.match(/create or replace function public\.promotion_revision_is_fully_approved[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(approvalCheck, /'approved'::public\.promotion_lifecycle/);
  assert.match(approvalCheck, /'published'::public\.promotion_lifecycle/);
  assert.match(approvalCheck, /'scheduled'::public\.promotion_lifecycle/);
});

test('publication admin follows the Issue 207 recent-delete window and modification escalation', () => {
  assert.match(publicationAdmin, /role === 'promotion_lead'/);
  assert.match(publicationAdmin, /lead_archive_recent_promotion_content/);
  assert.match(publicationAdmin, /24시간 내 삭제/);
  assert.match(publicationAdmin, /24시간 경과 · 삭제 불가/);
  assert.match(publicationAdmin, /운영총괄에게 수정 요청/);
  assert.match(publicationAdmin, /기타 공개글 수정 요청/);
  assert.doesNotMatch(publicationAdmin, /request_promotion_deletion/);
  assert.match(issue207Policy, /PROMOTION_DELETE_REQUEST_POLICY_RETIRED/);
  assert.match(issue207Policy, /PROMOTION_PUBLIC_DELETE_WINDOW_EXPIRED/);
  assert.match(appUi, /phase-c-publication-admin\.js/);
});

test('live detail page renders fetched content with DOM text nodes instead of raw HTML injection', () => {
  assert.match(detailScript, /\.textContent = text/);
  assert.doesNotMatch(detailScript, /innerHTML\s*=/);
  assert.match(detailScript, /public-promotion-feed\?id=/);
});
