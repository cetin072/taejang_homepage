import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { approvedReleaseAction, requestApprovedRelease } from '../scripts/chat-approved-release-request.mjs';

const event = (body = '/taejang deploy-now') => ({
  action: 'created',
  repository: { full_name: 'cetin072/taejang_homepage' },
  issue: { id: 6199522227, number: 586, state: 'open', user: { login: 'cetin072' } },
  comment: { body, author_association: 'OWNER', user: { login: 'cetin072' } },
  sender: { login: 'cetin072' }
});
const change = (path, value) => {
  const item = structuredClone(event());
  let cursor = item;
  for (const key of path.slice(0, -1)) cursor = cursor[key];
  cursor[path.at(-1)] = value;
  return item;
};

test('only two exact owner commands on one open, owner-created control issue', () => {
  assert.equal(approvedReleaseAction(event()), 'deploy-now');
  assert.equal(approvedReleaseAction(event('/taejang deploy-check')), 'dry-run');
  for (const body of [
    'deploy-now', '/taejang deploy-now ', ' /taejang deploy-now',
    '/taejang deploy-now\n', '/taejang deploy-now; echo unsafe',
    '/taejang prod', '/taejang deploy-check extra', ''
  ]) assert.equal(approvedReleaseAction(event(body)), null, JSON.stringify(body));
});

test('rejects arbitrary commenters, repository, issue and activity before any dispatch', async () => {
  const denied = [
    [['action'], 'edited'],
    [['repository', 'full_name'], 'cetin072/other-repo'],
    [['issue', 'number'], 585],
    [['issue', 'id'], 111],
    [['issue', 'state'], 'closed'],
    [['issue', 'pull_request'], { url: 'https://example.invalid/pr' }],
    [['issue', 'user', 'login'], 'attacker'],
    [['comment', 'user', 'login'], 'attacker'],
    [['sender', 'login'], 'attacker'],
    [['comment', 'author_association'], 'COLLABORATOR'],
    [['comment', 'author_association'], 'NONE']
  ];
  for (const [path, value] of denied) {
    const bad = change(path, value);
    assert.equal(approvedReleaseAction(bad), null, path.join('.'));
    const result = await requestApprovedRelease(bad, {
      fetchImpl: () => { throw new Error('forbidden network'); }
    });
    assert.deepEqual(result, { status: 'IGNORED' }, path.join('.'));
  }
});

test('single dispatch to existing workflow on main with only allowlisted input', async () => {
  for (const [command, expected] of [
    ['/taejang deploy-now', 'deploy-now'],
    ['/taejang deploy-check', 'dry-run']
  ]) {
    const calls = [];
    const result = await requestApprovedRelease(event(command), {
      token: 'synthetic-gh-token',
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 204 };
      }
    });
    assert.deepEqual(result, { status: 'DISPATCH_ACCEPTED', action: expected });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url,
      'https://api.github.com/repos/cetin072/taejang_homepage/actions/workflows/production-release.yml/dispatches');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), { ref: 'main', inputs: { action: expected } });
    assert.equal(calls[0].init.headers.Authorization, 'Bearer synthetic-gh-token');
    assert.ok(calls[0].init.signal);
  }
});

test('token absence and API rejection fail closed without retries or token output', async () => {
  await assert.rejects(requestApprovedRelease(event()), /GITHUB_ACTIONS_TOKEN_MISSING/);
  let attempts = 0;
  await assert.rejects(
    requestApprovedRelease(event(), {
      token: 'never-print-this',
      fetchImpl: async () => { attempts++; return { ok: false, status: 403 }; }
    }),
    error => {
      assert.equal(error.message, 'WORKFLOW_DISPATCH_HTTP_403');
      assert.ok(!error.message.includes('never-print-this'));
      return true;
    }
  );
  assert.equal(attempts, 1);
});

test('72-hour release gate stays unchanged and bridge has no privileged deployment secrets', () => {
  const policy = JSON.parse(readFileSync(new URL('../deployment/release-policy.json', import.meta.url)));
  assert.equal(policy.mode, 'BATCHED');
  assert.equal(policy.schedule_interval_hours, 72);
  assert.equal(policy.schedule_window_hours, 24);
  const target = readFileSync(new URL('../.github/workflows/production-release.yml', import.meta.url), 'utf8');
  assert.match(target, /workflow_dispatch:/);
  assert.match(target, /schedule:/);
  assert.match(target, /action: 'deploy-now'|action == 'deploy-now'/);
  assert.match(target, /group: taejang-production-release/);
  const bridge = readFileSync(new URL('../.github/workflows/chat-approved-production-release.yml', import.meta.url), 'utf8');
  for (const expected of ['issue_comment:', 'types: [created]', "github.event.issue.number == 586",
    "github.event.issue.id == 6199522227", "github.event.comment.author_association == 'OWNER'",
    "github.event.comment.user.login == 'cetin072'", 'actions: write']) {
    assert.ok(bridge.includes(expected), expected);
  }
  assert.doesNotMatch(bridge, /NETLIFY_PRODUCTION_BUILD_HOOK|SUPABASE_ACCESS_TOKEN|pull_request_target|secrets\./);
});
