import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('employee app exposes privacy and account deletion resources in app UI', async () => {
  const home = await text('mobile/app/index.tsx');
  assert.match(home, /https:\/\/taejang\.co\.kr\/employee-app-privacy\.html/);
  assert.match(home, /https:\/\/taejang\.co\.kr\/account-deletion\.html/);
  assert.match(home, /개인정보처리방침/);
  assert.match(home, /계정 삭제 요청/);
  assert.match(home, /accessibilityRole="link"/);
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

test('Android Play identity has an explicit initial versionCode', async () => {
  const app = JSON.parse(await text('mobile/app.json'));
  assert.equal(app.expo.android.package, 'com.cetin072.taejang.staff');
  assert.equal(app.expo.android.versionCode, 1);
});
