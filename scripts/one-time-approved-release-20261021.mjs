// Authorized 2026-10-21 one-time release. GitHub issue_comment (owner only) replaces a missed
// scheduled event, but retains exact-main, slot, >=48h published, and Build Hook guards.
// This file is inert after 2026-10-21 24:00 KST; do not reuse for another date.
import { readFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { calendarSlot, publishedDeploy, decide, trigger } from './scheduled-netlify-release.mjs';

const SHA = /^[a-f0-9]{40}$/;
const DEADLINE = Date.parse('2026-10-21T15:00:00.000Z'); // 2026-10-22 00:00 KST
const SLOT_START = Date.parse('2026-10-21T08:20:00.000Z');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();

export function authorize({ event, env, now, head, config }) {
  const prNumber = Number(env.RELEASE_PR_NUMBER);
  if (!Number.isSafeInteger(prNumber) || prNumber < 1
      || env.GITHUB_EVENT_NAME !== 'issue_comment'
      || env.GITHUB_REF !== 'refs/heads/main'
      || env.GITHUB_REPOSITORY !== config.repository
      || event?.action !== 'created'
      || event?.repository?.full_name !== config.repository
      || event?.issue?.number !== prNumber
      || !event?.issue?.pull_request
      || event?.comment?.user?.login !== 'cetin072'
      || !SHA.test(head) || env.GITHUB_SHA !== head) {
    throw new Error('UNAUTHORIZED_EMERGENCY_REQUEST');
  }
  const requested = '/release-once 2026-10-21 ' + head;
  if (event.comment.body !== requested) throw new Error('EMERGENCY_COMMENT_SHA_MISMATCH');
  const created = Date.parse(event.comment.created_at), current = new Date(now).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(current)
      || created < SLOT_START || created >= DEADLINE
      || current < SLOT_START || current >= DEADLINE
      || created > current || current - created > 30 * 60000) {
    throw new Error('EMERGENCY_APPROVAL_EXPIRED');
  }
  const slot = calendarSlot(config, event.comment.created_at);
  if (slot.status !== 'DUE' || slot.slot.index !== 1) throw new Error('EMERGENCY_NOT_DUE');
  return { slot, createdAt: event.comment.created_at };
}

export async function execute({ event, env, now = new Date(), fetcher = fetch }) {
  const config = JSON.parse(readFileSync('deployment/release-policy.json', 'utf8'));
  if (config.site_id !== '9caa5a1a-f86d-4a9f-aed4-f560e1c2101f') throw new Error('SITE_ID_MISMATCH');
  const head = git('rev-parse', 'HEAD');
  const authorized = authorize({ event, env, now, head, config });
  const origin = git('rev-parse','origin/main');
  if (origin !== head) throw new Error('MAIN_MOVED');
  const snapshot = async () => {
    const response = await fetcher('https://api.netlify.com/api/v1/sites/' + config.site_id,
      { signal: AbortSignal.timeout(30000), cache: 'no-store' });
    if (!response.ok) throw new Error('PRODUCTION_SNAPSHOT_HTTP_' + response.status);
    return response.json();
  };
  const previous = publishedDeploy(await snapshot(), config.site_id);
  git('merge-base','--is-ancestor', previous.commit_ref, head);
  const files = git('diff','--name-only',previous.commit_ref,head).split(/\r?\n/).filter(Boolean);
  const plan = decide(config, previous, head, files, now);
  if (plan.status !== 'READY') throw new Error('EMERGENCY_' + plan.status);
  if (config.database_preflight) {
    const { checkProductionDatabase } = await import('./production-release-health.mjs');
    const readiness = await checkProductionDatabase({
      publishedSha: previous.commit_ref, head,
      token: env.SUPABASE_ACCESS_TOKEN,
      projectRef: env.PRODUCTION_SUPABASE_PROJECT_REF
    });
    if (readiness.status !== 'READY') throw new Error('DB_' + readiness.status);
  }
  const gh = await fetcher('https://api.github.com/repos/' + config.repository + '/git/ref/heads/main', {
    headers: { Authorization: 'Bearer ' + env.GH_TOKEN, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30000) });
  if (!gh.ok || (await gh.json()).object?.sha !== head) throw new Error('MAIN_MOVED');
  const check = publishedDeploy(await snapshot(), config.site_id);
  if (check.id !== previous.id || check.commit_ref !== previous.commit_ref) throw new Error('PUBLICATION_CHANGED');
  if (decide(config, check, head, plan.changes, new Date()).status !== 'READY') throw new Error('RELEASE_WINDOW_CHANGED');
  if (!/^\d+$/.test(String(env.GITHUB_RUN_ID))) throw new Error('RUN_ID_REQUIRED');
  const result = await trigger(config, {
    version: 1, repository: config.repository, site_id: config.site_id,
    source_main_sha: head, run_id: String(env.GITHUB_RUN_ID),
    run_created_at: authorized.createdAt, slot_index: authorized.slot.slot.index,
    issued_at: new Date().toISOString()
  }, env.NETLIFY_PRODUCTION_BUILD_HOOK, { fetcher });
  if (result.status !== 'PUBLISHED') throw new Error('PUBLICATION_NOT_CONFIRMED');
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY,
    'Emergency Production publication verified: ' + head + '\n');
  return { status: 'PUBLISHED', sha: head, published_at: result.published_at };
}

if (process.argv[1]?.endsWith('one-time-approved-release-20261021.mjs')) {
  try {
    const result = await execute({
      event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
      env: process.env
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    const safe = /^[A-Z][A-Z0-9_]+$/.test(error.message || '') ? error.message : 'EMERGENCY_RELEASE_FAILED';
    console.error(safe);
    process.exitCode = 1;
  }
}
