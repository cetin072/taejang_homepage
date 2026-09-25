import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('employee app keeps deletion out of the login screen and exposes it to every authenticated account through settings', async () => {
  const home = await text('mobile/app/index.tsx');
  const settings = await text('mobile/app/settings.tsx');
  const links = await text('mobile/src/features/common/policy-links.tsx');
  assert.match(home, /<PolicyLinks\s*\/>/);
  assert.doesNotMatch(home, /계정 삭제 요청|account-deletion/);
  assert.match(settings, /<PolicyLinks includeAccountDeletion\s*\/>/);
  assert.match(settings, /get_my_access_context_v2/);
  assert.match(settings, /access\?\.display_name\?\.trim\(\)/);
  assert.match(home, /access\?\.account_status === 'pending'[\s\S]*?<AccountSettingsAction onPress=\{\(\) => router\.push\('\/settings'\)\}/);
  assert.match(home, /access\?\.account_status !== 'active'[\s\S]*?<AccountSettingsAction onPress=\{\(\) => router\.push\('\/settings'\)\}/);
  assert.match(settings, /앱 버전/);
  assert.match(settings, /로그아웃/);
  assert.match(links, /employee-app-privacy\.html/);
  assert.match(links, /account-deletion\.html/);
  assert.match(links, /accessibilityRole="link"/);
});

test('employee app privacy policy documents actual mobile data handling', async () => {
  const policy = await text('employee-app-privacy.html');
  assert.match(policy, /태장 직원앱 개인정보처리방침/);
  assert.match(policy, /이름, 이메일 주소, 전화번호, 입사일/);
  assert.match(policy, /위도·경도/);
  assert.match(policy, /백그라운드 위치 추적을 사용하지 않습니다/);
  assert.match(policy, /Expo Push Token/);
  assert.match(policy, /Supabase/);
  assert.match(policy, /Expo/);
  assert.match(policy, /account-deletion\.html/);
});

test('account deletion web resource is explicit and does not ask for passwords', async () => {
  const deletion = await text('account-deletion.html');
  assert.match(deletion, /태장 직원앱 계정 삭제 요청/);
  assert.match(deletion, /로그인 이메일 주소/);
  assert.match(deletion, /비밀번호를 요구하지 않습니다/);
  assert.match(deletion, /근태, 급여/);
  assert.match(deletion, /mailto:taejang2025@naver\.com/);
});

test('Android Play identity advances the 0.1.2 closed-test candidate versionCode', async () => {
  const app = JSON.parse(await text('mobile/app.json'));
  assert.equal(app.expo.name, '태장');
  assert.equal(app.expo.version, '0.1.2');
  assert.equal(app.expo.android.package, 'com.cetin072.taejang.staff');
  assert.equal(app.expo.android.versionCode, 3);
  assert.equal(app.expo.android.adaptiveIcon.backgroundColor, '#FDFCFD');
  assert.equal(app.expo.android.adaptiveIcon.foregroundImage, './assets/taejang-adaptive-foreground.png');
  assert.equal(app.expo.icon, './assets/taejang-launcher-icon.png');
  assert.equal(app.expo.splash.image, './assets/taejang-launcher-icon.png');
  assert.equal(app.expo.splash.backgroundColor, '#FDFCFD');
  assert.equal(app.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-location')[1].isAndroidBackgroundLocationEnabled, false);

  const [launcher, foreground] = await Promise.all([
    stat(new URL('../mobile/assets/taejang-launcher-icon.png', import.meta.url)),
    stat(new URL('../mobile/assets/taejang-adaptive-foreground.png', import.meta.url)),
  ]);
  assert.ok(launcher.size > 0);
  assert.ok(foreground.size > 0);
  const signature = (await readFile(new URL('../mobile/assets/taejang-launcher-icon.png', import.meta.url))).subarray(0, 8);
  assert.deepEqual([...signature], [137, 80, 78, 71, 13, 10, 26, 10]);
});
