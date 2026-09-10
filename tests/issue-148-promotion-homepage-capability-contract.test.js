const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = path => fs.readFileSync(path, 'utf8');
const promotion = [
  read('supabase/migrations/20260910110100_issue_148_promotion_capability_wrappers.sql'),
  read('supabase/migrations/20260910110200_issue_148_promotion_capability_management_wrappers.sql')
].join('\n');
const homepage = read('supabase/migrations/20260910110300_issue_148_homepage_capability_wrappers.sql');
const matrix = read('docs/operations/CAPABILITY_ACCESS_BEHAVIOR_MATRIX.md');

for (const capability of ['promotion.review_ceo', 'promotion.queue_publication', 'promotion.edit_any_unpublished', 'promotion.archive', 'promotion.restore']) {
  assert.match(promotion, new RegExp(`private_actor_can\\('${capability.replace('.', '\\.')}'\\)`), `${capability} must gate promotion RPCs`);
  assert.match(matrix, new RegExp(capability.replace('.', '\\.')), `${capability} must be represented in the behavior matrix`);
}

for (const capability of ['homepage.draft', 'homepage.review', 'homepage.approve_apply', 'homepage.direct_edit']) {
  assert.match(homepage, new RegExp(`private_actor_can\\('${capability.replace('.', '\\.')}'\\)`), `${capability} must gate homepage RPCs`);
  assert.match(matrix, new RegExp(capability.replace('.', '\\.')), `${capability} must be represented in the behavior matrix`);
}

assert.match(promotion, /private_save_promotion_draft_pre148/, 'promotion wrapper retains established implementation behind its gate');
assert.match(homepage, /private_create_homepage_slot_change_request_pre148/, 'homepage wrapper retains canonical slot implementation behind its gate');
assert.match(homepage, /promotion_validate_url/, 'homepage image requests retain server-side URL validation');
assert.doesNotMatch(homepage, /alter function public\.get_public_homepage_overrides/, 'public override read remains outside protected homepage wrappers');
assert.match(matrix, /기술 capability만/, 'matrix records that technical super-admin grants do not imply business authority');

console.log('Issue #148 promotion/homepage capability contract: PASS');
