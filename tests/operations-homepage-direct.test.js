const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const appUi = read('app/assets/app-ui.js');
const editor = read('app/assets/operations-homepage-direct.js');
const writer = read('app/assets/operations-promotion-writer.js');
const publicClient = read('assets/js/homepage-live-overrides.js');
const photoSlots = read('assets/js/photo-slots.js');
const publicFunction = read('netlify/functions/public-homepage-overrides.mjs');
const migration = read('supabase/migrations/20260904021000_operations_manager_direct_homepage_overrides.sql');
const authoringMigration = read('supabase/migrations/20260904023000_operations_manager_optional_promotion_authoring.sql');

test('operations optional tools are loaded and scripts parse', () => {
  assert.match(appUi, /operations-promotion-writer\.js/);
  assert.match(appUi, /operations-homepage-direct\.js/);
  assert.doesNotThrow(() => new Function(editor));
  assert.doesNotThrow(() => new Function(writer));
  assert.doesNotThrow(() => new Function(publicClient));
});

test('operations homepage editor remains a secondary sidebar tool', () => {
  assert.match(editor, /route\(\) !== 'operations_manager'/);
  assert.match(editor, /홈페이지 직접 수정/);
  assert.match(editor, /메인 글 수정/);
  assert.match(editor, /메인 링크 수정/);
  assert.match(editor, /메인 사진 수정/);
  assert.match(editor, /data-operations-homepage-direct/);
  assert.doesNotMatch(editor, /dashboard-card[^\n]*홈페이지 직접 수정/);
});

test('operations can optionally author posts and external links but submission still enters lead review', () => {
  assert.match(writer, /route\(\) !== 'operations_manager'/);
  assert.match(writer, /홍보 글 작성/);
  assert.match(writer, /태장 소식/);
  assert.match(writer, /외부 기사·콘텐츠/);
  assert.match(writer, /save_operations_promotion_draft/);
  assert.match(writer, /submit_operations_promotion_revision/);
  assert.match(writer, /기존 운영팀장 검토 흐름/);
  assert.match(authoringMigration, /current_user_has_role\('operations_manager'\)/);
  assert.match(authoringMigration, /insert into public\.promotion_review_requests[\s\S]*values \(revision_row\.id, 'lead', actor_id\)/);
  assert.doesNotMatch(authoringMigration, /set lifecycle = 'published'/);
});

test('operations image upload remains own-folder only and does not grant anon upload', () => {
  assert.match(authoringMigration, /bucket_id = 'promotion-media'/);
  assert.match(authoringMigration, /storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/);
  assert.match(authoringMigration, /or public\.current_user_has_role\('operations_manager'\)/);
  assert.doesNotMatch(authoringMigration, /create policy "promotion media upload"[\s\S]*to anon/);
});

test('direct editor is allow-listed, audited and reversible at the database boundary', () => {
  assert.match(migration, /current_user_has_role\('operations_manager'\)/);
  assert.match(migration, /INVALID_HOMEPAGE_DIRECT_SLOT/);
  assert.match(migration, /homepage_live_override_saved/);
  assert.match(migration, /homepage_live_override_deleted/);
  assert.match(migration, /delete_homepage_live_override/);
  for (const slot of [
    'home.hero.title', 'home.hero.primary_link',
    'home.photo.02', 'home.photo.03', 'home.photo.04', 'home.photo.05', 'home.photo.06'
  ]) assert.match(migration, new RegExp(slot.replaceAll('.', '\\.')));
});

test('direct write functions are not callable anonymously while public read exposes only safe fields', () => {
  assert.match(migration, /revoke all on function public\.save_homepage_live_override[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.save_homepage_live_override[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.save_homepage_live_override[^;]*to anon/);
  assert.match(migration, /grant execute on function public\.get_public_homepage_overrides\(\) to anon, authenticated/);
  const publicRpc = migration.slice(migration.indexOf('create or replace function public.get_public_homepage_overrides'));
  assert.doesNotMatch(publicRpc.split('$$;')[0], /updated_by_profile_id|display_name|email/);
});

test('operations authoring RPCs are authenticated-only and internally authorize operations role', () => {
  assert.match(authoringMigration, /revoke all on function public\.save_operations_promotion_draft[\s\S]*from public, anon, authenticated/);
  assert.match(authoringMigration, /grant execute on function public\.save_operations_promotion_draft[\s\S]*to authenticated/);
  assert.doesNotMatch(authoringMigration, /grant execute on function public\.save_operations_promotion_draft[^;]*to anon/);
  assert.match(authoringMigration, /OPERATIONS_PROMOTION_DRAFT_FORBIDDEN/);
  assert.match(authoringMigration, /OPERATIONS_PROMOTION_SUBMIT_FORBIDDEN/);
});

test('public homepage applies overrides without arbitrary HTML injection', () => {
  assert.match(publicClient, /\.netlify\/functions\/public-homepage-overrides/);
  assert.match(publicClient, /document\.createTextNode/);
  assert.match(publicClient, /home\.photo\.02/);
  assert.match(publicClient, /home\.photo\.06/);
  assert.doesNotMatch(publicClient, /innerHTML|insertAdjacentHTML|outerHTML/);
});

test('live override loader runs after static photo-slot setup and keeps static fallback', () => {
  const slotSetup = photoSlots.indexOf("document.querySelectorAll('[data-photo-slot]')");
  const loader = photoSlots.indexOf("script.src = 'assets/js/homepage-live-overrides.js'");
  assert.ok(slotSetup >= 0 && loader > slotSetup, 'live overrides must load after photo slots are prepared');
  assert.match(photoSlots, /page === 'index\.html'/);
  assert.match(publicClient, /Static homepage remains the fallback/);
});

test('public override Netlify function uses only publishable Supabase credentials', () => {
  assert.match(publicFunction, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(publicFunction, /get_public_homepage_overrides/);
  assert.doesNotMatch(publicFunction, /SERVICE_ROLE|SUPABASE_SECRET|service_role/);
  assert.match(publicFunction, /'Cache-Control': 'no-store, max-age=0'/);
});

test('editor requires confirmation and offers reset to coded defaults', () => {
  assert.match(editor, /홈페이지에 바로 반영/);
  assert.match(editor, /window\.confirm\('이 변경을 홈페이지에 바로 반영할까요\?'\)/);
  assert.match(editor, /기본값으로 되돌리기/);
  assert.match(editor, /delete_homepage_live_override/);
  assert.match(editor, /사진 설명은 필수/);
});
