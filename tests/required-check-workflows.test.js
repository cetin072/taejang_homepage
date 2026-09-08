const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const publicWorkflow = read('.github/workflows/public-homepage-checks.yml');
const phaseWorkflow = read('.github/workflows/phase1a-supabase-integration.yml');

test('required PR check workflows always create a check for main pull requests', () => {
  for (const [name, source] of [['public', publicWorkflow], ['phase1a', phaseWorkflow]]) {
    assert.match(source, /pull_request:\s*\n\s*branches: \[main\]/, `${name} workflow must run for main pull requests`);
    assert.doesNotMatch(source, /\n\s+paths:\s*\n/, `${name} workflow must not use PR path filters that can leave required checks pending`);
  }
  assert.match(publicWorkflow, /name: Public source and launch regression/);
  assert.match(phaseWorkflow, /name: Migration, pgTAP, Auth and RLS/);
});

test('Phase 1A keeps an always-present lightweight result while gating expensive Supabase work', () => {
  assert.match(phaseWorkflow, /Decide whether full platform integration is relevant/);
  assert.match(phaseWorkflow, /fetch-depth: 0/);
  assert.match(phaseWorkflow, /run_full=false/);
  assert.match(phaseWorkflow, /No Phase 1A platform-sensitive files changed/);
  assert.match(phaseWorkflow, /supabase db lint --level error --fail-on error/);
  assert.match(phaseWorkflow, /if: steps\.scope\.outputs\.run_full == 'true'/);
  assert.match(phaseWorkflow, /if: always\(\) && steps\.scope\.outputs\.run_full == 'true'/);
});
