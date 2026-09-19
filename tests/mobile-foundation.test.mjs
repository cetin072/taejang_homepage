import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Taejang mobile foundation pins the reused Expo 57 compatible stack', async () => {
  const pkg = JSON.parse(await text('mobile/package.json'));
  assert.equal(pkg.main, 'expo-router/entry');
  assert.equal(pkg.dependencies.expo, '57.0.24');
  assert.equal(pkg.dependencies['expo-router'], '57.0.22');
  assert.equal(pkg.dependencies['react-native'], '0.86.3');
  assert.equal(pkg.dependencies['@supabase/supabase-js'], '2.116.0');
  assert.ok(pkg.dependencies['expo-secure-store']);
  assert.ok(pkg.dependencies['expo-notifications']);
  assert.equal(pkg.dependencies['react-dom'], '19.2.3');
  assert.equal(pkg.dependencies['react-native-reanimated'], '4.5.1');
  assert.equal(pkg.dependencies['react-native-worklets'], '0.10.1');

  for (const version of Object.values({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.doesNotMatch(String(version), /^[~^]/, 'mobile direct dependencies must be pinned exactly');
  }
});

test('mobile config reuses Taejang public staff-config and no secret key', async () => {
  const config = await text('mobile/src/platform/config.ts');
  const env = await text('mobile/.env.example');
  assert.match(config, /https:\/\/taejang\.co\.kr/);
  assert.match(config, /\.netlify\/functions\/staff-config/);
  assert.match(config, /publishableKey/);
  assert.doesNotMatch(config + env, /SERVICE_ROLE|sb_secret_|PRIVATE_KEY/i);
});

test('mobile auth reuses Supabase session with SecureStore persistence', async () => {
  const storage = await text('mobile/src/platform/secure-storage.ts');
  const supabase = await text('mobile/src/platform/supabase.ts');
  const provider = await text('mobile/src/providers/platform-provider.tsx');

  assert.match(storage, /expo-secure-store/);
  assert.match(storage, /AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY/);
  assert.match(supabase, /persistSession:\s*true/);
  assert.match(supabase, /autoRefreshToken:\s*true/);
  assert.match(provider, /startAutoRefresh/);
  assert.match(provider, /stopAutoRefresh/);
  assert.match(provider, /signInWithPassword/);
  assert.match(provider, /signUpEmployee/);
});

test('native notification foundation preserves Android channel and permission handling', async () => {
  const notifications = await text('mobile/src/notifications/native-notifications.ts');
  assert.match(notifications, /expo-notifications/);
  assert.match(notifications, /AndroidImportance\.HIGH/);
  assert.match(notifications, /requestPermissionsAsync/);
  assert.match(notifications, /taejang-important-notices/);
});

test('first mobile screen is Taejang branded and keeps technical status off the home surface', async () => {
  const appConfig = JSON.parse(await text('mobile/app.json'));
  const app = await text('mobile/app/index.tsx');
  assert.equal(appConfig.expo.name, '태장');
  assert.match(app, /태장 업무플랫폼/);
  assert.match(app, /가입 요청/);
  assert.match(app, /AttendanceCard/);
  assert.match(app, /NoticeHomeAction/);
  assert.match(app, /업무 플랫폼 열기/);
  assert.doesNotMatch(app, /로그인 상태|SecureStore 기반 세션|중요공지 알림 준비|직원앱 준비 완료/);
  assert.doesNotMatch(app, /급여 계산|급여 확정|월잠금|은행/);
});

test('mobile CI generates a clean lock then builds an ARM64 Android artifact', async () => {
  const workflow = await text('.github/workflows/mobile-app.yml');
  assert.match(workflow, /rm -f package-lock\.json/);
  assert.match(workflow, /npm install --package-lock-only --ignore-scripts --no-audit --no-fund/);
  assert.match(workflow, /taejang-mobile-generated-lock/);
  assert.match(workflow, /npm ci --no-audit --no-fund/);
  assert.match(workflow, /expo install --check/);
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /expo prebuild --platform android --no-install/);
  assert.match(workflow, /assembleRelease -PreactNativeArchitectures=arm64-v8a/);
  assert.match(workflow, /taejang-employee-mobile-arm64-apk/);
});
