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
const migration = read(migrationPath);
const compatibility = read(compatibilityPath);
const recoverableDelete = read(recoverableDeletePath);
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

test('promotion lead can hide and request deletion while delete requires operations plus super-admin', () => {
  assert.match(migration, /current_user_is_promotion_lead\(\) or public\.current_user_has_role\('operations_manager'\)/);
  assert.match(migration, /request_promotion_deletion/);
  assert.match(migration, /not public\.current_user_is_promotion_lead\(\)/);
  const deleteFunction = recoverableDelete.match(/create or replace function public\.delete_promotion_content[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(deleteFunction, /current_user_has_role\('operations_manager'\)/);
  assert.match(deleteFunction, /current_user_has_role\('super_admin'\)/);
  assert.match(deleteFunction, /PROMOTION_DELETE_TITLE_CONFIRMATION_MISMATCH/);
  assert.doesNotMatch(deleteFunction, /promotion_lead/);
});

test('user-facing delete archives the article instead of physically destroying history', () => {
  const deleteFunction = recoverableDelete.match(/create or replace function public\.delete_promotion_content[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(deleteFunction, /set lifecycle = 'archived'/);
  assert.match(deleteFunction, /'recoverable', true/);
  assert.match(deleteFunction, /recoverable_archive_preserved/);
  assert.doesNotMatch(deleteFunction, /delete from public\.promotion_content_revisions/i);
  assert.doesNotMatch(deleteFunction, /delete from public\.promotion_contents/i);
});

test('legacy publication queue remains compatible after immediate live publication', () => {
  const approvalCheck = compatibility.match(/create or replace function public\.promotion_revision_is_fully_approved[\s\S]*?\$\$;/)?.[0] || '';
  assert.match(approvalCheck, /'approved'::public\.promotion_lifecycle/);
  assert.match(approvalCheck, /'published'::public\.promotion_lifecycle/);
  assert.match(approvalCheck, /'scheduled'::public\.promotion_lifecycle/);
});

test('publication admin never offers delete unless the server grants highest-authority delete', () => {
  assert.match(publicationAdmin, /role === 'promotion_lead'/);
  assert.match(publicationAdmin, /삭제 요청/);
  assert.match(publicationAdmin, /data\?\.can_permanently_delete === true/);
  assert.match(publicationAdmin, /role === 'operations_manager' && canDelete/);
  assert.match(publicationAdmin, /내부 복구용 기록은 보존/);
  assert.match(appUi, /phase-c-publication-admin\.js/);
});

test('live detail page renders fetched content with DOM text nodes instead of raw HTML injection', () => {
  assert.match(detailScript, /\.textContent = text/);
  assert.doesNotMatch(detailScript, /innerHTML\s*=/);
  assert.match(detailScript, /public-promotion-feed\?id=/);
});
