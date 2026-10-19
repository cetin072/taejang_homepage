import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { markerPath, planRelease, publishedRelease } from './production-release-plan.mjs';
import { currentSlot } from './production-release-schedule.mjs';
import { classifyRequiredRun, checkProductionDatabase, safeReleaseStatuses } from './production-release-health.mjs';

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
  if (plan.schedule && !currentSlot(plan.schedule, now)) return 'MISSED_SLOT';
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
export function exactHeadSuccess(run, jobs, sha, requiredJob, pr) {
  return classifyRequiredRun(run, jobs, { sha, pr, job: requiredJob }) === 'SUCCESS';
}
// Only this operation pushes Git objects, exclusively to a new release branch.
export function release({ planPath, dryRun = true, branch = prefix + process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT }) {
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  if (plan.status !== 'READY') return { status: plan.status };
  if (plan.force) throw new Error('FORCE_RELEASE_DISABLED');
  if (plan.schedule && !currentSlot(plan.schedule, new Date())) return { status: 'MISSED_SLOT' };
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
export async function orchestrate({ plan, dryRun, api, prepare, published, sleep, preflight, now = () => new Date() }) {
  if (plan.status !== 'READY') return { status: plan.status };
  if (plan.schedule && !currentSlot(plan.schedule, now())) return { status: 'MISSED_SLOT' };
  if (!preflight) throw new Error('DB_PREFLIGHT_REQUIRED');
  const database = await preflight();
  if (database.status !== 'READY') return database;
  const open = [];
  for (let page = 1; page <= 10; page++) {
    const rows = await api('GET', '/pulls?state=open&base=main&per_page=100&page=' + page);
    if (!Array.isArray(rows)) throw new Error('OPEN_PR_LIST_INVALID');
    open.push(...rows);
    if (rows.length < 100) break;
    if (page === 10) throw new Error('OPEN_PR_LIST_INCOMPLETE');
  }
  const existing = open.find(pr => pr.head.ref.startsWith(prefix));
  if (existing) {
    const markerResponse = await api('GET', '/contents/' + markerPath + '?ref=' + existing.head.sha);
    const marker = JSON.parse(Buffer.from(markerResponse.content, 'base64').toString('utf8'));
    if (marker.source_main_sha !== plan.source_main_sha || marker.released_on_kst !== kst(now())) return { status: 'STALE_RELEASE_PR', pr: existing.html_url };
    for (const [workflow, job] of requiredWorkflows) {
      const listing = await api('GET', '/actions/workflows/' + workflow + '/runs?event=pull_request&head_sha=' + existing.head.sha + '&per_page=100');
      const run = listing.workflow_runs.find(run => run.pull_requests?.some(item => item.number === existing.number));
      const jobs = run?.status === 'completed' && run.conclusion === 'success'
        ? (await api('GET', '/actions/runs/' + run.id + '/jobs?per_page=100')).jobs : [];
      const state = classifyRequiredRun(run, jobs, { sha: existing.head.sha, pr: existing.number, job });
      if (state !== 'SUCCESS' && state !== 'REQUIRED_CI_PENDING') return { status: state, pr: existing.html_url };
    }
    const age = now() - new Date(existing.created_at);
    return { status: Number.isFinite(age) && age >= 0 && age <= 30 * 60_000 ? 'OPEN_RELEASE_PR' : 'RELEASE_PR_STALLED', pr: existing.html_url };
  }
  // A failed POST /pulls may leave a pushed release branch without a PR.
  // Never create another branch on each scheduled run in that state.
  const releaseRefs = await api('GET', '/git/matching-refs/heads/' + prefix);
  if (!Array.isArray(releaseRefs)) throw new Error('RELEASE_REF_LIST_INVALID');
  for (const ref of releaseRefs) {
    const associated = await api('GET', '/commits/' + ref.object.sha + '/pulls?per_page=1');
    if (!associated.length) {
      // Read-only classification: preserve every ref and every open PR.
      // A marker-only orphan from a prior slot can no longer publish or block forever.
      if (plan.schedule && /^refs\/heads\/codex\/production-release-\d+-\d+$/.test(ref.ref)) {
        const commit = await api('GET', '/commits/' + ref.object.sha);
        if (commit.parents?.length === 1 && commit.files?.length === 1 && commit.files[0].filename === markerPath
          && Date.parse(commit.commit?.committer?.date) <= Date.parse(plan.schedule.slot.start_utc) - 24 * 3_600_000) {
          const response = await api('GET', '/contents/' + markerPath + '?ref=' + ref.object.sha);
          const marker = JSON.parse(Buffer.from(response.content, 'base64').toString('utf8'));
          if (marker.source_main_sha === commit.parents[0].sha) {
            const comparison = await api('GET', '/compare/' + marker.source_main_sha + '...' + plan.source_main_sha);
            if (['ahead', 'identical'].includes(comparison.status)) continue;
          }
        }
      }
      return { status: 'ORPHAN_RELEASE_BRANCH', branch: ref.ref };
    }
  }
  if (dryRun) return prepare();
  const prepared = prepare();
  if (prepared.status !== 'BRANCH_CREATED') return prepared;
  const pr = await api('POST', '/pulls', {
    base: 'main', head: prepared.branch, title: 'chore: batched Production release',
    body: 'Automated marker-only release. Source main: ' + plan.source_main_sha + '\nGenuine pull_request CI is required at ' + prepared.head + '.',
  });
  const discard = async () => {
    await api('PATCH', '/pulls/' + pr.number, { state: 'closed' });
    return { status: 'RETRY_NOOP', pr: pr.html_url };
  };
  const runs = [];
  for (const [workflow, job] of requiredWorkflows) {
    let selected;
    for (let attempt = 0; attempt < 60; attempt++) {
      if ((await api('GET', '/git/ref/heads/main')).object.sha !== plan.source_main_sha) return discard();
      const listing = await api('GET', '/actions/workflows/' + workflow + '/runs?event=pull_request&head_sha=' + prepared.head + '&per_page=100');
      const candidates = listing.workflow_runs.filter(run => run.head_sha === prepared.head && run.head_branch === prepared.branch && run.pull_requests?.some(item => item.number === pr.number));
      if (candidates.length > 1) throw new Error('AMBIGUOUS_CI_RUN');
      selected = candidates[0];
      if (selected?.conclusion === 'action_required') throw new Error('REQUIRED_CI_APPROVAL_REQUIRED');
      if (selected?.status === 'completed') {
        const jobs = await api('GET', '/actions/runs/' + selected.id + '/jobs?per_page=100');
        if (!exactHeadSuccess(selected, jobs.jobs, prepared.head, job, pr.number)) throw new Error('REQUIRED_CI_FAILED: ' + workflow);
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
    if (!exactHeadSuccess(actual, jobs.jobs, prepared.head, run.job, pr.number)) throw new Error('REQUIRED_CI_FAILED');
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
  const finalDatabase = await preflight();
  if (finalDatabase.status !== 'READY') return finalDatabase;
  if ((await api('GET', '/git/ref/heads/main')).object.sha !== plan.source_main_sha) return discard();
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
    if (!response.ok) throw new Error('GitHub API ' + method + ' ' + route + ': ' + response.status);
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
    preflight: async () => checkProductionDatabase({ publishedSha: (await published()).source_main_sha, head: plan.source_main_sha,
      token: process.env.SUPABASE_ACCESS_TOKEN, projectRef: process.env.PRODUCTION_SUPABASE_PROJECT_REF }),
    prepare: () => process.env.DRY_RUN === 'true' && process.env.GITHUB_REF !== 'refs/heads/main'
      ? { status: 'DRY_RUN_READY' }
      : release({ planPath: process.env.RELEASE_PLAN_PATH, dryRun: process.env.DRY_RUN !== 'false' }),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  });
  console.log(JSON.stringify(result));
  if (!safeReleaseStatuses.has(result.status)) throw new Error('RELEASE_BLOCKED: ' + result.status);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, 'status=' + result.status + '\n');
    if (result.release_sha) appendFileSync(process.env.GITHUB_OUTPUT, 'release_sha=' + result.release_sha + '\n');
  }
}
// Historical marker-PR helpers remain regression fixtures. The old CLI cannot merge main.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  throw new Error('LEGACY_RELEASE_DISABLED_USE_SCHEDULED_NETLIFY_CHECK');
}
