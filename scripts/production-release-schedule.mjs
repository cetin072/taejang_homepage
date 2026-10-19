import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const liveRunTitle = 'Production release | live';
const hour = 3_600_000;

// The daily trigger is only a wake-up. Slot zero is the anchor, not a release.
export function calendarSlot(policy, at) {
  const anchor = Date.parse(policy.schedule_anchor_utc), time = new Date(at).getTime();
  if (!Number.isFinite(anchor) || !Number.isFinite(time)
    || policy.schedule_interval_hours !== 48 || policy.schedule_window_hours !== 24) throw new Error('INVALID_RELEASE_SCHEDULE');
  const interval = 48 * hour, window = 24 * hour;
  const index = Math.floor((time - anchor) / interval);
  const start = anchor + index * interval;
  const due = index >= 1 && time < start + window;
  return {
    status: due ? 'DUE' : 'WAITING_SLOT',
    slot: due ? { index, start_utc: new Date(start).toISOString(), expires_utc: new Date(start + window).toISOString() } : null,
    next_check_utc: new Date(anchor + Math.max(1, index + 1) * interval).toISOString(),
  };
}

export function currentSlot(schedule, now) {
  const time = new Date(now).getTime();
  return schedule?.status === 'DUE' && Number.isFinite(time)
    && time >= Date.parse(schedule.slot.start_utc) && time < Date.parse(schedule.slot.expires_utc);
}

export function evaluateSchedule({ policy, run, previousRuns, now }) {
  if (!run?.id || !Number.isFinite(Date.parse(run.created_at)) || run.head_branch !== 'main'
    || !['schedule', 'workflow_dispatch'].includes(run.event)) throw new Error('INVALID_SCHEDULE_RUN');
  const schedule = calendarSlot(policy, run.created_at);
  if (schedule.status !== 'DUE') return schedule;
  if (!currentSlot(schedule, now)) return { ...schedule, status: 'MISSED_SLOT' };
  // A retry is observation, never a second release attempt in this slot.
  if (run.run_attempt > 1) return { ...schedule, status: 'SLOT_ALREADY_CHECKED' };
  for (const other of previousRuns) {
    if (other.id === run.id || other.head_branch !== 'main') continue;
    const live = other.event === 'schedule' || (other.event === 'workflow_dispatch' && other.display_title === liveRunTitle);
    if (!live) continue;
    if (!Number.isFinite(Date.parse(other.created_at))) throw new Error('INVALID_PREVIOUS_SCHEDULE_RUN');
    // Include failed/cancelled/queued runs, and break simultaneous runs by ID.
    if (Date.parse(other.created_at) > Date.parse(run.created_at)
      || (other.created_at === run.created_at && BigInt(other.id) > BigInt(run.id))) continue;
    if (calendarSlot(policy, other.created_at).slot?.index === schedule.slot.index) return { ...schedule, status: 'SLOT_ALREADY_CHECKED' };
  }
  return schedule;
}

export async function readSchedule({ policy, env = process.env, now = new Date(), fetcher = fetch }) {
  if (!env.GITHUB_RUN_ID) {
    if (env.DRY_RUN !== 'true') throw new Error('HOSTED_SCHEDULE_REQUIRED');
    return calendarSlot(policy, now);
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || '')
    || !/^\d+$/.test(env.GITHUB_RUN_ID) || !env.GH_TOKEN) throw new Error('SCHEDULE_READ_AUTH_REQUIRED');
  const get = async route => {
    const response = await fetcher('https://api.github.com/repos/' + env.GITHUB_REPOSITORY + route, {
      headers: { Authorization: 'Bearer ' + env.GH_TOKEN, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error('SCHEDULE_READ_HTTP_' + response.status);
    return response.json();
  };
  const run = await get('/actions/runs/' + env.GITHUB_RUN_ID);
  const slot = calendarSlot(policy, run.created_at);
  if (slot.status !== 'DUE') return slot;
  const query = new URLSearchParams({ branch: 'main', per_page: '100', created: slot.slot.start_utc + '..' + slot.slot.expires_utc });
  const runs = await get('/actions/workflows/production-release.yml/runs?' + query);
  if (!Array.isArray(runs.workflow_runs) || runs.total_count > runs.workflow_runs.length || runs.workflow_runs.length >= 100) throw new Error('SLOT_HISTORY_INCOMPLETE');
  return evaluateSchedule({ policy, run, previousRuns: runs.workflow_runs, now });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const policy = JSON.parse(readFileSync('deployment/release-policy.json', 'utf8'));
  const preview = process.env.DRY_RUN === 'true' && process.env.GITHUB_REF !== 'refs/heads/main';
  const schedule = await readSchedule({ policy, env: preview ? { ...process.env, GITHUB_RUN_ID: '' } : process.env });
  if (process.env.RELEASE_SCHEDULE_PATH) writeFileSync(process.env.RELEASE_SCHEDULE_PATH, JSON.stringify(schedule, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'status=' + schedule.status + '\n');
  console.log(JSON.stringify(schedule));
}
