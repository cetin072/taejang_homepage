// Resume only untouched bot-owned data proposals. Never overwrite human review work.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export const DATA = 'assets/js/official-channel-updates.js';
const BOT = '41898282+github-actions[bot]@users.noreply.github.com';
export function validateProposal(pr, files, authors, repository) {
  if (!pr.isDraft || pr.state !== 'OPEN' || pr.author?.login !== 'github-actions[bot]' ||
      pr.headRepositoryOwner?.login + '/' + pr.headRepository?.name !== repository ||
      !/^automation\/official-archive-[\w-]+$/.test(pr.headRefName) ||
      files.some(file => file !== DATA) || !files.length ||
      !authors.length || authors.some(author => author !== BOT)) {
    throw Error('PENDING_REVIEW: archive PR has human changes, is Ready, or is not a bot-only data proposal; leave it untouched.');
  }
}
export function prepare(run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim(), env = process.env) {
  const pending = JSON.parse(run('gh', ['pr', 'list', '--state', 'open', '--limit', '1000', '--json',
    'number,headRefName'])).filter(pr => pr.headRefName.startsWith('automation/official-archive-'));
  if (!pending.length) return {};
  if (pending.length !== 1) throw Error('PENDING_REVIEW: multiple archive proposals need human reconciliation.');
  const pr = JSON.parse(run('gh', ['pr', 'view', String(pending[0].number), '--json',
    'number,state,isDraft,author,headRefName,headRefOid,headRepository,headRepositoryOwner']));
  // Fetch the advertised branch, then pin and validate its exact commit before checkout.
  run('git', ['fetch', 'origin', pr.headRefName]);
  if (run('git', ['rev-parse', 'FETCH_HEAD']) !== pr.headRefOid) throw Error('Archive head changed; retry next run.');
  const files = run('git', ['diff', '--name-only', 'origin/main...' + pr.headRefOid]).split('\n').filter(Boolean);
  const authors = run('git', ['log', '--format=%ae', 'origin/main..' + pr.headRefOid]).split('\n').filter(Boolean);
  validateProposal(pr, files, authors, env.GITHUB_REPOSITORY);
  run('git', ['config', 'user.name', 'github-actions[bot]']);
  run('git', ['config', 'user.email', BOT]);
  run('git', ['switch', '-c', pr.headRefName, pr.headRefOid]);
  // Keep current collector/tests and all pending archive entries. Conflicts fail closed.
  run('git', ['merge', '--no-edit', 'origin/main']);
  return { branch: pr.headRefName, number: pr.number, head: pr.headRefOid };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = prepare();
  if (process.env.GITHUB_OUTPUT) for (const [key, value] of Object.entries(result)) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}
