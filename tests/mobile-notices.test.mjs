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
  assert.match(api, /storage\.from\('notice-media'\)\.createSignedUrl/);
  assert.doesNotMatch(api, /from\(['"]notices['"]\)|\/rest\/v1\/notices/i);
});

test('home notice action sends one active notice directly to detail and multiple to list', async () => {
  const homeAction = await text('mobile/src/features/notices/notice-home-action.tsx');
  assert.match(homeAction, /visibleItems\.length === 1/);
  assert.match(homeAction, /router\.push\(noticeDeepLinkPath\(visibleItems\[0\]\.id\)\)/);
  assert.match(homeAction, /router\.push\('\/notices'\)/);
  assert.match(homeAction, /공지사항/);
});

test('notice list route uses large current-notice cards and handles empty state', async () => {
  const list = await text('mobile/app/notices/index.tsx');
  const cache = await text('mobile/src/features/notices/notice-cache.ts');
  assert.match(list, /loadMyNotices/);
  assert.match(list, /getCachedNotices/);
  assert.match(list, /cacheNotices/);
  assert.match(list, /cached\.length === 0/);
  assert.match(list, /현재 확인할 공지가 없습니다/);
  assert.match(list, /noticeDeepLinkPath/);
  assert.match(list, /minHeight:\s*118/);
  assert.match(cache, /Map<string, NoticeCacheEntry>/);
  assert.match(cache, /userId/);
});

test('notice detail route can acknowledge the exact current notice version', async () => {
  const detail = await text('mobile/app/notices/[id].tsx');
  assert.match(detail, /useLocalSearchParams/);
  assert.match(detail, /loadMyNoticeDetail/);
  assert.match(detail, /acknowledgeMyNotice/);
  assert.match(detail, /notice\.version_no/);
  assert.match(detail, /내용 확인했습니다/);
  assert.match(detail, /notice\.media\.map/);
  assert.match(detail, /loadNoticeMediaUrl/);
  assert.match(detail, /사진을 준비하고 있습니다/);
});

test('notice detail renders the RPC text before independent signed-media loading', async () => {
  const api = await text('mobile/src/features/notices/notice-api.ts');
  const detail = await text('mobile/app/notices/[id].tsx');
  const provider = await text('mobile/src/providers/platform-provider.tsx');
  assert.match(api, /export async function loadNoticeMediaUrl/);
  assert.doesNotMatch(api, /media:\s*await/);
  assert.match(api, /catch\s*\{\s*return null;/);
  assert.match(detail, /<NoticePhoto/);
  assert.match(detail, /사진을 불러오지 못했습니다/);
  assert.match(detail, /cache:\s*'force-cache'/);
  assert.match(detail, /resizeMethod="resize"/);
  assert.match(provider, /clearNoticeCache\(userId\)/);
});

test('notice route is suitable for native push deep linking', async () => {
  const api = await text('mobile/src/features/notices/notice-api.ts');
  assert.match(api, /\/notices\/\$\{encodeURIComponent\(noticeId\)\}/);
  const app = JSON.parse(await text('mobile/app.json'));
  assert.equal(app.expo.scheme, 'taejangstaff');
});

test('mobile notice slice does not broaden manager scope', async () => {
  const api = await text('mobile/src/features/notices/notice-api.ts');
  const detail = await text('mobile/app/notices/[id].tsx');
  const list = await text('mobile/app/notices/index.tsx');
  assert.doesNotMatch(api + detail + list, /service_role|SUPABASE_SERVICE_ROLE_KEY|save_notice|list_manageable_notices/i);
});
