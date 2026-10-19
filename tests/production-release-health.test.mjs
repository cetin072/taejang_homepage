import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRequiredRun, databaseReadiness, publicDeployReady } from '../scripts/production-release-health.mjs';
import { reportReleaseFailure } from '../scripts/production-release-report.mjs';

const expected = { sha: 'a'.repeat(40), pr: 480, job: 'Migration, pgTAP, Auth and RLS' };
const run = { event: 'pull_request', head_sha: expected.sha, pull_requests: [{ number: 480 }], status: 'completed', conclusion: 'success' };
const jobs = [{ head_sha: expected.sha, name: expected.job, status: 'completed', conclusion: 'success' }];

test('real Issue 438: dispatch success never substitutes for approval-required PR checks', () => {
  assert.equal(classifyRequiredRun({ ...run, event: 'workflow_dispatch' }, jobs, expected), 'REQUIRED_CI_WRONG_SOURCE');
  assert.equal(classifyRequiredRun({ ...run, conclusion: 'action_required' }, [], expected), 'REQUIRED_CI_APPROVAL_REQUIRED');
  assert.equal(classifyRequiredRun(run, jobs, expected), 'SUCCESS');
});

test('not-started, pending, failed, skipped and wrong PR/head remain distinct and fail closed', () => {
  assert.equal(classifyRequiredRun(null, [], expected), 'REQUIRED_CI_NOT_STARTED');
  assert.equal(classifyRequiredRun({ ...run, status: 'queued', conclusion: null }, [], expected), 'REQUIRED_CI_PENDING');
  assert.equal(classifyRequiredRun({ ...run, conclusion: 'failure' }, [], expected), 'REQUIRED_CI_FAILED');
  for (const conclusion of ['skipped', 'cancelled', 'neutral']) assert.notEqual(classifyRequiredRun({ ...run, conclusion }, jobs, expected), 'SUCCESS');
  assert.equal(classifyRequiredRun({ ...run, pull_requests: [{ number: 479 }] }, jobs, expected), 'REQUIRED_CI_WRONG_SOURCE');
  assert.equal(classifyRequiredRun({ ...run, head_sha: 'b'.repeat(40) }, jobs, expected), 'REQUIRED_CI_WRONG_SOURCE');
  assert.equal(classifyRequiredRun(run, [], expected), 'REQUIRED_JOB_MISSING_OR_FAILED');
});

test('pending Production DB migrations block even when unrelated foreign histories exist', () => {
  const changes = [{ status: 'A', path: 'supabase/migrations/20261016033659_lead_compensation_access_denial.sql' }, { status: 'A', path: 'supabase/migrations/20261016100000_lead_staff_roster_resident_number.sql' }];
  const unrelated = [{ version: '20261016033659', name: 'unrelated_foreign_schema' }];
  assert.deepEqual(databaseReadiness(changes, unrelated), { status: 'DB_NOT_READY', missing: changes.map(item => item.path) });
  const applied = [{ version: 'different_live_timestamp', name: 'lead_compensation_access_denial' }, { version: '20261016120000', name: '20261016100000_lead_staff_roster_resident_number' }];
  assert.deepEqual(databaseReadiness(changes, applied), { status: 'READY', missing: [] });
});

test('modified/deleted migrations require explicit review and cannot be waved through by old history', () => {
  for (const status of ['M', 'D', 'R100']) assert.equal(databaseReadiness([{ status, path: 'supabase/migrations/123_example.sql' }], [{ version: '123', name: 'example' }]).status, 'DB_MIGRATION_REVIEW_REQUIRED');
  assert.equal(databaseReadiness([], []).status, 'READY');
});

test('Netlify success requires exact publicly published Production SHA, not Preview or build readiness', () => {
  const sha = 'b'.repeat(40);
  assert.equal(publicDeployReady({ published_deploy: { state: 'ready', context: 'production', commit_ref: sha } }, sha), true);
  for (const deploy of [undefined, { state: 'error', context: 'production', commit_ref: sha }, { state: 'ready', context: 'deploy-preview', commit_ref: sha }, { state: 'ready', context: 'production', commit_ref: 'old' }]) assert.equal(publicDeployReady({ published_deploy: deploy }, sha), false);
});

test('failure reports reuse existing Issue and update one bot-owned alert without leaking exception text', async () => {
  for (const comments of [[], [{ id: 10, user: { login: 'github-actions[bot]' }, body: '<!-- production-release-incident:v1 --> old' }]]) {
    const calls = [];
    await reportReleaseFailure({ runUrl: 'https://github.com/test/repo/actions/runs/123', sha: expected.sha,
      api: async (method, route, body) => { calls.push({ method, route, body }); return method === 'GET' ? comments : {}; } });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].method, comments.length ? 'PATCH' : 'POST');
    assert.match(calls[1].body.body, /actions\/runs\/123/);
    assert.doesNotMatch(calls[1].body.body, /Bearer|private.key|password|SUPABASE_ACCESS_TOKEN/);
    assert.match(calls[0].route, /issues\/438\/comments/);
  }
});

test('a human comment with the incident marker cannot be overwritten', async () => {
  const calls = [];
  await reportReleaseFailure({ runUrl: 'https://example.invalid/run', sha: expected.sha,
    api: async (method, route) => { calls.push({ method, route }); return method === 'GET' ? [{ id: 99, user: { login: 'human' }, body: '<!-- production-release-incident:v1 --> human' }] : {}; } });
  assert.equal(calls[1].method, 'POST');
});
