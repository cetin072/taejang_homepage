const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('approved unpublished promotion delete UX parses and is loaded by app bootstrap', () => {
  const moduleSource = read('app/assets/promotion-approved-delete-ux.js');
  const appUi = read('app/assets/app-ui.js');
  assert.doesNotThrow(() => new Function(moduleSource));
  assert.match(appUi, /assets\/promotion-approved-delete-ux\.js/);
  assert.match(moduleSource, /홍보글 관리/);
  assert.match(moduleSource, /승인 완료·미발행 글 관리/);
  assert.match(moduleSource, /button\.textContent = '삭제'/);
  assert.match(moduleSource, /원문과 수정이력은 보존/);
});

test('approved unpublished delete UX reuses exact existing archive RPC contract', () => {
  const support = read('supabase/migrations/20260908055100_issue_146_ui_support.sql');
  const workflow = read('supabase/migrations/20260908031219_issue_146_operations_permissions_and_homepage_workflow.sql');
  const moduleSource = read('app/assets/promotion-approved-delete-ux.js');

  assert.match(support, /get_unpublished_promotion_archive_candidates/);
  assert.match(support, /where content\.published_at is null/);
  assert.match(workflow, /archive_unpublished_promotion_content/);
  assert.match(workflow, /published_at is not null[\s\S]*PROMOTION_UNPUBLISHED_ARCHIVE_REQUIRES_NO_PUBLIC_HISTORY/);
  assert.doesNotMatch(moduleSource, /delete_promotion_content/);
});

test('published promotion deletion policy remains outside the direct delete UX', () => {
  const workflow = read('supabase/migrations/20260908031219_issue_146_operations_permissions_and_homepage_workflow.sql');
  assert.match(workflow, /request_promotion_deletion/);
  assert.match(workflow, /interval '24 hours'/);
  assert.match(workflow, /PROMOTION_DELETE_REQUEST_REQUIRES_24_HOURS/);
});
