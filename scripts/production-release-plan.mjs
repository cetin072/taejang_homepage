import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const markerPath = 'app/release/production.json';

export function publishedRelease(snapshot) {
  const deploy = snapshot.published_deploy;
  if (!deploy || deploy.context !== 'production' || deploy.state !== 'ready' || !/^[0-9a-f]{40}$/.test(deploy.commit_ref) || !Number.isFinite(new Date(deploy.published_at).getTime())) throw new Error('INVALID_PUBLIC_PRODUCTION');
  const date = new Date(deploy.published_at);
  return { source_main_sha: deploy.commit_ref, released_at_utc: date.toISOString(), released_on_kst: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) };
}

export function planRelease({ policy, marker, publishedMarker = marker, head, changedFiles, now = new Date(), force = false, eventName }) {
  if (policy.version !== 1 || policy.mode !== 'BATCHED' || policy.production_interval_days !== 2 || policy.max_production_deploys_per_day !== 1) throw new Error('Unexpected Production release policy');
  if (force && eventName !== 'workflow_dispatch') throw new Error('FORCE_REQUIRES_WORKFLOW_DISPATCH');
  const deployInputs = changedFiles.filter((file) => {
    if (!file || file === markerPath) return false;
    return /^(assets|images|app|staff|netlify\/functions)\//.test(file)
      || /^(?:[^/]+\.html|robots\.txt|sitemap\.xml|sw\.js|netlify\.toml|package(?:-lock)?\.json|scripts\/build-netlify-publish\.mjs|scripts\/netlify-production-gate\.mjs)$/.test(file);
  });
  let status = 'READY';
  if (!deployInputs.length) status = 'NO_CHANGES';
  else {
    const times = [marker, publishedMarker].map((entry) => new Date(entry.released_at_utc));
    if (!Number.isFinite(now.getTime()) || times.some((time) => !Number.isFinite(time.getTime()) || time > now)) throw new Error('Invalid last release time');
    const todayKst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    if ([marker, publishedMarker].some((entry) => entry.released_on_kst === todayKst)) status = 'WAITING_DAILY_LIMIT';
    else if (!force && times.some((time) => now - time < 2 * 86_400_000)) status = 'WAITING_WINDOW';
  }
  return { status, source_main_sha: head, planned_at_utc: now.toISOString(), force, event_name: eventName, deploy_input_changes: deployInputs };
}

function main() {
  const policy = JSON.parse(readFileSync('deployment/release-policy.json', 'utf8'));
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  const publishedMarker = process.env.PUBLISHED_DEPLOY_PATH ? publishedRelease(JSON.parse(readFileSync(process.env.PUBLISHED_DEPLOY_PATH, 'utf8'))) : marker;
  const git = (...args) => {
    const result = spawnSync('git', args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const head = git('rev-parse', 'HEAD');
  if (!/^[0-9a-f]{40}$/.test(publishedMarker.source_main_sha)) throw new Error('Invalid public release source SHA');
  git('merge-base', '--is-ancestor', publishedMarker.source_main_sha, head);
  const changedFiles = git('diff', '--name-only', publishedMarker.source_main_sha, head, '--').split(/\r?\n/);
  const plan = planRelease({ policy, marker, publishedMarker, head, changedFiles, force: process.env.FORCE === 'true', eventName: process.env.GITHUB_EVENT_NAME });
  if (process.env.RELEASE_PLAN_PATH) writeFileSync(process.env.RELEASE_PLAN_PATH, JSON.stringify(plan, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'status=' + plan.status + '\n');
  console.log(JSON.stringify(plan, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
