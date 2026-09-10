const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const identity = read('supabase/migrations/20260908054000_issue_146_identity_account_recovery.sql');
const homepage = read('supabase/migrations/20260908055000_issue_146_homepage_live_workflow.sql');
const cleanup = read('supabase/migrations/20260908153600_issue_146_registry_and_scope_cleanup.sql');

test('Issue 146 models unassigned Employee explicitly without widening existing-record reads', () => {
  assert.match(identity, /alter column department_id drop not null/i);
  assert.match(identity, /p_department_id is not null[\s\S]*INVALID_DEPARTMENT/i);
  assert.match(identity, /left join public\.departments department on department\.id = e\.department_id/i);
  assert.match(cleanup, /e\.department_id=actor_department/);
  assert.match(cleanup, /promotion_lead_global/);
  assert.doesNotMatch(cleanup, /employee_scope_all/);
});

test('canonical homepage edit boundary is the page-section-field slot registry', () => {
  assert.match(homepage, /create table if not exists public\.homepage_content_slots/);
  assert.match(homepage, /field_key text not null/);
  assert.match(homepage, /community_esg\.hero\.title/);
  assert.match(homepage, /create_homepage_slot_change_request/);
  assert.match(homepage, /promotion_validate_url\(proposed_image, 'proposed_image_url'\)/);
  assert.match(cleanup, /drop constraint if exists homepage_change_requests_page_key_check/);
  assert.match(cleanup, /drop constraint if exists homepage_change_requests_page_section_allowlist/);
});

test('legacy homepage request RPC cannot bypass the canonical slot workflow', () => {
  assert.match(cleanup, /revoke all on function public\.create_homepage_change_request\(text,text,text,text,text,text,text,text\)/);
  assert.match(cleanup, /from public, anon, authenticated/);
});

test('ordinary employee update remains blocked for archived employees', () => {
  assert.match(identity, /EMPLOYEE_ARCHIVED_RESTORE_FIRST/);
});
