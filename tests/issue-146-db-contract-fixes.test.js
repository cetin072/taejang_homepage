const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20260908153000_issue_146_db_contract_fixes.sql'),
  'utf8'
);

test('Issue 146 forward migration makes unassigned Employee a real DB state', () => {
  assert.match(sql, /alter table public\.employees alter column department_id drop not null/i);
  assert.match(sql, /p_department_id is not null\s+and not exists/i);
  assert.match(sql, /left join public\.departments d on d\.id=e\.department_id/i);
  assert.match(sql, /ARCHIVED_EMPLOYEE_UPDATE_FORBIDDEN/);
});

test('Issue 146 replaces the old page key check and includes the actual ESG page', () => {
  assert.match(sql, /drop constraint if exists homepage_change_requests_page_key_check/i);
  assert.match(sql, /community_esg/);
  assert.match(sql, /activity_records/);
});

test('homepage image requests restore server-side URL validation', () => {
  assert.match(sql, /promotion_validate_url\(safe_image_url,'homepage_change_request\.proposed_image_url'\)/);
  assert.match(sql, /INVALID_HOMEPAGE_IMAGE_URL/);
});
