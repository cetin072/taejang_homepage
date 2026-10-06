import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { markerPath } from './production-release-plan.mjs';

export function markerOnly(files) {
  if (files.length !== 1 || files[0] !== markerPath) throw new Error('MARKER_ONLY_VIOLATION');
}
export function mainMatches(planned, local, remote) {
  return planned === local && planned === remote;
}
export function release({ planPath, dryRun = true, outputPath }) {
  const git = (...args) => {
    const result = spawnSync('git', args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || args.join(' '));
    return result.stdout.trim();
  };
  const report = (status) => {
    console.log(status);
    if (outputPath) appendFileSync(outputPath, 'status=' + status + '\n');
    return status;
  };
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  if (plan.status !== 'READY') return report(plan.status);
  if (plan.force && (plan.event_name !== 'workflow_dispatch' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch')) throw new Error('FORCE_REQUIRES_WORKFLOW_DISPATCH');
  if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('TRACKED_WORKTREE_NOT_CLEAN');
  git('fetch', 'origin', 'main');
  if (!mainMatches(plan.source_main_sha, git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main'))) return report('RETRY_NOOP');
  if (dryRun) return report('DRY_RUN_READY');
  const previous = JSON.parse(readFileSync(markerPath, 'utf8'));
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  // A plan cannot be carried across a KST date boundary.
  const planDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(plan.planned_at_utc));
  if (today !== planDate) return report('RETRY_NOOP');
  writeFileSync(markerPath, JSON.stringify({ version: 1, source_main_sha: plan.source_main_sha, released_at_utc: now.toISOString(), released_on_kst: today, interval_days: 2, release_attempt: previous.release_attempt + 1 }, null, 2) + '\n');
  git('add', '--', markerPath);
  markerOnly(git('diff', '--cached', '--name-only').split(/\r?\n/).filter(Boolean));
  git('fetch', 'origin', 'main');
  if (!mainMatches(plan.source_main_sha, git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main'))) return report('RETRY_NOOP');
  git('commit', '-m', 'chore: publish batched Production release');
  markerOnly(git('diff', '--name-only', 'HEAD^1', 'HEAD').split(/\r?\n/).filter(Boolean));
  git('fetch', 'origin', 'main');
  if (git('rev-parse', 'origin/main') !== plan.source_main_sha) return report('RETRY_NOOP');
  // Non-forced push: concurrent main changes or repository protection reject it.
  git('push', 'origin', 'HEAD:refs/heads/main');
  if (outputPath) appendFileSync(outputPath, 'release_sha=' + git('rev-parse', 'HEAD') + '\n');
  return report('PUSHED');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  release({ planPath: process.env.RELEASE_PLAN_PATH, dryRun: process.env.DRY_RUN !== 'false', outputPath: process.env.GITHUB_OUTPUT });
}
