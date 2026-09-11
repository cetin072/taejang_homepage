const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('promotion lead management UX parses and is loaded by app bootstrap', () => {
  const moduleSource = read('app/assets/promotion-approved-delete-ux.js');
  const appUi = read('app/assets/app-ui.js');
  assert.doesNotThrow(() => new Function(moduleSource));
  assert.match(appUi, /assets\/promotion-approved-delete-ux\.js/);
  assert.match(moduleSource, /setText\(heading, '홍보 관리'\)/);
  assert.match(moduleSource, /미리보기·수정·삭제·보완 요청·승인·상신/);
  assert.match(moduleSource, /promotionReviewDelete/);
  assert.match(moduleSource, /승인 완료·미발행 글/);
  assert.match(moduleSource, /원문과 수정이력은 보존/);
  assert.match(moduleSource, /renderSignature/);
});

test('promotion lead review and approved-unpublished items reuse the recoverable archive RPC', () => {
  const support = read('supabase/migrations/20260908055100_issue_146_ui_support.sql');
  const workflow = read('supabase/migrations/20260908031219_issue_146_operations_permissions_and_homepage_workflow.sql');
  const moduleSource = read('app/assets/promotion-approved-delete-ux.js');

  assert.match(moduleSource, /get_my_promotion_workspace/);
  assert.match(moduleSource, /get_unpublished_promotion_archive_candidates/);
  assert.match(moduleSource, /archive_unpublished_promotion_content/);
  assert.match(moduleSource, /\['approved', 'scheduled'\]/);
  assert.match(support, /get_unpublished_promotion_archive_candidates/);
  assert.match(support, /where content\.published_at is null/);
  assert.match(workflow, /archive_unpublished_promotion_content/);
  assert.match(workflow, /published_at is not null[\s\S]*PROMOTION_UNPUBLISHED_ARCHIVE_REQUIRES_NO_PUBLIC_HISTORY/);
  assert.doesNotMatch(moduleSource, /delete_promotion_content/);
});

test('promotion lead sidebar archive entry is merged into the review-management screen', () => {
  const moduleSource = read('app/assets/promotion-approved-delete-ux.js');
  const navSource = read('app/assets/role-navigation-priority.js');

  assert.match(moduleSource, /promotionLeadMergedNav/);
  assert.match(navSource, /current === '홍보 검토'[\s\S]*node\.textContent = '홍보 관리'/);
  assert.match(navSource, /issue146Nav === 'promotion-archive'/);
  assert.match(navSource, /cleanLabel\(node\) === '홍보 글 관리'/);
  assert.match(navSource, /items: \['홍보 관리', '홍보 작성'\]/);
});

test('external link import uses one capture handler and preserves manual fallback', () => {
  const refinement = read('app/assets/phase-c-ui-refinements.js');
  assert.doesNotThrow(() => new Function(refinement));
  assert.match(refinement, /singleFetchBound/);
  assert.match(refinement, /event\.stopImmediatePropagation\(\)/);
  assert.match(refinement, /metadata\.article_text/);
  assert.match(refinement, /!body\.value\.trim\(\)/);
  assert.match(refinement, /!title\.value\.trim\(\)/);
  assert.match(refinement, /!summary\.value\.trim\(\)/);
  assert.match(refinement, /직접 입력하면 정상적으로 저장·승인 요청/);
  assert.match(refinement, /addEventListener\('click',[\s\S]*, true\)/);
});

test('published promotion deletion policy remains outside the direct delete UX', () => {
  const workflow = read('supabase/migrations/20260908031219_issue_146_operations_permissions_and_homepage_workflow.sql');
  assert.match(workflow, /request_promotion_deletion/);
  assert.match(workflow, /interval '24 hours'/);
  assert.match(workflow, /PROMOTION_DELETE_REQUEST_REQUIRES_24_HOURS/);
});
