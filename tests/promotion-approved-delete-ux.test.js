const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('issue 181 promotion hardening is loaded after the live workspace and targets live DOM contracts', () => {
  const live = read('app/assets/issue-181-promotion-live-ux.js');
  const workspace = read('app/assets/phase-c-workspace-v2.js');
  const appUi = read('app/assets/app-ui.js');

  assert.doesNotThrow(() => new Function(live));
  assert.match(appUi, /assets\/phase-c-workspace-v2\.js/);
  assert.match(appUi, /assets\/issue-181-promotion-live-ux\.js/);
  assert.ok(appUi.indexOf('assets/phase-c-workspace-v2.js') < appUi.indexOf('assets/issue-181-promotion-live-ux.js'));

  assert.match(workspace, /phase-c-v2-grid/);
  assert.match(workspace, /phase-c-v2-card/);
  assert.match(workspace, /quick-links/);
  assert.match(live, /:scope > \.phase-c-v2-grid/);
  assert.match(live, /\.phase-c-v2-card/);
  assert.match(live, /\.quick-links/);
  assert.doesNotMatch(live, /data-pilot-review-section|pilot-review-card|pilot-review-actions/);
});

test('promotion recovery stays out of the active sidebar and review intro', () => {
  const deleteUx = read('app/assets/promotion-approved-delete-ux.js');
  const master = read('app/assets/role-navigation-priority.js');
  const live = read('app/assets/issue-181-promotion-live-ux.js');
  assert.match(deleteUx, /function syncNavigation\(\)[\s\S]*Compatibility no-op/);
  assert.match(deleteUx, /function syncReviewEntry\(\)[\s\S]*promotion-approved-delete-entry/);
  const activeMaster = master.slice(master.indexOf('const MASTER_ORDER'), master.indexOf('const DESKTOP_ROLES'));
  assert.doesNotMatch(activeMaster, /홍보글 관리·복구/);
  assert.doesNotMatch(live, /미발행 글 정리/);
});

test('canonical review renderer keeps approval separate from publication management', () => {
  const live = read('app/assets/issue-181-promotion-live-ux.js');
  const workspace = read('app/assets/phase-c-workspace-v2.js');
  assert.match(workspace, /최종 승인/);
  assert.match(workspace, /승인·운영총괄 검토/);
  assert.match(workspace, /승인·대표이사 검토/);
  assert.match(workspace, /detail\.required_stage === 'lead'[\s\S]*운영총괄 상신/);
  assert.match(workspace, /detail\.required_stage !== 'ceo'[\s\S]*대표이사 상신/);
  assert.match(live, /공개와 예약은 별도 발행 관리/);
  assert.doesNotMatch(live, /승인·공개|승인·예약|홈페이지에 즉시 공개/);
});

test('link source classification uses the shared official-channel config and preserves manual text', () => {
  const live = read('app/assets/issue-181-promotion-live-ux.js');
  const config = read('app/assets/official-channel-config.js');
  const workspace = read('app/assets/phase-c-workspace-v2.js');

  for (const value of ['taejang_homepage', 'taejang_blog', 'taejang_youtube', 'external']) {
    assert.match(live, new RegExp(value));
  }
  assert.match(live, /TaejangOfficialChannels\?\.classifyUrl/);
  assert.match(config, /blog\.naver\.com/);
  assert.match(config, /taejang-official/);
  assert.match(config, /taejangofficial/);
  assert.match(live, /previousTitle/);
  assert.match(live, /previousBody/);
  assert.match(live, /finalSourceType/);
  assert.match(live, /refreshAutomaticSourceClassification/);
  assert.match(live, /taejang-external-meta-observed/);
  assert.match(live, /외부 기사·자료는 원문 전체를 복사하지 않습니다/);
  assert.match(live, /set_promotion_link_source/);
  assert.match(live, /addEventListener\('click',[\s\S]*true\)/);
  assert.match(config, /const payload = await response\.clone\(\)\.json\(\)/);

  const fetchCalls = (workspace.match(/fetchExternalMeta\(external\.value\.trim\(\)\)/g) || []).length;
  assert.equal(fetchCalls, 1, 'live workspace must issue a single metadata fetch per import click');
});

