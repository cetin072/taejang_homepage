import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planRelease, markerPath, publishedRelease } from '../scripts/production-release-plan.mjs';
import { markerOnly, mainMatches, release } from '../scripts/production-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gate = path.join(root, 'scripts/netlify-production-gate.mjs');
const policy = JSON.parse(readFileSync(path.join(root, 'deployment/release-policy.json'), 'utf8'));
const baseline = { version: 1, source_main_sha: 'a'.repeat(40), released_at_utc: '2026-10-03T07:07:18.980Z', released_on_kst: '2026-10-03', interval_days: 2, release_attempt: 0 };
function plan(overrides = {}) {
  return planRelease({ policy, marker: baseline, head: 'b'.repeat(40), changedFiles: ['index.html'], now: new Date('2026-10-06T07:00:00Z'), eventName: 'schedule', ...overrides });
}
function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, args.join(' ') + ': ' + result.stderr);
  return result.stdout.trim();
}
function configure(cwd) {
  git(cwd, 'config', 'user.name', 'Release Test');
  git(cwd, 'config', 'user.email', 'release-test@example.invalid');
}
function commit(cwd, message) {
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}
function writeMarker(cwd, source, attempt) {
  writeFileSync(path.join(cwd, markerPath), JSON.stringify({ ...baseline, source_main_sha: source, release_attempt: attempt }, null, 2) + '\n');
}

test('policy stays at two days and one Production per day; workflow has narrowly scoped permissions', () => {
  assert.equal(policy.production_interval_days, 2);
  assert.equal(policy.max_production_deploys_per_day, 1);
  const source = readFileSync(gate, 'utf8');
  assert.match(source, /\^1/);
  assert.doesNotMatch(source, /CACHED_COMMIT_REF/);
  const workflow = readFileSync(path.join(root, '.github/workflows/production-release.yml'), 'utf8');
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /permissions:\s+contents: write/);
  assert.equal((workflow.match(/contents: write/g) || []).length, 1);
  assert.doesNotMatch(workflow, /actions: write|secrets: write|pull-requests: write|\bPAT\b|pull_request_target/);
  assert.match(workflow, /group: taejang-production-release\s+cancel-in-progress: false/);
  assert.match(workflow, /github.event_name == 'workflow_dispatch' && inputs.force/);
  assert.match(workflow, /PROTECTION_BLOCKED/);
});

test('public Production time uses successful published_at, including KST midnight', () => {
  const publicRelease = publishedRelease({ published_deploy: { context: 'production', state: 'ready', commit_ref: 'd'.repeat(40), published_at: '2026-10-03T15:01:00Z' } });
  assert.equal(publicRelease.released_on_kst, '2026-10-04');
  assert.equal(plan({ publishedMarker: publicRelease, now: new Date('2026-10-05T15:00:59Z') }).status, 'WAITING_WINDOW');
  assert.equal(plan({ publishedMarker: publicRelease, now: new Date('2026-10-04T05:00:00Z'), force: true, eventName: 'workflow_dispatch' }).status, 'WAITING_DAILY_LIMIT');
  assert.throws(() => publishedRelease({ published_deploy: { context: 'deploy-preview' } }), /INVALID_PUBLIC_PRODUCTION/);
});

test('release planning enforces no-change, 48-hour, KST daily and manual force conditions', () => {
  assert.equal(plan({ changedFiles: [] }).status, 'NO_CHANGES');
  assert.equal(plan({ changedFiles: ['docs/guide.md', markerPath], force: true, eventName: 'workflow_dispatch' }).status, 'NO_CHANGES');
  assert.equal(plan({ now: new Date('2026-10-04T07:00:00Z') }).status, 'WAITING_WINDOW');
  assert.equal(plan({ now: new Date('2026-10-05T07:07:18.979Z') }).status, 'WAITING_WINDOW');
  assert.equal(plan({ now: new Date('2026-10-05T07:07:18.980Z') }).status, 'READY');
  assert.equal(plan({ now: new Date('2026-10-04T07:00:00Z'), force: true, eventName: 'workflow_dispatch' }).status, 'READY');
  assert.equal(plan({ now: new Date('2026-10-03T14:59:59Z'), force: true, eventName: 'workflow_dispatch' }).status, 'WAITING_DAILY_LIMIT');
  assert.throws(() => plan({ force: true, eventName: 'schedule' }), /FORCE_REQUIRES_WORKFLOW_DISPATCH/);
  assert.throws(() => plan({ policy: { ...policy, production_interval_days: 1 } }), /Unexpected Production release policy/);
  // A failed attempt's checked-in source must not replace the last public source.
  const failedAttempt = { ...baseline, source_main_sha: 'c'.repeat(40), released_at_utc: '2026-10-04T07:00:00Z', released_on_kst: '2026-10-04', release_attempt: 1 };
  assert.equal(plan({ marker: failedAttempt, publishedMarker: baseline, changedFiles: ['netlify/functions/staff-config.mjs'] }).status, 'READY');
});

