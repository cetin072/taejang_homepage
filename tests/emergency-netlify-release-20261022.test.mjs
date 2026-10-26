import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ONE_OFF_20261022, HOOK_TITLE, validateOneOffHook, guard } from '../scripts/scheduled-netlify-release.mjs';
import { authorizeOneOff } from '../scripts/emergency-netlify-release-20261022.mjs';

const config = JSON.parse(readFileSync(new URL('../deployment/release-policy.json', import.meta.url), 'utf8'));
const head = 'b'.repeat(40);
const at = new Date('2026-10-22T12:34:00.000Z');
const event = {
  GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main',
  GITHUB_REPOSITORY: config.repository, GITHUB_SHA: head, GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '1',
  RELEASE_COMMIT_MESSAGE: 'release: authorized [taejang-production-once-20261022]',
};
const body = {
  version: 1, release_kind: ONE_OFF_20261022.kind,
  repository: config.repository, site_id: config.site_id, source_main_sha: head,
  previous_commit_ref: ONE_OFF_20261022.previous_commit_ref,
  previous_deploy_id: ONE_OFF_20261022.previous_deploy_id,
  run_id: '123', issued_at: '2026-10-22T12:33:00.000Z',
};
const env = {
  CONTEXT: 'production', BRANCH: 'main', COMMIT_REF: head,
  INCOMING_HOOK_TITLE: HOOK_TITLE, INCOMING_HOOK_BODY: JSON.stringify(body),
};
const snapshot = {
  id: config.site_id, published_deploy: {
    id: ONE_OFF_20261022.previous_deploy_id,
    commit_ref: ONE_OFF_20261022.previous_commit_ref,
    context: 'production', state: 'ready', published_at: '2026-10-21T09:31:26.040Z',
  },
};
const getter = async () => ({ ok: true, json: async () => snapshot });
test('only one authorized main push and one run attempt may publish; expiry is fixed', () => {
  assert.equal(authorizeOneOff(event, head, at), true);
  for (const patch of [
    { GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_REF: 'refs/heads/draft' },
    { GITHUB_SHA: 'c'.repeat(40) }, { GITHUB_RUN_ATTEMPT: '2' },
    { RELEASE_COMMIT_MESSAGE: 'ordinary push' }, { GITHUB_REPOSITORY: 'other/repo' },
  ]) assert.throws(() => authorizeOneOff({ ...event, ...patch }, head, at), /ONE_OFF_RUN_UNAUTHORIZED/);
  assert.throws(() => authorizeOneOff(event, head, new Date(ONE_OFF_20261022.expires_at)), /ONE_OFF_RUN_UNAUTHORIZED/);
});
test('one-off hook keeps exact branch, host, SHA, prior deploy, deadline and freshness', () => {
  assert.equal(validateOneOffHook(config, env, at).source_main_sha, head);
  assert.equal(validateOneOffHook(config, { ...env, INCOMING_HOOK_BODY: encodeURIComponent(JSON.stringify(body)) }, at).source_main_sha, head);
  for (const patch of [{ source_main_sha: 'a'.repeat(40) }, { site_id: 'other' },
    { previous_deploy_id: 'other' }, { run_id: 'not-an-id' },
    { issued_at: '2026-10-21T12:33:00.000Z' }]) {
    assert.throws(() => validateOneOffHook(config, { ...env,
      INCOMING_HOOK_BODY: JSON.stringify({ ...body, ...patch }) }, at), /ONE_OFF_HOOK_INVALID/);
  }
  for (const patch of [{ BRANCH: 'dev' }, { CONTEXT: 'branch-deploy' },
    { INCOMING_HOOK_TITLE: 'wrong' }, { COMMIT_REF: 'c'.repeat(40) }]) {
    const actual = { ...env, ...patch };
    if (actual.CONTEXT === 'branch-deploy') assert.equal(validateOneOffHook(config, actual, at), null);
    else assert.throws(() => validateOneOffHook(config, actual, at), /ONE_OFF_HOOK_INVALID/);
  }
  assert.throws(() => validateOneOffHook(config, env, new Date(ONE_OFF_20261022.expires_at)), /ONE_OFF_HOOK_INVALID/);
});
test('one-off build guard accepts only untouched prior Production and writes generated marker', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taejang-once-'));
  try {
    const target = join(dir, 'production.json');
    const result = await guard({ ...config, marker_path: target }, env, { now: at, fetcher: getter });
    assert.equal(result.status, 'ONE_OFF_PRODUCTION_ALLOWED');
    const marker = JSON.parse(readFileSync(target, 'utf8'));
    assert.equal(marker.source_main_sha, head);
    assert.equal(marker.release_type, ONE_OFF_20261022.kind);
    const mismatched = async () => ({ ok: true, json: async () => ({
      ...snapshot, published_deploy: { ...snapshot.published_deploy, id: 'new-deploy' },
    }) });
    await assert.rejects(guard({ ...config, marker_path: target }, env,
      { now: at, fetcher: mismatched }), /ONE_OFF_PUBLICATION_CHANGED/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('expired one-off does not alter the current fixed schedule', () => {
  const regular = readFileSync(new URL('../.github/workflows/production-release.yml', import.meta.url), 'utf8');
  assert.match(regular, /cron: '20 8 \* \* \*'/);
  assert.equal(config.schedule_interval_hours, 72);
  assert.equal(config.schedule_anchor_utc, '2026-10-19T08:20:00.000Z');
  assert.equal(validateOneOffHook(config, { ...env, INCOMING_HOOK_BODY: '{}' }, at), null);
});
