import { spawnSync } from 'node:child_process';

const markerPath = 'app/release/production.json';
const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });

function readMarker(ref) {
  const result = git('show', `${ref}:${markerPath}`);
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
}

function shouldBuildProduction(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) return false;
  const parent = git('rev-parse', `${commit}^1`);
  if (parent.status !== 0) return false;
  const parentSha = parent.stdout.trim();
  const previous = readMarker(parentSha);
  const current = readMarker(commit);
  if (!previous || !current) return false; // Introducing the policy must not publish.
  const changed = git('diff', '--quiet', parentSha, commit, '--', markerPath);
  if (changed.status !== 1) return false;
  const files = git('diff', '--name-only', parentSha, commit);
  if (files.status !== 0 || files.stdout.trim() !== markerPath) return false;
  return current.source_main_sha === parentSha
    && current.release_attempt === previous.release_attempt + 1
    && current.interval_days === 2;
}

if (process.env.CONTEXT !== 'production') process.exit(1);
const commit = process.env.COMMIT_REF || git('rev-parse', 'HEAD').stdout.trim();
const build = shouldBuildProduction(commit);
console.log(build ? `PRODUCTION_RELEASE ${commit}` : `PRODUCTION_SKIP ${commit}`);
process.exit(build ? 1 : 0);
