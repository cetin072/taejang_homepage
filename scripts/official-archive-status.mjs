// Persist only public collection metadata. Reuse Actions summary/cache/artifacts.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { operationStatus, canCompleteSlot } from './sync-official-archive.mjs';

async function read(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
const state = await read(process.env.ARCHIVE_STATE);
const report = await read(process.env.ARCHIVE_REPORT);
const pending = JSON.parse(execFileSync('gh', ['pr', 'list', '--state', 'open', '--limit', '1000',
  '--json', 'number,headRefName,url,isDraft'], { encoding: 'utf8' }))
  .filter(pr => pr.headRefName.startsWith('automation/official-archive-'));
if (report.collectedAt && process.env.GITHUB_EVENT_NAME === 'schedule') {
  state.lastCollection = report;
  // Retry an incomplete slot on the next daily wake-up. Never acknowledge a
  // slot while a content proposal remains unreviewed.
  if (canCompleteSlot(report, pending.length)) {
    state.lastCompletedSlot = state.currentSlot;
  }
}
state.pendingReview = pending;
const collectionStatus = report.status || state.lastCollection?.status;
state.status = operationStatus(collectionStatus, pending.length);
await writeFile(process.env.ARCHIVE_STATE, JSON.stringify(state, null, 2));
await writeFile(process.env.GITHUB_STEP_SUMMARY,
  '\n### Official archive operation status\n\n```json\n' + JSON.stringify(state, null, 2) + '\n```\n', { flag: 'a' });
