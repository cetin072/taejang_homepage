import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gate = path.join(root, 'scripts/netlify-production-gate.mjs');
const policy = JSON.parse(readFileSync(path.join(root, 'deployment/release-policy.json'), 'utf8'));
const gateSource = readFileSync(gate, 'utf8');
const markerPath = 'app/release/production.json';

function run(cwd, command, args, env = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  return result;
}
function git(cwd, ...args) {
  const result = run(cwd, 'git', args);
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}
function commit(cwd, message) {
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}
function marker(cwd, source, attempt) {
  writeFileSync(path.join(cwd, markerPath), `${JSON.stringify({ version: 1, source_main_sha: source, released_at_utc: '2026-10-03T07:07:18.980Z', released_on_kst: '2026-10-03', interval_days: 2, release_attempt: attempt }, null, 2)}\n`);
}

test('two-day Production policy is fixed and the gate uses the first parent', () => {
  assert.equal(policy.production_interval_days, 2);
  assert.equal(policy.max_production_deploys_per_day, 1);
  assert.match(gateSource, /\^1/);
  assert.doesNotMatch(gateSource, /CACHED_COMMIT_REF/);
});

test('ordinary main commits skip; only a marker-only release commit builds; previews build', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'taejang-release-test-'));
  try {
    git(cwd, 'init');
    git(cwd, 'config', 'user.name', 'Release Test');
    git(cwd, 'config', 'user.email', 'release-test@example.invalid');
    mkdirSync(path.join(cwd, 'app/release'), { recursive: true });
    mkdirSync(path.join(cwd, 'deployment'), { recursive: true });
    copyFileSync(path.join(root, 'deployment/release-policy.json'), path.join(cwd, 'deployment/release-policy.json'));
    writeFileSync(path.join(cwd, 'index.html'), '<h1>Initial</h1>');
    const initial = commit(cwd, 'initial');
    marker(cwd, initial, 0);
    const introduced = commit(cwd, 'introduce policy marker');
    const gateAt = (sha, context = 'production') => run(cwd, process.execPath, [gate], { COMMIT_REF: sha, CONTEXT: context });
    assert.equal(gateAt(introduced).status, 0, 'initial marker introduction must skip');
    const planWithoutChanges = run(cwd, process.execPath, [path.join(root, 'scripts/production-release-plan.mjs')], { RELEASE_NOW: '2026-10-06T07:00:00.000Z' });
    assert.equal(JSON.parse(planWithoutChanges.stdout).status, 'NO_CHANGES');
    writeFileSync(path.join(cwd, 'index.html'), '<h1>Updated</h1>');
    const ordinary = commit(cwd, 'ordinary change');
    const planAt = (time, force = 'false') => JSON.parse(run(cwd, process.execPath, [path.join(root, 'scripts/production-release-plan.mjs')], { RELEASE_NOW: time, FORCE: force }).stdout);
    assert.equal(planAt('2026-10-04T07:00:00.000Z').status, 'WAITING_WINDOW');
    assert.equal(planAt('2026-10-04T07:00:00.000Z', 'true').status, 'READY');
    assert.equal(planAt('2026-10-06T07:00:00.000Z').status, 'READY');
    assert.equal(gateAt(ordinary).status, 0, 'ordinary main change must skip');
    marker(cwd, ordinary, 1);
    const release = commit(cwd, 'batched release');
    assert.equal(gateAt(release).status, 1, 'marker-only release must build');
    writeFileSync(path.join(cwd, 'index.html'), '<h1>Later</h1>');
    const later = commit(cwd, 'later ordinary change');
    assert.equal(gateAt(later).status, 0, 'ordinary commit after release must skip');
    assert.equal(gateAt(later, 'deploy-preview').status, 1, 'Deploy Preview must build');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
