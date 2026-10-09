'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, 'payroll-hosted-e2e.mjs'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/payroll-hosted-staging-e2e.yml'), 'utf8');

test('hosted payroll E2E is staging-locked, reuses QA sessions, and performs cheap API checks before Chromium', () => {
  assert.match(source, /STAGING_REF = 'jgsxpdflgkqroecfjzxq'/);
  assert.match(source, /STAGING_CONFIRM !== 'STAGING'/);
  assert.match(source, /web-auth-handoff/);
  assert.match(source, /PAYROLL_HOSTED_HANDOFF_CODE/);
  assert.match(source, /token_hash/);
  assert.match(source, /await apiSmoke\(config, smokeSession\);[\s\S]*await browserE2E/);
  assert.match(source, /unpaid_absence/);
  assert.match(source, /auto_decision/);
  assert.match(source, /absence_day_count/);
  assert.match(source, /calculation\?\.persisted/);
  assert.match(source, /calculation\?\.runId/);
  assert.match(source, /waitForEvent\('download'\)/);
  assert.match(source, /payslip-content/);
  assert.doesNotMatch(source, /video:|trace:/);
  assert.doesNotMatch(source, /PAYROLL_HOSTED_OPERATOR_SESSION_FILE/);
});


test('hosted payroll workflow preserves an active role simulation around QA', () => {
  assert.match(workflow, /PAYROLL_HOSTED_SIMULATION_WAS_ACTIVE/);
  assert.match(workflow, /delete from public\.role_simulation_modes/);
  assert.match(workflow, /Restore pre-test role simulation state/);
  assert.match(workflow, /if: always\(\) && env\.PAYROLL_HOSTED_SIMULATION_WAS_ACTIVE == 'true'/);
  assert.match(workflow, /not exists\(select 1 from public\.role_simulation_modes/);
  assert.match(workflow, /expires_at[\s\S]*> now\(\)/);
  assert.doesNotMatch(workflow, /delete from public\.profile_roles/);
  assert.doesNotMatch(workflow, /delete from auth\.users/);
});


test('hosted payroll manual run requires explicit operator, approval, and exact reviewed PR Preview', () => {
  const triggers = workflow.slice(workflow.indexOf('on:\n'), workflow.indexOf('\npermissions:'));
  assert.match(triggers, /^  workflow_dispatch:/m);
  assert.doesNotMatch(triggers, /^  (?:pull_request|pull_request_target|push|schedule|workflow_run|repository_dispatch):/m);
  assert.match(workflow, /github\.actor == 'cetin072'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /inputs\.staging_write_approval == 'APPROVE_STAGING_PAYROLL_WRITE'/);
  assert.match(workflow, /STOP_UNAPPROVED_DISPATCH/);
  assert.match(workflow, /STOP_STAGING_WRITE_NOT_APPROVED/);
  assert.match(workflow, /STOP_STALE_PR_OR_UNTRUSTED_HEAD/);
  assert.match(workflow, /STOP_EXACT_HEAD_PREVIEW_NOT_READY/);
  assert.match(workflow, /\.head\.repo\.full_name == \$repo and \.head\.sha == \$sha/);
  assert.match(workflow, /netlify\/taejang-homepage\/deploy-preview/);
  const approvalGate = workflow.indexOf('- name: Verify explicit approval');
  const firstWrite = workflow.indexOf('- name: Create one-time active top-authority handoff');
  assert.ok(approvalGate >= 0 && firstWrite > approvalGate, 'no Staging Auth/payroll write before manual preflight');
  assert.match(workflow, /PAYROLL_HOSTED_PREVIEW_SITE/);
  assert.match(workflow, /deploy-preview-\{0\}--taejang-homepage\.netlify\.app/);
  assert.match(workflow, /inputs\.reviewed_pr_number/);
  assert.match(source, /BROWSER_SITE = process\.env\.PAYROLL_HOSTED_PREVIEW_SITE \|\| SITE/);
  assert.match(source, /EXACT_HEAD_PREVIEW_NOT_READY/);
});
