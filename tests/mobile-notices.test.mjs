import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('mobile notices reuse existing Taejang RPC contracts', async () => {
  const api = await text('mobile/src/features/notices/notice-api.ts');
  assert.match(api, /get_my_notice_list/);
  assert.match(api, /get_my_notice_detail/);
  assert.match(api, /acknowledge_notice/);
  assert.match(api, /p_notice_version/);
  assert.match(api, /NOTICE_VERSION_CHANGED/);
  assert.doesNotMatch(api, /service_role|SUPABASE_SERVICE_ROLE_KEY|sb_secret_/i);
});

test('mobile notice list prioritizes urgent important and acknowledgement-needed notices', async () => {
  const api = await text('mobile/src/features/notices/notice-api.ts');
  const list = await text('mobile/app/notices.tsx');
  assert.match(api, /importance === 'urgent'/);
  assert.match(api, /importance === 'important'/);
  assert.match(api, /requires_acknowledgement && !item\.acknowledged/);
  assert.match(list, /확인 필요/);
  assert.match(list, /긴급·중요·미확인 공지가 먼저/);
});

test('employee home shows notice preview before attendance placeholder', async () => {
  const app = await text('mobile/app/index.tsx');
  const noticeIndex = app.indexOf('공지사항');
  const attendanceIndex = app.indexOf('출퇴근');
  assert.ok(noticeIndex >= 0 && attendanceIndex > noticeIndex);
  assert.match(app, /router\.push\('\/notices'\)/);
  assert.match(app, /pathname: '\/notice\/\[id\]'/);
});

test('notice detail is a stable future push deep-link target', async () => {
  const detail = await text('mobile/app/notice/[id].tsx');
  assert.match(detail, /useLocalSearchParams/);
  assert.match(detail, /loadMyNoticeDetail/);
  assert.match(detail, /공지 내용을 확인했습니다/);
  assert.match(detail, /공지가 수정되었습니다\. 최신 내용을 다시 불러왔습니다/);
  assert.match(detail, /acknowledgeMyNotice/);
});

test('notice related links accept only safe https without embedded credentials', async () => {
  const api = await text('mobile/src/features/notices/notice-api.ts');
  assert.match(api, /parsed\.protocol !== 'https:' /);
  assert.match(api, /parsed\.username \|\| parsed\.password/);
  const detail = await text('mobile/app/notice/[id].tsx');
  assert.match(detail, /safeNoticeHttpsUrl/);
  assert.match(detail, /Linking\.openURL/);
});

test('remote push remains outside this notice slice', async () => {
  const notification = await text('mobile/src/notifications/native-notifications.ts');
  const api = await text('mobile/src/features/notices/notice-api.ts');
  assert.match(notification, /remotePushTokenRegistrationImplemented:\s*false/);
  assert.doesNotMatch(notification + api, /getExpoPushTokenAsync|getDevicePushTokenAsync/);
});