test('ordinary main commits skip; initial marker introduction skips; marker-only release builds; Preview builds', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'taejang-release-gate-'));
  try {
    git(cwd, 'init', '-b', 'main');
    configure(cwd);
    mkdirSync(path.join(cwd, 'app/release'), { recursive: true });
    writeFileSync(path.join(cwd, 'index.html'), '<h1>Initial</h1>');
    const initial = commit(cwd, 'initial');
    writeMarker(cwd, initial, 0);
    const introduced = commit(cwd, 'introduce policy');
    const gateAt = (sha, context = 'production') => spawnSync(process.execPath, [gate], { cwd, encoding: 'utf8', env: { ...process.env, COMMIT_REF: sha, CONTEXT: context } });
    assert.equal(gateAt(introduced).status, 0);
    writeFileSync(path.join(cwd, 'index.html'), '<h1>Updated</h1>');
    const ordinary = commit(cwd, 'ordinary change');
    assert.equal(gateAt(ordinary).status, 0);
    writeMarker(cwd, ordinary, 1);
    const releaseSha = commit(cwd, 'marker only');
    assert.equal(gateAt(releaseSha).status, 1);
    writeFileSync(path.join(cwd, 'index.html'), '<h1>Later</h1>');
    const later = commit(cwd, 'later ordinary change');
    assert.equal(gateAt(later).status, 0, 'a previous failed release cannot leak into this commit');
    assert.equal(gateAt(later, 'deploy-preview').status, 1);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('staging permits exactly one marker and stale main is rejected', () => {
  assert.doesNotThrow(() => markerOnly([markerPath]));
  assert.throws(() => markerOnly([markerPath, 'index.html']), /MARKER_ONLY_VIOLATION/);
  assert.throws(() => markerOnly([]), /MARKER_ONLY_VIOLATION/);
  assert.equal(mainMatches('old', 'old', 'new'), false);
  assert.equal(mainMatches('old', 'new', 'old'), false);
});

test('remote main movement prevents marker mutation, release commit and push', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'taejang-release-stale-'));
  const originalCwd = process.cwd();
  try {
    const remote = path.join(temp, 'remote.git');
    const upstream = path.join(temp, 'upstream');
    const worker = path.join(temp, 'worker');
    git(temp, 'init', '--bare', remote);
    git(temp, 'clone', remote, upstream);
    configure(upstream);
    git(upstream, 'checkout', '-b', 'main');
    mkdirSync(path.join(upstream, 'app/release'), { recursive: true });
    writeMarker(upstream, baseline.source_main_sha, 0);
    writeFileSync(path.join(upstream, 'index.html'), 'initial');
    const planned = commit(upstream, 'initial');
    git(upstream, 'push', '-u', 'origin', 'main');
    git(temp, 'clone', '--branch', 'main', remote, worker);
    configure(worker);
    const planPath = path.join(temp, 'plan.json');
    writeFileSync(planPath, JSON.stringify({ status: 'READY', source_main_sha: planned, force: false, planned_at_utc: new Date().toISOString() }));
    writeFileSync(path.join(upstream, 'index.html'), 'newer main');
    const newer = commit(upstream, 'new main');
    git(upstream, 'push', 'origin', 'main');
    const markerBefore = readFileSync(path.join(worker, markerPath), 'utf8');
    process.chdir(worker);
    assert.equal(release({ planPath, dryRun: false }), 'RETRY_NOOP');
    assert.equal(git(worker, 'rev-parse', 'HEAD'), planned);
    assert.equal(git(worker, 'ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0], newer);
    assert.equal(readFileSync(path.join(worker, markerPath), 'utf8'), markerBefore);
    assert.equal(git(worker, 'status', '--porcelain'), '');
  } finally {
    process.chdir(originalCwd);
    rmSync(temp, { recursive: true, force: true });
  }
});
test('successful release pushes one marker-only commit to a local remote', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'taejang-release-push-'));
  const originalCwd = process.cwd();
  try {
    const remote = path.join(temp, 'remote.git');
    const worker = path.join(temp, 'worker');
    git(temp, 'init', '--bare', remote);
    git(temp, 'clone', remote, worker);
    configure(worker);
    git(worker, 'checkout', '-b', 'main');
    mkdirSync(path.join(worker, 'app/release'), { recursive: true });
    writeMarker(worker, baseline.source_main_sha, 0);
    writeFileSync(path.join(worker, 'index.html'), 'unchanged content');
    const source = commit(worker, 'initial');
    git(worker, 'push', '-u', 'origin', 'main');
    const planPath = path.join(temp, 'plan.json');
    writeFileSync(planPath, JSON.stringify({ status: 'READY', source_main_sha: source, force: false, planned_at_utc: new Date().toISOString() }));
    process.chdir(worker);
    assert.equal(release({ planPath, dryRun: true }), 'DRY_RUN_READY');
    assert.equal(git(worker, 'status', '--porcelain'), '');
    assert.equal(release({ planPath, dryRun: false }), 'PUSHED');
    const released = git(worker, 'rev-parse', 'HEAD');
    assert.notEqual(released, source);
    assert.equal(git(worker, 'rev-parse', 'HEAD^1'), source);
    assert.deepEqual(git(worker, 'diff', '--name-only', source, released).split(/\r?\n/), [markerPath]);
    assert.equal(git(worker, 'ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0], released);
    const actual = JSON.parse(readFileSync(path.join(worker, markerPath), 'utf8'));
    assert.equal(actual.source_main_sha, source);
    assert.equal(actual.release_attempt, 1);
    assert.equal(release({ planPath, dryRun: false }), 'RETRY_NOOP');
    assert.equal(git(worker, 'rev-parse', 'HEAD'), released);
  } finally {
    process.chdir(originalCwd);
    rmSync(temp, { recursive: true, force: true });
  }
});
