const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const publicWorkflow = read('.github/workflows/public-homepage-checks.yml');
const phaseWorkflow = read('.github/workflows/phase1a-supabase-integration.yml');
const manifest = read('scripts/test-manifest.mjs');

test('required PR check workflows always create a check for main pull requests', () => {
  for (const [name, source] of [['public', publicWorkflow], ['phase1a', phaseWorkflow]]) {
    assert.match(source, /pull_request:\s*\n\s*branches: \[main\]/, `${name} workflow must run for main pull requests`);
    assert.doesNotMatch(source, /\n\s+paths:\s*\n/, `${name} workflow must not use PR path filters that can leave required checks pending`);
  }
  assert.match(publicWorkflow, /name: Public source and launch regression/);
  assert.match(phaseWorkflow, /name: Migration, pgTAP, Auth and RLS/);
});

test('Phase 1A uses a shared change classifier and preserves full security checks', () => {
  assert.match(phaseWorkflow, /node scripts\/ci-change-scope\.mjs/);
  assert.match(phaseWorkflow, /fetch-depth: 0/);
  assert.match(phaseWorkflow, /supabase db lint --level error --fail-on error/);
  assert.match(phaseWorkflow, /if: steps\.scope\.outputs\.run_full == 'true'/);
  assert.match(phaseWorkflow, /if: always\(\) && steps\.scope\.outputs\.run_full == 'true'/);
});

test('required workflows consume the centralized active test manifest', () => {
  assert.match(phaseWorkflow, /node scripts\/run-test-group\.mjs platformStatic/);
  assert.match(phaseWorkflow, /node scripts\/run-test-group\.mjs stagingSafety/);
  assert.match(publicWorkflow, /node scripts\/run-test-group\.mjs publicHomepage/);
  assert.match(phaseWorkflow, /attendance-auth-integration\.mjs/);
  assert.match(manifest, /promotion-approved-delete-ux\.test\.js/);
  assert.match(manifest, /worker-mobile-attendance\.test\.js/);
  assert.match(manifest, /issue-146-final-blockers\.test\.js/);
  assert.match(manifest, /business-section-hierarchy\.test\.js/);
  assert.match(manifest, /community-esg\.test\.js/);
  assert.match(manifest, /content-detail-thumbnail\.test\.js/);
  assert.match(manifest, /hero-video-slider\.test\.js/);
  assert.match(manifest, /first-super-admin-bootstrap\.test\.js/);
  assert.match(manifest, /staging-safety-runtime\.test\.mjs/);
});

// The notification job must not start a second identical database; its full
// auth and SQL coverage stays in the required Phase 1A integration job.
test('notification DB integration has one required workflow owner', () => {
  const notification = read('.github/workflows/notification-push.yml');
  assert.match(notification, /branches: \[main\]/);
  assert.doesNotMatch(notification, /supabase start|supabase db reset|setup-cli/);
  assert.match(notification, /notification-push-dispatch\.test\.mjs/);
  assert.match(notification, /notification-push-canary-draft\.test\.mjs/);
  assert.match(phaseWorkflow, /notification-push-auth-integration\.mjs/);
  assert.match(phaseWorkflow, /supabase test db supabase\/tests\/database\/\*\.test\.sql/);
});
