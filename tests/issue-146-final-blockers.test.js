'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'supabase/migrations/20260908100000_issue_146_ops_draft_and_safe_restore.sql'), 'utf8');

test('Issue #146 operations edit preserves lower-role ownership and published recovery is hidden', () => {
  assert.match(source, /editing_other_owner := content_row\.owner_profile_id <> actor_id/);
  assert.doesNotMatch(source, /OPERATIONS_PROMOTION_DRAFT_NOT_OWNER/);
  assert.match(source, /values\(content_row\.id,next_revision_no,actor_id/);
  assert.match(source, /operations_promotion_draft_edited_for_owner/);
  assert.match(source, /previous_lifecycle in \('published','hidden'\) then 'hidden'/);
  assert.match(source, /explicit_republish_required/);
});
