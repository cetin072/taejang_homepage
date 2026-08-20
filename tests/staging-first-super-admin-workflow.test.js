const fs = require('node:fs'); const assert = require('node:assert/strict'); const test = require('node:test');
const source = fs.readFileSync('.github/workflows/staging-first-super-admin.yml', 'utf8');
test('staging bootstrap workflow is manual, allow-listed, and never seeds', () => {
  for (const value of ['workflow_dispatch','jgsxpdflgkqroecfjzxq','--dry-run','APPLY_STAGING_BOOTSTRAP','bootstrap_super_admin','STOP_ACTIVE_SUPER_ADMIN_EXISTS','STAGING_DB_PASSWORD','STOP_NO_BOOTSTRAP_CANDIDATE','STOP_MULTIPLE_BOOTSTRAP_CANDIDATES']) assert.match(source, new RegExp(value));
  assert.doesNotMatch(source, /target_user_id|TARGET_USER_ID/);
  assert.match(source, /candidate_count/);
  assert.match(source, /candidate_count <> 1/);
  assert.doesNotMatch(source, /echo[^\n]*(email|display_name|work_email)/i);
  assert.doesNotMatch(source, /seed-phase1|db reset|service.role|NETLIFY/i);
});
