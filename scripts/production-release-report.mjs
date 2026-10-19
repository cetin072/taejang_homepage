import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const incidentMarker = '<!-- production-release-incident:v1 -->';
const categories = new Set(['SLOT_HISTORY', 'PLANNING', 'APP_CONFIGURATION', 'APP_AUTHENTICATION', 'APP_SCOPE', 'DB_CI_OR_PROTECTED_MERGE', 'PUBLICATION_NOT_CONFIRMED', 'JOB_OR_SETUP_FAILURE', 'JOB_CANCELLED_OR_TIMED_OUT']);
export async function reportReleaseFailure({ api, runUrl, sha, category }) {
  const reason = categories.has(category) ? category : 'CHECK_RUN_LOGS';
  // Fixed message: never include exception bodies, environment or credentials.
  const body = `${incidentMarker}\nProduction release requires attention.\n\nRun: ${runUrl}\nSource: ${sha}\nCause: ${reason}\n\nInspect the failing step for DB readiness, release authentication, genuine PR checks, stale/open release PR or published-deploy timeout. No automatic redeploy or protection bypass was attempted. Fix the cause, verify with dry-run, then wait for the next fixed slot. See Issue #438 and deployment/README.md.`;
  const comments = await api('GET', '/issues/438/comments?per_page=100');
  if (comments.length === 100) throw new Error('INCIDENT_COMMENT_LIST_INCOMPLETE');
  const previous = comments.find(item => item.user?.login === 'github-actions[bot]' && item.body?.startsWith(incidentMarker));
  return previous
    ? api('PATCH', '/issues/comments/' + previous.id, { body })
    : api('POST', '/issues/438/comments', { body });
}
async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const api = async (method, route, body) => {
    const args = ['api', '--method', method, 'repos/' + repo + route];
    if (body) args.push('--input', '-');
    const result = spawnSync('gh', args, { encoding: 'utf8', input: body ? JSON.stringify(body) : undefined });
    if (result.status !== 0) throw new Error('INCIDENT_REPORT_FAILED');
    return JSON.parse(result.stdout);
  };
  const runUrl = `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Production release blocked or failed\n\n[Inspect run](${runUrl}); no automatic deployment retry. Existing incident: #438.\n`);
  await reportReleaseFailure({ api, runUrl, sha: process.env.GITHUB_SHA, category: process.env.RELEASE_FAILURE_CATEGORY });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
