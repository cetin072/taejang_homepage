import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('mobile notice API reuses existing guarded Supabase RPC contracts', async () => {
  const api = await text('mobile/src/features/notices/notice-api.ts');
  assert.match(api, /get_my_notice_list/);
  assert.match(api, /get_my_notice_detail/);
  assert.match(api, /acknowledge_notice/);
  assert.doesNotMatch(api, /from\(['"]notices['"]\)|\/rest\/v1\/notices/i);
});

test('notice list marks acknowledgement state and opens an exact notice route', async () => {
  const list = await text('mobile/src/features/notices/notice-list-card.tsx');
  assert.match(list, /requires_acknowledgement/);
  assert.match(list, /acknowledged/);
  assert.match(list, /noticeDeepLinkPath/);
  assert.match(list, /router\.push/);
});

test('notice detail route can acknowledge the exact current notice version', async () => {
  const detail = await text('mobile/app/notices/[id].tsx');
  assert.match(detail, /useLocalSearchParams/);
  assert.match(detail, /loadMyNoticeDetail/);
  assert.match(detail, /acknowledgeMyNotice/);
  assert.match(detail, /notice\.version_no/);
  assert.match(detail, /내용 확인했습니다/);
});

test('notice route is suitable for future native push deep linking', async () => {
  const api = await text('mobile/src/features/notices/notice-api.ts');
  assert.match(api, /\/notices\/\$\{encodeURIComponent\(noticeId\)\}/);
  const app = JSON.parse(await text('mobile/app.json'));
  assert.equal(app.expo.scheme, 'taejangstaff');
});

test('mobile notice slice does not introduce a new backend or broaden manager scope', async () => {
  const api = await text('mobile/src/features/notices/notice-api.ts');
  const detail = await text('mobile/app/notices/[id].tsx');
  assert.doesNotMatch(api + detail, /service_role|SUPABASE_SERVICE_ROLE_KEY|save_notice|list_manageable_notices/i);
});
