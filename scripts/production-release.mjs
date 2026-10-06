import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { markerPath, planRelease, publishedRelease } from './production-release-plan.mjs';

export const requiredWorkflows = [
  ['public-homepage-checks.yml', 'Public source and launch regression'],
  ['phase1a-supabase-integration.yml', 'Migration, pgTAP, Auth and RLS'],
];
const prefix = 'codex/production-release-';
const kst = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const git = (...args) => {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || args.join(' '));
  return result.stdout.trim();
};
export function markerOnly(files) {
  if (files.length !== 1 || files[0] !== markerPath) throw new Error('MARKER_ONLY_VIOLATION');
}
export function mainMatches(planned, local, remote) {
  return planned === local && planned === remote;
}
export function validateMerge({ plan, main, head, expectedHead, files, marker, previous, published, now = new Date() }) {
  if (main !== plan.source_main_sha || head !== expectedHead || kst(now) !== kst(new Date(plan.planned_at_utc))) return 'RETRY_NOOP';
  markerOnly(files);
  if (marker.version !== 1 || marker.interval_days !== 2 || marker.release_attempt !== previous.release_attempt + 1
    || marker.source_main_sha !== main || marker.released_on_kst !== kst(now)) throw new Error('INVALID_RELEASE_MARKER');
  return planRelease({
    policy: { version: 1, mode: 'BATCHED', production_interval_days: 2, max_production_deploys_per_day: 1 },
    marker: previous, publishedMarker: published, head: main, changedFiles: plan.deploy_input_changes,
    now, force: plan.force, eventName: plan.event_name,
  }).status;
}
export function exactHeadSuccess(run, jobs, sha, requiredJob) {
  return run.event === 'workflow_dispatch' && run.head_sha === sha && run.status === 'completed'
    && run.conclusion === 'success' && jobs.some(job => job.head_sha === sha && job.name === requiredJob
      && job.status === 'completed' && job.conclusion === 'success');
}
// Only this operation pushes Git objects, exclusively to a new release branch.
export function release({ planPath, dryRun = true, branch = prefix + process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT }) {
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  if (plan.status !== 'READY') return { status: plan.status };
  if (plan.force && (plan.event_name !== 'workflow_dispatch' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch')) throw new Error('FORCE_REQUIRES_WORKFLOW_DISPATCH');
  if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('TRACKED_WORKTREE_NOT_CLEAN');
  git('fetch', 'origin', 'main');
  if (!mainMatches(plan.source_main_sha, git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main'))) return { status: 'RETRY_NOOP' };
  if (dryRun) return { status: 'DRY_RUN_READY' };
  if (!branch.startsWith(prefix) || !/^[a-zA-Z0-9/-]+$/.test(branch)) throw new Error('INVALID_RELEASE_BRANCH');
  const previous = JSON.parse(readFileSync(markerPath, 'utf8'));
  const now = new Date();
  if (kst(now) !== kst(new Date(plan.planned_at_utc))) return { status: 'RETRY_NOOP' };
  git('checkout', '-b', branch, plan.source_main_sha);
  writeFileSync(markerPath, JSON.stringify({
    version: 1, source_main_sha: plan.source_main_sha, released_at_utc: now.toISOString(),
    released_on_kst: kst(now), interval_days: 2, release_attempt: previous.release_attempt + 1,
  }, null, 2) + '\n');
  git('add', '--', markerPath);
  markerOnly(git('diff', '--cached', '--name-only').split(/\r?\n/).filter(Boolean));
  git('fetch', 'origin', 'main');
  if (git('rev-parse', 'origin/main') !== plan.source_main_sha) return { status: 'RETRY_NOOP' };
  git('commit', '-m', 'chore: publish batched Production release');
  markerOnly(git('diff', '--name-only', 'HEAD^1', 'HEAD').split(/\r?\n/).filter(Boolean));
  git('fetch', 'origin', 'main');
  if (git('rev-parse', 'origin/main') !== plan.source_main_sha) return { status: 'RETRY_NOOP' };
  git('push', 'origin', 'HEAD:refs/heads/' + branch);
  return { status: 'BRANCH_CREATED', branch, head: git('rev-parse', 'HEAD'), previous, marker: JSON.parse(readFileSync(markerPath, 'utf8')) };
}
export async function orchestrate({ plan, dryRun, api, prepare, published, sleep, now = () => new Date() }) {
  if (plan.status !== 'READY') return { status: plan.status };
  const open = await api('GET', '/pulls?state=open&base=main&per_page=100');
  if (open.length === 100) throw new Error('OPEN_PR_LIST_INCOMPLETE');
  if (open.some(pr => pr.head.ref.startsWith(prefix))) return { status: 'OPEN_RELEASE_PR' };
  if (dryRun) return prepare();
  const prepared = prepare();
  if (prepared.status !== 'BRANCH_CREATED') return prepared;
  const pr = await api('POST', '/pulls', {
    base: 'main', head: prepared.branch, title: 'chore: batched Production release',
    body: 'Automated marker-only release. Source main: ' + plan.source_main_sha + '\nRequired CI is explicitly dispatched and verified at ' + prepared.head + '.',
  });
  const discard = async () => {
    await api('PATCH', '/pulls/' + pr.number, { state: 'closed' });
    return { status: 'RETRY_NOOP', pr: pr.html_url };
  };
  const runs = [];
  for (const [workflow, job] of requiredWorkflows) {
    const before = await api('GET', '/actions/workflows/' + workflow + '/runs?event=workflow_dispatch&per_page=100');
    const previousIds = new Set(before.workflow_runs.map(run => run.id));
    await api('POST', '/actions/workflows/' + workflow + '/dispatches', { ref: prepared.branch });
    let selected;
    for (let attempt = 0; attempt < 120; attempt++) {
      if ((await api('GET', '/git/ref/heads/main')).object.sha !== plan.source_main_sha) return discard();
      const listing = await api('GET', '/actions/workflows/' + workflow + '/runs?event=workflow_dispatch&per_page=100');
      const candidates = listing.workflow_runs.filter(run => !previousIds.has(run.id) && run.head_sha === prepared.head && run.head_branch === prepared.branch);
      if (candidates.length > 1) throw new Error('AMBIGUOUS_CI_RUN');
      selected = candidates[0];
      if (selected?.status === 'completed') {
        const jobs = await api('GET', '/actions/runs/' + selected.id + '/jobs?per_page=100');
        if (!exactHeadSuccess(selected, jobs.jobs, prepared.head, job)) throw new Error('REQUIRED_CI_FAILED: ' + workflow);
        break;
      }
      await sleep(15_000);
    }
    if (!selected || selected.status !== 'completed') throw new Error('REQUIRED_CI_TIMEOUT');
    runs.push({ id: selected.id, job });
  }
  // Re-read selected runs, remote PR diff/content, public release and main immediately before merge.
  for (const run of runs) {
    const actual = await api('GET', '/actions/runs/' + run.id);
    const jobs = await api('GET', '/actions/runs/' + run.id + '/jobs?per_page=100');
    if (!exactHeadSuccess(actual, jobs.jobs, prepared.head, run.job)) throw new Error('REQUIRED_CI_FAILED');
  }
  const currentPr = await api('GET', '/pulls/' + pr.number);
  if (currentPr.state !== 'open' || currentPr.base.ref !== 'main' || currentPr.head.ref !== prepared.branch) throw new Error('RELEASE_PR_CHANGED');
  const files = await api('GET', '/pulls/' + pr.number + '/files?per_page=100');
  const remoteMarker = await api('GET', '/contents/' + markerPath + '?ref=' + prepared.head);
  const marker = JSON.parse(Buffer.from(remoteMarker.content, 'base64').toString('utf8'));
  if (JSON.stringify(marker) !== JSON.stringify(prepared.marker)) throw new Error('RELEASE_MARKER_CHANGED');
  const latestPublic = await published();
  const main = (await api('GET', '/git/ref/heads/main')).object.sha;
  const status = validateMerge({
    plan, main, head: currentPr.head.sha, expectedHead: prepared.head,
    files: files.map(file => file.filename), marker, previous: prepared.previous, published: latestPublic, now: now(),
  });
  if (status !== 'READY') return discard();
  const merged = await api('PUT', '/pulls/' + pr.number + '/merge', { sha: prepared.head, merge_method: 'squash' });
  if (!merged.merged) throw new Error('PROTECTED_MERGE_REJECTED');
  // A race after the final base check is also fail-closed by Netlify's first-parent marker gate.
  const commit = await api('GET', '/commits/' + merged.sha);
  if (commit.parents.length !== 1 || commit.parents[0].sha !== plan.source_main_sha) throw new Error('STALE_SQUASH_PARENT_PRODUCTION_BLOCKED');
  markerOnly(commit.files.map(file => file.filename));
  return { status: 'MERGED', release_sha: merged.sha, pr: pr.html_url, ci_runs: runs.map(run => run.id) };
}
async function main() {
  const plan = JSON.parse(readFileSync(process.env.RELEASE_PLAN_PATH, 'utf8'));
  const repo = process.env.GITHUB_REPOSITORY;
  const api = async (method, route, body) => {
    const response = await fetch('https://api.github.com/repos/' + repo + route, {
      method, headers: { Authorization: 'Bearer ' + process.env.GH_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error('GitHub API ' + method + ' ' + route + ': ' + response.status + ' ' + await response.text());
    return response.status === 204 ? null : response.json();
  };
  const published = async () => {
    const response = await fetch('https://api.netlify.com/api/v1/sites/9caa5a1a-f86d-4a9f-aed4-f560e1c2101f', { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error('PUBLIC_PRODUCTION_UNAVAILABLE');
    return publishedRelease(await response.json());
  };
  const previous = JSON.parse(readFileSync(markerPath, 'utf8'));
  if (plan.status === 'READY' && previous.release_attempt > 0
    && git('log', '-1', '--format=%H', '--', markerPath) !== (await published()).source_main_sha) throw new Error('PREVIOUS_RELEASE_UNPUBLISHED: no automatic redeploy');
  const result = await orchestrate({
    plan, dryRun: process.env.DRY_RUN !== 'false', api, published,
    prepare: () => release({ planPath: process.env.RELEASE_PLAN_PATH, dryRun: process.env.DRY_RUN !== 'false' }),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  });
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, 'status=' + result.status + '\n');
    if (result.release_sha) appendFileSync(process.env.GITHUB_OUTPUT, 'release_sha=' + result.release_sha + '\n');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
