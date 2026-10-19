import { spawnSync } from 'node:child_process';

export function classifyRequiredRun(run, jobs, { sha, pr, job }) {
  if (!run) return 'REQUIRED_CI_NOT_STARTED';
  if (run.event !== 'pull_request' || run.head_sha !== sha
    || !run.pull_requests?.some(item => item.number === pr)) return 'REQUIRED_CI_WRONG_SOURCE';
  if (run.conclusion === 'action_required') return 'REQUIRED_CI_APPROVAL_REQUIRED';
  if (run.status !== 'completed') return 'REQUIRED_CI_PENDING';
  if (run.conclusion !== 'success') return 'REQUIRED_CI_FAILED';
  if (!jobs.some(item => item.head_sha === sha && item.name === job
    && item.status === 'completed' && item.conclusion === 'success')) return 'REQUIRED_JOB_MISSING_OR_FAILED';
  return 'SUCCESS';
}

export function databaseReadiness(changes, migrations) {
  const relevant = changes.filter(item => /^supabase\/migrations\/.*\.sql$/.test(item.path));
  if (relevant.some(item => item.status !== 'A')) return { status: 'DB_MIGRATION_REVIEW_REQUIRED' };
  const missing = relevant.filter(item => {
    const match = item.path.match(/\/(\d+)_([^/]+)\.sql$/);
    return !match || !migrations.some(row => row.name?.replace(/^\d+_/, '') === match[2]);
  }).map(item => item.path);
  return { status: missing.length ? 'DB_NOT_READY' : 'READY', missing };
}

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('DB_PREFLIGHT_GIT_FAILED');
  return result.stdout.trim();
}

// Catalog metadata only. No DDL, row data, sensitive identity or Auth lookup.
export async function checkProductionDatabase({ publishedSha, head, token, projectRef, fetcher = fetch }) {
  if (![publishedSha, head].every(value => /^[a-f0-9]{40}$/.test(value))) throw new Error('INVALID_DB_PREFLIGHT_SHA');
  git('merge-base', '--is-ancestor', publishedSha, head);
  const changes = git('diff', '--name-status', publishedSha, head, '--', 'supabase/migrations')
    .split(/\r?\n/).filter(Boolean).map(line => { const [status, path] = line.split('\t'); return { status, path }; });
  if (!changes.length) return { status: 'READY', missing: [] };
  if (!token || !/^[a-z]{20}$/.test(projectRef || '')) return { status: 'DB_PREFLIGHT_AUTH_UNAVAILABLE' };
  const response = await fetcher(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'select version, name from supabase_migrations.schema_migrations order by version', read_only: true }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`DB_PREFLIGHT_HTTP_${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('DB_PREFLIGHT_INVALID_RESPONSE');
  return databaseReadiness(changes, rows);
}

export function publicDeployReady(snapshot, sha) {
  const deploy = snapshot?.published_deploy;
  return deploy?.state === 'ready' && deploy.context === 'production' && deploy.commit_ref === sha;
}

export const safeReleaseStatuses = new Set(['NO_CHANGES', 'WAITING_WINDOW', 'WAITING_DAILY_LIMIT', 'DRY_RUN_READY', 'MERGED', 'RETRY_NOOP', 'OPEN_RELEASE_PR']);
