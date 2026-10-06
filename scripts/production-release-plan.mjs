import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const markerPath = 'app/release/production.json';
const policy = JSON.parse(readFileSync('deployment/release-policy.json', 'utf8'));
const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });

if (policy.mode !== 'BATCHED' || policy.production_interval_days !== 2 || policy.max_production_deploys_per_day !== 1) {
  throw new Error('Unexpected Production release policy');
}
const headResult = git('rev-parse', 'HEAD');
if (headResult.status !== 0) throw new Error(headResult.stderr);
const head = headResult.stdout.trim();
if (!/^[0-9a-f]{40}$/.test(marker.source_main_sha)) throw new Error('Invalid release source SHA');
if (git('merge-base', '--is-ancestor', marker.source_main_sha, head).status !== 0) {
  throw new Error('The last released source is not an ancestor of main');
}
const changed = git('diff', '--name-only', marker.source_main_sha, head, '--');
if (changed.status !== 0) throw new Error(changed.stderr);
const deployInputs = changed.stdout.split(/\r?\n/).filter((file) => {
  if (!file || file === markerPath) return false;
  return /^(assets|images|app|staff|netlify\/functions)\//.test(file)
    || /^(?:[^/]+\.html|robots\.txt|sitemap\.xml|sw\.js|netlify\.toml|package(?:-lock)?\.json|scripts\/build-netlify-publish\.mjs|scripts\/netlify-production-gate\.mjs)$/.test(file);
});
let status = 'READY';
if (deployInputs.length === 0) status = 'NO_CHANGES';
else {
  const now = new Date(process.env.RELEASE_NOW || Date.now());
  const last = new Date(marker.released_at_utc);
  if (!Number.isFinite(last.getTime()) || last > now) throw new Error('Invalid last release time');
  const todayKst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (todayKst === marker.released_on_kst) status = 'WAITING_DAILY_LIMIT';
  else if (process.env.FORCE !== 'true' && now.getTime() - last.getTime() < policy.production_interval_days * 86_400_000) status = 'WAITING_WINDOW';
}
console.log(JSON.stringify({ status, source_main_sha: head, deploy_input_changes: deployInputs }, null, 2));
