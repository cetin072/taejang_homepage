import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('today work reuses the guarded server board without employee progress writes', async () => {
  const api = await text('mobile/src/features/today/today-work-api.ts');
  const action = await text('mobile/src/features/today/today-work-action.tsx');
  const screen = await text('mobile/app/today.tsx');

  assert.match(api, /get_my_today_board/);
  assert.doesNotMatch(api, /insert|update|delete|rpc\([^)]*(?:save|complete|progress)/i);
  assert.match(action, /task\.status === 'published'/);
  assert.match(action, /AppState\.addEventListener\('change'/);
  assert.match(action, /router\.push\('\/today'\)/);
  assert.match(screen, /오늘 해야 할 일을 확인한 뒤 현장 안내에 따라주세요/);
  assert.match(screen, /index \+ 1}번째 업무/);
  assert.doesNotMatch(screen, /완료 처리|진행률|실적|작업 시작/);
});

test('mobile home keeps Today Work between attendance and notices', async () => {
  const home = await text('mobile/app/index.tsx');
  const attendance = home.indexOf('<AttendanceCard');
  const today = home.indexOf('<TodayWorkAction');
  const notices = home.indexOf('<NoticeHomeAction');

  assert.ok(attendance >= 0 && today > attendance && notices > today);
});
