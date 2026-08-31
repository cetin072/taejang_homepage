const fs = require('node:fs'); const assert = require('node:assert/strict'); const test = require('node:test');
const source = fs.readFileSync('.github/workflows/staging-first-super-admin.yml', 'utf8');
test('staging bootstrap workflow is manual, allow-listed, and never seeds', () => {
  for (const value of ['workflow_dispatch','jgsxpdflgkqroecfjzxq','supabase link --project-ref','supabase db push --dry-run','APPLY_STAGING_BOOTSTRAP','bootstrap_super_admin','STOP_ACTIVE_SUPER_ADMIN_EXISTS','STAGING_DB_PASSWORD','SUPABASE_DB_PASSWORD','STOP_NO_BOOTSTRAP_CANDIDATE','STOP_MULTIPLE_BOOTSTRAP_CANDIDATES','https://api.supabase.com/v1/projects/${STAGING_PROJECT_REF}/database/query']) assert.match(source, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, /target_user_id|TARGET_USER_ID/);
  assert.match(source, /candidate_count/);
  assert.match(source, /candidate_count <> 1/);
  assert.match(source, /read_only: true/);
  assert.match(source, /read_only: false/);
  assert.doesNotMatch(source, /supabase db push --project-ref|\bpsql\b|host=db\./i);
  assert.doesNotMatch(source, /echo[^\n]*(email|display_name|work_email)/i);
  assert.doesNotMatch(source, /seed-phase1|db reset|service.role|NETLIFY/i);
});
