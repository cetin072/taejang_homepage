import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) { return readFile(new URL(`../${path}`, import.meta.url), 'utf8'); }

test('upcoming schedule uses guarded server reads and no employee schedule mutation', async () => {
  const api = await text('mobile/src/features/schedules/schedule-api.ts');
  const list = await text('mobile/app/schedules/index.tsx');
  const detail = await text('mobile/app/schedules/[id].tsx');
  const home = await text('mobile/src/features/schedules/schedule-home-action.tsx');

  assert.match(api, /get_my_schedule_list/);
  assert.match(api, /get_my_schedule_detail/);
  assert.match(api, /korea_current_date\(\)/);
  assert.doesNotMatch(api, /rpc\([^)]*(?:insert|update|delete|create|edit|save)/i);
  assert.match(list, /가까운 일정만 시간순으로 보여드립니다/);
  assert.match(list, /취소된 일정/);
  assert.match(detail, /준비물 ·/);
  assert.match(home, /AppState\.addEventListener\('change'/);
});

test('schedule is a simple home destination and native push can deep-link safely', async () => {
  const home = await text('mobile/app/index.tsx');
  const bridge = await text('mobile/src/notifications/push-notification-bridge.tsx');
  assert.ok(home.indexOf('<ScheduleHomeAction') > home.indexOf('<NoticeHomeAction'));
  assert.match(bridge, /data\?\.target === 'schedule'/);
  assert.match(bridge, /scheduleDeepLinkPath/);
});
