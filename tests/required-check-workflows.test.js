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

test('Phase 1A uses a docs-only skip instead of a sensitive-path allow-list', () => {
  assert.match(phaseWorkflow, /Decide whether full platform integration is relevant/);
  assert.match(phaseWorkflow, /fetch-depth: 0/);
  assert.match(phaseWorkflow, /non_docs=/);
  assert.match(phaseWorkflow, /Documentation-only change/);
  assert.match(phaseWorkflow, /run_full=false/);
  assert.match(phaseWorkflow, /run_full=true/);
  assert.match(phaseWorkflow, /supabase db lint --level error --fail-on error/);
  assert.match(phaseWorkflow, /if: steps\.scope\.outputs\.run_full == 'true'/);
  assert.match(phaseWorkflow, /if: always\(\) && steps\.scope\.outputs\.run_full == 'true'/);
  assert.doesNotMatch(phaseWorkflow, /grep -Eq '\^\(/, 'Phase 1A must not return to a hand-maintained sensitive-path allow-list');
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
