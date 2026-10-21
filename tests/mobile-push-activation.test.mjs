import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const ts = require('typescript');
const { pushBuildConfig, validateGoogleServices, parseGoogleServices } = require('./push-build-config.cjs');
const qaPackage = 'com.cetin072.taejang.staff.qa';
const projectId = 'd37ba52b-0010-4000-8000-000000000001';
const google = { project_info: { project_number: '123' }, client: [
  { client_info: { android_client_info: { package_name: qaPackage } } },
] };

test('QA config strips inherited production EAS and google-services defaults', () => {
  const config = require('./app.config.js');
  const keys = ['TAEJANG_APP_VARIANT', 'EXPO_PUBLIC_EAS_PROJECT_ID_QA', 'ANDROID_GOOGLE_SERVICES_FILE', 'TAEJANG_PUSH_CONFIG_REQUIRED'];
  const before = keys.map(key => process.env[key]);
  try {
    for (const key of keys) delete process.env[key];
    process.env.TAEJANG_APP_VARIANT = 'qa';
    const value = config({ config: { android: { package: 'com.cetin072.taejang.staff', googleServicesFile: 'production.json' },
      extra: { eas: { projectId } } } });
    assert.equal(value.android.package, qaPackage);
    assert.equal(value.android.googleServicesFile, undefined);
    assert.equal(value.extra.eas, undefined);
    assert.equal(value.extra.pushConfigured, false);
  } finally {
    keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; });
  }
});

test('native config rejects private credentials, package mixups, partial config and QA production fallback', () => {
  const root = mkdtempSync(join(tmpdir(), 'taejang-push-config-'));
  try {
    writeFileSync(join(root, 'google.json'), JSON.stringify(google));
    assert.throws(() => validateGoogleServices({ type: 'service_account' }, qaPackage), /EXPECTED_PUBLIC/);
    assert.throws(() => parseGoogleServices('private-sensitive-fixture'), error =>
      error.message === 'PUSH_INVALID_PUBLIC_GOOGLE_SERVICES_JSON');
    assert.throws(() => validateGoogleServices(google, 'com.cetin072.taejang.staff'), /PACKAGE_MISMATCH/);
    assert.equal(pushBuildConfig({ TAEJANG_APP_VARIANT: 'qa', EXPO_PUBLIC_EAS_PROJECT_ID: projectId }, qaPackage, root).configured, false);
    assert.throws(() => pushBuildConfig({ TAEJANG_PUSH_CONFIG_REQUIRED: 'true' }, qaPackage, root), /PROJECT_ID_REQUIRED/);
    assert.throws(() => pushBuildConfig({ EXPO_PUBLIC_EAS_PROJECT_ID: projectId }, qaPackage, root), /FILE_REQUIRED/);
    const result = pushBuildConfig({ TAEJANG_APP_VARIANT: 'qa', EXPO_PUBLIC_EAS_PROJECT_ID_QA: projectId,
      ANDROID_GOOGLE_SERVICES_FILE: 'google.json' }, qaPackage, root);
    assert.equal(result.projectId, projectId);
    assert.equal(result.configured, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function registration({ configured = true, permission = true, tokenError = false, rpcError = null } = {}) {
  const calls = [], saved = new Map();
  let user = 'user-1';
  const exports = {};
  const client = { auth: { getSession: async () => ({ data: { session: user ? { user: { id: user } } : null } }) },
    rpc: async (name, params) => { calls.push({ name, params }); return { data: { ok: !rpcError }, error: rpcError }; } };
  const modules = {
    'expo-constants': { __esModule: true, default: { expoConfig: { extra: { appVariant: 'qa', pushConfigured: configured, eas: { projectId } } }, nativeAppVersion: 'fixture' } },
    'expo-crypto': { randomUUID: () => 'installation-1' }, 'expo-device': { isDevice: true },
    'expo-notifications': { getPermissionsAsync: async () => ({ granted: permission }), getExpoPushTokenAsync: async () => {
      if (tokenError) throw Error('network unavailable'); return { data: 'ExponentPushToken[fixture]' };
    } },
    'react-native': { Platform: { OS: 'android' } },
    './native-notifications': { ensureNativeNotificationChannel: async () => {}, requestNativeNotificationPermission: async () => ({ granted: true }) },
    '@/src/platform/secure-storage': { secureSessionStorage: { getItem: async key => saved.get(key), setItem: async (key, value) => saved.set(key, value) } },
  };
  const code = ts.transpileModule(readFileSync(new URL('../mobile/src/notifications/push-registration.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => { if (!(name in modules)) throw Error(name); return modules[name]; },
    setTimeout, clearTimeout, process: { env: {} } });
  return { ...exports, client, calls, setUser: value => { user = value; } };
}

test('registration singleflight, session refresh dedupe, account switch, logout retain installation identity', async () => {
  const f = registration();
  await Promise.all(Array.from({ length: 5 }, () => f.registerCurrentPushDevice(f.client, { requestPermission: false })));
  await f.registerCurrentPushDevice(f.client, { requestPermission: false });
  assert.equal(f.calls.length, 1);
  f.setUser('user-2');
  await f.registerCurrentPushDevice(f.client, { requestPermission: false });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].params.p_installation_id, f.calls[1].params.p_installation_id);
  await f.disableCurrentPushDevice(f.client);
  assert.equal(f.calls.at(-1).name, 'disable_my_notification_device');
  assert.match(f.pushRegistrationMessage('registered'), /실제 알림 수신은 테스트 공지/);
});

test('registration maps missing native setup, permission, network and inactive account without claiming delivery', async () => {
  for (const [options, expected] of [
    [{ configured: false }, 'native_not_configured'], [{ permission: false }, 'permission_required'],
    [{ tokenError: true }, 'token_unavailable'], [{ rpcError: { code: '42501' } }, 'account_unavailable'],
  ]) {
    const f = registration(options);
    assert.equal((await f.registerCurrentPushDevice(f.client, { requestPermission: false })).status, expected);
  }
  const f = registration(); f.setUser(null);
  assert.equal((await f.registerCurrentPushDevice(f.client, { requestPermission: true })).status, 'session_required');
  assert.equal(f.calls.length, 0);
});

test('explicit permission action is not swallowed by an automatic registration already in flight', async () => {
  const f = registration({ permission: false });
  const automatic = f.registerCurrentPushDevice(f.client, { requestPermission: false });
  const explicit = f.registerCurrentPushDevice(f.client, { requestPermission: true });
  assert.equal((await automatic).status, 'permission_required');
  assert.equal((await explicit).status, 'registered');
  assert.equal(f.calls.length, 1);
});