test('promotion source type and future-date scheduling are durable server contracts', () => {
  const migration = read('supabase/migrations/20260912112000_issue_181_promotion_source_and_schedule.sql');

  assert.match(migration, /add column if not exists link_source_type/);
  assert.match(migration, /set_promotion_link_source/);
  assert.match(migration, /get_promotion_link_source/);
  assert.match(migration, /requested_date > \(now\(\) at time zone 'Asia\/Seoul'\)::date/);
  assert.match(migration, /set lifecycle = 'scheduled'/);
  assert.match(migration, /scheduled_at := requested_date::timestamp at time zone 'Asia\/Seoul'/);
  assert.match(migration, /private_publish_due_promotions/);
  assert.match(migration, /queue\.scheduled_for <= now\(\)/);
  assert.match(migration, /content\.lifecycle = 'scheduled'/);
  assert.match(migration, /set lifecycle = 'published'/);
  assert.match(migration, /link_source_type text/);
});

test('public feed labels official homepage blog youtube and external links distinctly', () => {
  const feed = read('netlify/functions/public-promotion-feed.mjs');
  assert.doesNotThrow(() => new Function(feed.replace('export default async', 'const handler = async')));
  assert.match(feed, /태장 홈페이지에서 보기/);
  assert.match(feed, /태장 공식 블로그에서 보기/);
  assert.match(feed, /태장 공식 유튜브에서 보기/);
  assert.match(feed, /원문 보기/);
  assert.match(feed, /link_source_type/);
});

test('homepage major-section publication boundary remains operations-manager final', () => {
  const homepage = read('app/assets/issue-146-end-to-end.js');
  const capability = read('supabase/migrations/20260910110300_issue_148_homepage_capability_wrappers.sql');
  assert.match(capability, /private_actor_can\('homepage\.draft'\)/);
  assert.match(capability, /private_actor_can\('homepage\.review'\)/);
  assert.match(capability, /private_actor_can\('homepage\.approve_apply'\)/);
  assert.match(homepage, /currentRoute === 'operations_manager'/);
  assert.match(homepage, /운영총괄에게 상신/);
  assert.match(homepage, /승인하고 공개 반영/);
});

test('published promotion deletion policy remains outside the direct unpublished delete UX', () => {
  const workflow = read('supabase/migrations/20260908031219_issue_146_operations_permissions_and_homepage_workflow.sql');
  assert.match(workflow, /request_promotion_deletion/);
  assert.match(workflow, /interval '24 hours'/);
  assert.match(workflow, /PROMOTION_DELETE_REQUEST_REQUIRES_24_HOURS/);
});


test('operations manager has separate archive and archived-only permanent delete authority', () => {
  const cleanup = read('supabase/migrations/20261006145500_operations_promotion_archive_purge.sql');
  const publication = read('app/assets/phase-c-publication-admin.js');
  const workspace = read('app/assets/phase-c-workspace-v2.js');
  const issue146 = read('app/assets/issue-146-end-to-end.js');

  assert.match(cleanup, /create or replace function public\.archive_promotion_content/);
  assert.match(cleanup, /private_delete_promotion_content_pre148/);
  assert.match(cleanup, /current_user_has_role\('operations_manager'\)/);
  assert.match(cleanup, /create or replace function public\.permanently_delete_archived_promotion_content/);
  assert.match(cleanup, /PROMOTION_PERMANENT_DELETE_REQUIRES_ARCHIVED/);
  assert.match(cleanup, /p_confirmation[\s\S]*'영구삭제'/);
  assert.match(cleanup, /promotion_content_permanently_deleted/);
  assert.match(cleanup, /delete from public\.promotion_content_revisions/);
  assert.match(cleanup, /delete from public\.promotion_contents/);

  assert.match(workspace, /button\('삭제\(보관\)'/);
  assert.match(workspace, /archive_promotion_content/);
  assert.match(workspace, /보관함·영구삭제/);

  assert.match(publication, /role === 'operations_manager'/);
  assert.match(publication, /button\('삭제\(보관\)'/);
  assert.match(publication, /archive_promotion_content/);
  assert.match(publication, /보관함·영구삭제/);

  assert.match(issue146, /button\('영구삭제'/);
  assert.match(issue146, /permanently_delete_archived_promotion_content/);
  assert.match(issue146, /복구할 수 없습니다/);
});
