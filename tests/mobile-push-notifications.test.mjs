import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('mobile remote push dependencies and project id are explicit', async () => {
  const pkg = JSON.parse(await text('mobile/package.json'));
  const env = await text('mobile/.env.example');
  assert.equal(pkg.dependencies['expo-device'], '57.0.2');
  assert.equal(pkg.dependencies['expo-crypto'], '57.0.3');
  assert.match(env, /EXPO_PUBLIC_EAS_PROJECT_ID=/);
  assert.doesNotMatch(env, /EXPO_PUSH_ACCESS_TOKEN|SERVICE_ROLE|PRIVATE_KEY/i);
});

test('mobile push registration requires physical device, project id, permission, and guarded RPC', async () => {
  const source = await text('mobile/src/notifications/push-registration.ts');
  assert.match(source, /Device\.isDevice/);
  assert.match(source, /EXPO_PUBLIC_EAS_PROJECT_ID/);
  assert.match(source, /getExpoPushTokenAsync\(\{\s*projectId:/);
  assert.match(source, /register_my_notification_device/);
  assert.match(source, /disable_my_notification_device/);
  assert.match(source, /Crypto\.randomUUID\(\)/);
  assert.doesNotMatch(source, /console\.(?:log|info|debug).*token/i);
});

test('notification response opens the exact notice route on cold and warm start', async () => {
  const bridge = await text('mobile/src/notifications/push-notification-bridge.tsx');
  assert.match(bridge, /getLastNotificationResponseAsync/);
  assert.match(bridge, /addNotificationResponseReceivedListener/);
  assert.match(bridge, /noticeDeepLinkPath/);
  assert.match(bridge, /target.*notice/s);
  assert.match(bridge, /clearLastNotificationResponseAsync/);
});

test('signout best-effort disables device before ending auth session', async () => {
  const provider = await text('mobile/src/providers/platform-provider.tsx');
  const disableIndex = provider.indexOf('disableCurrentPushDevice(client)');
  const signOutIndex = provider.indexOf('client.auth.signOut()');
  assert.ok(disableIndex >= 0 && signOutIndex > disableIndex);
  assert.match(provider, /Signing out must still work if the device-disable request is offline/);
});

test('employee notification CTA registers native remote push instead of only local permission', async () => {
  const home = await text('mobile/app/index.tsx');
  const native = await text('mobile/src/notifications/native-notifications.ts');
  assert.match(home, /registerCurrentPushDevice/);
  assert.match(home, /중요공지 Push 알림이 준비되었습니다/);
  assert.match(native, /remotePushTokenRegistrationImplemented:\s*true/);
});
