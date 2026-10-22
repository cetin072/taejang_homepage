// One-off Taejang Production release authorized on 2026-10-22 KST.
// No scheduler modification, no Git write, no Supabase mutation and at most one hook POST.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { publishedDeploy, deployInput, trigger, ONE_OFF_20261022 } from './scheduled-netlify-release.mjs';
import { checkProductionDatabase } from './production-release-health.mjs';

const SHA = /^[a-f0-9]{40}$/;
const RELEASE_MARKER = '[taejang-production-once-20261022]';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function authorizeOneOff(env, head, at) {
  const time = new Date(at).getTime();
  if (env.GITHUB_EVENT_NAME !== 'push'
    || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_REPOSITORY !== 'cetin072/taejang_homepage'
    || !SHA.test(head || '') || env.GITHUB_SHA !== head
    || env.GITHUB_RUN_ATTEMPT !== '1'
    || !/^\d+$/.test(String(env.GITHUB_RUN_ID))
    || !(env.RELEASE_COMMIT_MESSAGE || '').includes(RELEASE_MARKER)
    || !Number.isFinite(time)
    || time < Date.parse('2026-10-22T10:00:00.000Z')
    || time >= Date.parse(ONE_OFF_20261022.expires_at)) {
    throw new Error('ONE_OFF_RUN_UNAUTHORIZED');
  }
  return true;
}

const fetchPublished = async (config, fetcher) => {
  const response = await fetcher('https://api.netlify.com/api/v1/sites/' + config.site_id,
    { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('ONE_OFF_SITE_READ_FAILED');
  return publishedDeploy(await response.json(), config.site_id);
};

export async function releaseOnce({ env = process.env, now = new Date(), fetcher = fetch } = {}) {
  const config = JSON.parse(readFileSync('deployment/release-policy.json', 'utf8'));
  if (config.site_id !== '9caa5a1a-f86d-4a9f-aed4-f560e1c2101f'
    || config.repository !== 'cetin072/taejang_homepage'
    || config.schedule_interval_hours !== 48) throw new Error('ONE_OFF_POLICY_MISMATCH');
  const head = git('rev-parse', 'HEAD');
  authorizeOneOff(env, head, now);
  if (git('rev-parse', 'origin/main') !== head) throw new Error('ONE_OFF_MAIN_MOVED');

  const initial = await fetchPublished(config, fetcher);
  if (initial.id !== ONE_OFF_20261022.previous_deploy_id
    || initial.commit_ref !== ONE_OFF_20261022.previous_commit_ref) {
    throw new Error('ONE_OFF_PREVIOUS_DEPLOY_CHANGED');
  }
  git('merge-base', '--is-ancestor', initial.commit_ref, head);
  const files = git('diff', '--name-only', initial.commit_ref, head).split(/\r?\n/).filter(Boolean);
  if (!files.some(file => deployInput(config, file))) throw new Error('ONE_OFF_NO_DEPLOY_INPUTS');

  const readiness = await checkProductionDatabase({
    publishedSha: initial.commit_ref, head,
    token: env.SUPABASE_ACCESS_TOKEN, projectRef: env.PRODUCTION_SUPABASE_PROJECT_REF,
  });
  if (readiness.status !== 'READY') throw new Error('ONE_OFF_DB_' + readiness.status);

  const gh = await fetcher('https://api.github.com/repos/' + config.repository + '/git/ref/heads/main', {
    headers: { Authorization: 'Bearer ' + env.GH_TOKEN, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!gh.ok || (await gh.json()).object?.sha !== head) throw new Error('ONE_OFF_MAIN_MOVED');
  const current = await fetchPublished(config, fetcher);
  if (current.id !== initial.id || current.commit_ref !== initial.commit_ref) {
    throw new Error('ONE_OFF_PUBLICATION_CHANGED');
  }
  const request = {
    version: 1, release_kind: ONE_OFF_20261022.kind,
    repository: config.repository, site_id: config.site_id, source_main_sha: head,
    previous_deploy_id: initial.id, previous_commit_ref: initial.commit_ref,
    run_id: String(env.GITHUB_RUN_ID), issued_at: new Date().toISOString(),
  };
  return trigger(config, request, env.NETLIFY_PRODUCTION_BUILD_HOOK, { fetcher });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await releaseOnce())); }
  catch (error) {
    const code = /^[A-Z][A-Z0-9_]+$/.test(error.message || '') ? error.message : 'ONE_OFF_RELEASE_FAILED';
    console.error(code);
    process.exitCode = 1;
  }
}
