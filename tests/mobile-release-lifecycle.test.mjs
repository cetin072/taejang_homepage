import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

async function releasePolicyModule() {
  const source = (await text('mobile/src/platform/release-policy.ts'))
    .replace(/import Constants from 'expo-constants';\r?\n\r?\n/, '')
    .replace(/import type \{ PublicMobileReleasePolicy \} from '\.\/config';\r?\n\r?\n/, '');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const basePolicy = {
  latestVersion: null, latestVersionCode: null, minimumVersion: null, minimumVersionCode: null,
  forceUpdate: false, updateTitle: null, updateMessage: null, storeUrl: null,
  releaseNotesVersion: null, releaseNotes: null, maintenanceMode: false, maintenanceMessage: null,
};

test('version policy compares semantic versions and Android versionCode safely', async () => {
  const { compareSemanticVersions, decideUpdate } = await releasePolicyModule();
  assert.equal(compareSemanticVersions('0.1.2', '0.1.1'), 1);
  assert.equal(compareSemanticVersions('1.0.0-beta.1', '1.0.0'), -1);
  assert.equal(compareSemanticVersions('broken', '1.0.0'), null);
  assert.equal(decideUpdate({ version: '0.1.1', versionCode: 2 }, { ...basePolicy, latestVersion: '0.1.2', latestVersionCode: 3 }), 'optional');
  assert.equal(decideUpdate({ version: '0.1.1', versionCode: 2 }, { ...basePolicy, minimumVersion: '0.1.2', minimumVersionCode: 3 }), 'forced');
  assert.equal(decideUpdate({ version: '0.1.2', versionCode: 3 }, { ...basePolicy, latestVersion: '0.1.2', latestVersionCode: 3, forceUpdate: true }), 'none');
});

test('release lifecycle has a centrally supplied public policy without secrets', async () => {
  const endpoint = await text('netlify/functions/staff-config.mjs');
  const config = await text('mobile/src/platform/config.ts');
  assert.match(endpoint, /MOBILE_LATEST_VERSION/);
  assert.match(endpoint, /MOBILE_MINIMUM_VERSION/);
  assert.match(endpoint, /MOBILE_FORCE_UPDATE/);
  assert.match(endpoint, /MOBILE_MAINTENANCE_MODE/);
  assert.match(endpoint, /mobileRelease/);
  assert.match(config, /mobileRelease/);
  assert.doesNotMatch(endpoint, /SERVICE_ROLE|PRIVATE_KEY|ACCESS_TOKEN/i);
});

test('update, maintenance, release notes, and simple recovery UX remain visible and accessible', async () => {
  const lifecycle = await text('mobile/src/platform/update-lifecycle.tsx');
  const settings = await text('mobile/app/settings.tsx');
  const support = await text('mobile/app/support.tsx');
  const provider = await text('mobile/src/providers/platform-provider.tsx');
  const errors = await text('mobile/src/platform/friendly-error.ts');
  assert.match(lifecycle, /decideUpdate/);
  assert.match(lifecycle, /나중에/);
  assert.match(lifecycle, /업데이트/);
  assert.match(lifecycle, /잠시 점검 중입니다/);
  assert.match(lifecycle, /release-notes\.seen/);
  assert.match(settings, /Linking\.openSettings/);
  assert.match(settings, /공지 알림 설정/);
  assert.match(support, /로그인 토큰, 위치 정보는 표시하지 않습니다/);
  assert.match(support, /연결 다시 확인/);
  assert.match(provider, /refreshSession/);
  assert.match(await text('mobile/app/index.tsx'), /AppState\.addEventListener/);
  assert.match(errors, /인터넷 연결/);
  assert.match(errors, /로그인 시간이 만료/);
});

test('0.1.2 splash uses the approved Taejang launcher asset without a fake delay', async () => {
  const app = JSON.parse(await text('mobile/app.json'));
  assert.equal(app.expo.version, '0.1.2');
  assert.equal(app.expo.android.versionCode, 3);
  assert.equal(app.expo.splash.image, './assets/taejang-launcher-icon.png');
  assert.equal(app.expo.splash.resizeMode, 'contain');
  assert.equal(app.expo.splash.backgroundColor, '#FDFCFD');
});
