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

test('promotion lead gets direct recoverable delete without duplicate sidebar or intro delete entry points', () => {
  const live = read('app/assets/issue-181-promotion-live-ux.js');
  const fallback = read('app/assets/promotion-approved-delete-ux.js');
  const nav = read('app/assets/role-navigation-priority.js');
  const workflow = read('supabase/migrations/20260908031219_issue_146_operations_permissions_and_homepage_workflow.sql');

  assert.match(live, /archive_unpublished_promotion_content/);
  assert.match(live, /issue181ReviewDelete/);
  assert.doesNotMatch(live, /delete_promotion_content/);
  assert.match(live, /issue181ManagementShortcuts/);
  assert.match(live, /공개글 관리/);
  assert.match(live, /미발행 글 정리/);

  assert.match(fallback, /function issue181UnifiedLeadManagement\(\)/);
  assert.match(fallback, /if \(issue181UnifiedLeadManagement\(\)\) \{[\s\S]*nav\.hidden = true/);
  assert.match(fallback, /if \(!canArchive\(\) \|\| issue181UnifiedLeadManagement\(\)\) return/);
  assert.match(nav, /'홍보 관리', '홍보 작성', '공개글 관리', '미발행 글 삭제'/);
  assert.match(workflow, /PROMOTION_UNPUBLISHED_ARCHIVE_REQUIRES_NO_PUBLIC_HISTORY/);
});

test('promotion lead review labels communicate publish, schedule, and next-review outcomes', () => {
  const live = read('app/assets/issue-181-promotion-live-ux.js');
  assert.match(live, /승인·공개/);
  assert.match(live, /승인·예약/);
  assert.match(live, /승인·다음 검토/);
  assert.match(live, /홈페이지에 즉시 공개/);
  assert.match(live, /00:00\(한국시간\)/);
});

test('link source classification separates official channels from external material and preserves manual text', () => {
  const live = read('app/assets/issue-181-promotion-live-ux.js');
  const workspace = read('app/assets/phase-c-workspace-v2.js');

  for (const value of ['taejang_homepage', 'taejang_blog', 'taejang_youtube', 'external']) {
    assert.match(live, new RegExp(value));
  }
  assert.match(live, /blog\.naver\.com/);
  assert.match(live, /taejang-official/);
  assert.match(live, /taejangofficial/);
  assert.match(live, /previousTitle/);
  assert.match(live, /previousBody/);
  assert.match(live, /외부 기사·자료는 원문 전체를 복사하지 않습니다/);
  assert.match(live, /set_promotion_link_source/);
  assert.match(live, /addEventListener\('click',[\s\S]*true\)/);

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
  const workspace = read('app/assets/phase-c-workspace-v2.js');
  assert.match(workspace, /homepage\.draft/);
  assert.match(workspace, /homepage\.review/);
  assert.match(workspace, /homepage\.approve_apply/);
  assert.match(workspace, /currentRoute === 'operations_manager'/);
  assert.match(workspace, /운영총괄에게 수정 요청/);
  assert.match(workspace, /최종 승인/);
});

test('published promotion deletion policy remains outside the direct unpublished delete UX', () => {
  const workflow = read('supabase/migrations/20260908031219_issue_146_operations_permissions_and_homepage_workflow.sql');
  assert.match(workflow, /request_promotion_deletion/);
  assert.match(workflow, /interval '24 hours'/);
  assert.match(workflow, /PROMOTION_DELETE_REQUEST_REQUIRES_24_HOURS/);
});