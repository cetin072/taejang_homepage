'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
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

test('manual preflight executes fail-closed before any hosted write, including API and stale Preview failures', () => {
  const preflight = workflow.match(/- name: Verify explicit approval[\s\S]*?run: \|\n([\s\S]*?)(?=      - uses:)/)?.[1]
    .replace(/^          /gm, '');
  assert.ok(preflight, 'execute the real workflow preflight, not a copied decision function');
  assert.doesNotMatch(preflight, /supabase|read_only:false|--request POST|--data-binary/);
  const sha = 'a'.repeat(40), repo = 'cetin072/taejang_homepage';
  const expectedPreview = 'https://deploy-preview-525--taejang-homepage.netlify.app';
  const validPR = {state:'open',base:{ref:'main'},head:{sha,repo:{full_name:repo}}};
  const validStatus = {statuses:[{context:'netlify/taejang-homepage/deploy-preview',state:'success',target_url:expectedPreview}]};
  const cases = [
    ['valid reviewed Preview', {}, validPR, validStatus, 0, 2],
    ['PR event', {GITHUB_EVENT_NAME:'pull_request'}, validPR, validStatus, 1, 0],
    ['wrong operator', {GITHUB_ACTOR:'another-actor'}, validPR, validStatus, 1, 0],
    ['wrong branch', {GITHUB_REF:'refs/heads/unreviewed'}, validPR, validStatus, 1, 0],
    ['wrong repository', {GITHUB_REPOSITORY:'another/repo'}, validPR, validStatus, 1, 0],
    ['denied approval', {STAGING_WRITE_APPROVAL:'DENY'}, validPR, validStatus, 1, 0],
    ['invalid PR number', {REVIEWED_PR_NUMBER:'525;exit 0'}, validPR, validStatus, 1, 0],
    ['invalid HEAD', {REVIEWED_HEAD_SHA:'a'.repeat(39)}, validPR, validStatus, 1, 0],
    ['stale HEAD', {}, {...validPR,head:{...validPR.head,sha:'b'.repeat(40)}}, validStatus, 1, 1],
    ['closed PR', {}, {...validPR,state:'closed'}, validStatus, 1, 1],
    ['external PR', {}, {...validPR,head:{...validPR.head,repo:{full_name:'another/repo'}}}, validStatus, 1, 1],
    ['unready Preview', {}, validPR, {statuses:[{...validStatus.statuses[0],state:'pending'}]}, 1, 2],
    ['wrong Preview', {}, validPR, {statuses:[{...validStatus.statuses[0],target_url:expectedPreview+'-wrong'}]}, 1, 2],
    ['API failure', {FIXTURE_API_FAIL:'true'}, validPR, validStatus, 22, 1],
  ];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'taejang-manual-preflight-'));
  try {
    for (const [label,overrides,pr,status,exit,calls] of cases) {
      const log = path.join(temp,'requests');fs.writeFileSync(log,'');
      const shell = `curl() {
        printf '%s\\n' "\${!#}" >> "$FIXTURE_REQUEST_LOG"
        if [[ "\${FIXTURE_API_FAIL:-}" == true ]]; then return 22; fi
        case "\${!#}" in
          https://api.github.com/repos/cetin072/taejang_homepage/pulls/525) printf '%s' "$FIXTURE_PR" ;;
          https://api.github.com/repos/cetin072/taejang_homepage/commits/*/status) printf '%s' "$FIXTURE_STATUS" ;;
          *) echo 'unexpected network target' >&2; return 99 ;;
        esac
      }\n` + preflight;
      const result = spawnSync('bash',['-c',shell],{encoding:'utf8',env:{...process.env,
        GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:repo,GITHUB_REF:'refs/heads/main',GITHUB_ACTOR:'cetin072',
        STAGING_WRITE_APPROVAL:'APPROVE_STAGING_PAYROLL_WRITE',REVIEWED_PR_NUMBER:'525',REVIEWED_HEAD_SHA:sha,GH_READ_TOKEN:'synthetic',
        FIXTURE_PR:JSON.stringify(pr),FIXTURE_STATUS:JSON.stringify(status),FIXTURE_REQUEST_LOG:log,...overrides}});
      assert.equal(result.status,exit,label+': '+result.stderr);
      assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).length,calls,label+' read-only API count');
      if(exit===0)assert.match(result.stdout,/PASS manual authorization/);
      else assert.doesNotMatch(result.stdout,/writes may begin/);
    }
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});
