import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const jsx = (type, props) => ({ type, props });
function load(path, modules = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, URL, AbortController, setTimeout, clearTimeout, process: { env: {} },
    require: name => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name in modules) return modules[name];
      throw new Error(`Unexpected dependency: ${name}`);
    }, ...globals });
  return exports;
}
const installed = { version: '0.1.3', versionCode: 4 };
const release = load('mobile/src/platform/release-policy.ts', { 'expo-constants': {
  nativeAppVersion: installed.version, nativeBuildVersion: String(installed.versionCode),
  expoConfig: { version: '99.0.0', android: { versionCode: 999 } },
} });
const base = { latestVersion: null, latestVersionCode: null, minimumVersion: null, minimumVersionCode: null,
  forceUpdate: false, maintenanceMode: false, releaseNotes: null, releaseNotesVersion: null };
const optional = { ...base, latestVersion: '0.1.4', latestVersionCode: 5 };
const forced = { ...optional, minimumVersion: '0.1.4', minimumVersionCode: 5 };
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
function nodes(tree) {
  if (tree == null || tree === false) return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== 'object') return [tree];
  return [tree, ...nodes(tree.props?.children)];
}

function fixture(initialPolicy = optional, qa = false) {
  const states = [], dependencies = [], pending = [], cleanups = [];
  let cursor = 0, listener, nextPolicy = initialPolicy, fetchFailure = false;
  const urls = [], fetches = [], failUrls = new Set();
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = value; }];
    },
    useMemo: fn => fn(),
    useEffect(fn, deps) {
      const index = cursor++;
      if (!dependencies[index] || deps.some((v, i) => v !== dependencies[index][i])) {
        pending.push(() => { cleanups[index]?.(); cleanups[index] = fn(); });
        dependencies[index] = deps;
      }
    },
  };
  const native = { View: 'View', Text: 'Text', Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView',
    StyleSheet: { create: value => value }, AppState: { currentState: 'active', addEventListener: (_event, fn) => {
      listener = fn; return { remove() { listener = undefined; } };
    } } };
  const lifecycle = load('mobile/src/platform/update-lifecycle.tsx', {
    react, 'react-native': native, './app-variant': { isQaApp: qa }, './release-policy': release,
    './config': { loadPublicMobileReleasePolicy: async () => {
      fetches.push('policy'); if (fetchFailure) throw new Error('offline'); return nextPolicy;
    } },
    'expo-linking': { openURL: async url => { urls.push(url); if (failUrls.has(url)) throw new Error('unavailable'); } },
    './secure-storage': { secureSessionStorage: { getItem: async () => null, setItem: async () => {} } },
    '@/src/providers/platform-provider': { usePlatform: () => ({ config: { mobileRelease: initialPolicy } }) },
  });
  function render() { cursor = 0; return nodes(lifecycle.UpdateLifecycle()); }
  function visible() { return render().filter(n => n?.type === 'Modal' && n.props.visible).flatMap(nodes); }
  const button = label => visible().find(n => n?.type === 'Pressable' && n.props.accessibilityLabel === label);
  return { urls, fetches, failUrls, render, visible, button,
    async flush() { render(); for (const effect of pending.splice(0)) effect(); await settle(); render(); },
    async press(label) { assert.ok(button(label), label); await button(label).props.onPress(); await settle(); },
    async resume(policy = nextPolicy, fail = false) {
      nextPolicy = policy; fetchFailure = fail; listener?.('background'); listener?.('active'); await settle();
    },
    async activeAgain() { listener?.('active'); await settle(); },
    dispose() { for (const cleanup of cleanups) cleanup?.(); },
  };
}

test('versionCode is authoritative and an unpublished/malformed minimum cannot force an update', () => {
  assert.equal(release.installedAppVersion().version, installed.version);
  assert.equal(release.installedAppVersion().versionCode, 4);
  assert.equal(release.decideUpdate(installed, { ...optional, latestVersionCode: 4, latestVersion: '99.0.0' }), 'none');
  assert.equal(release.decideUpdate(installed, optional), 'optional');
  assert.equal(release.decideUpdate(installed, forced), 'forced');
  assert.equal(release.decideUpdate(installed, { ...optional, forceUpdate: true }), 'forced');
  assert.equal(release.decideUpdate(installed, { ...base, minimumVersionCode: 99, forceUpdate: true }), 'none');
  assert.equal(release.decideUpdate(installed, { ...optional, minimumVersionCode: 99 }), 'none');
  assert.equal(release.decideUpdate(installed, { ...forced, latestVersionCode: null, minimumVersionCode: 99 }), 'optional');
  assert.equal(release.decideUpdate({ version: '0.1.3', versionCode: null }, { ...optional, latestVersionCode: null }), 'optional');
  assert.equal(release.decideUpdate(installed, base), 'none');
});

test('startup latest has no prompt; optional later survives rerender/resume but a new target and forced policy reappear', async () => {
  const latest = fixture({ ...base, latestVersion: installed.version, latestVersionCode: 4 });
  await latest.flush(); assert.equal(latest.visible().length, 0); assert.equal(latest.fetches.length, 0); latest.dispose();
  const app = fixture(); await app.flush();
  assert.ok(app.visible().includes('태장 앱의 새로운 버전이 나왔습니다.'));
  assert.ok(app.button('나중에')); assert.ok(app.button('업데이트'));
  await app.press('나중에'); assert.equal(app.visible().length, 0);
  app.render(); assert.equal(app.visible().length, 0);
  await app.resume(); assert.equal(app.visible().length, 0); assert.equal(app.fetches.length, 1);
  await app.activeAgain(); assert.equal(app.fetches.length, 1);
  await app.resume({ ...optional, latestVersionCode: 6 }); assert.ok(app.button('업데이트'));
  await app.press('나중에');
  await app.resume({ ...optional, latestVersionCode: 6, forceUpdate: true });
  assert.ok(app.button('업데이트')); assert.equal(app.button('나중에'), undefined); app.dispose();
});

test('forced update only has update, Android back cannot dismiss it, and offline policy refresh releases the stale gate', async () => {
  const app = fixture(forced); await app.flush();
  assert.ok(app.visible().includes('태장 앱을 업데이트해주세요.'));
  assert.ok(app.visible().includes('최신 버전으로 업데이트한 후 이용할 수 있습니다.'));
  assert.equal(app.button('나중에'), undefined);
  app.render().find(n => n?.type === 'Modal' && n.props.visible).props.onRequestClose();
  assert.ok(app.button('업데이트'));
  await app.resume(forced, true); assert.equal(app.visible().length, 0);
  await app.resume(forced); assert.ok(app.button('업데이트')); app.dispose();
});

test('Play uses the canonical production package, falls back to HTTPS, and retains a retry button on both failures', async () => {
  const app = fixture({ ...optional, storeUrl: 'https://wrong-app.example/' }); await app.flush();
  await app.press('업데이트'); assert.deepEqual(app.urls, [release.DEFAULT_PLAY_STORE_URL]);
  app.failUrls.add(release.DEFAULT_PLAY_STORE_URL);
  await app.press('업데이트'); assert.deepEqual(app.urls.slice(-2), [release.DEFAULT_PLAY_STORE_URL, release.PLAY_STORE_WEB_URL]);
  app.failUrls.add(release.PLAY_STORE_WEB_URL);
  await app.press('업데이트');
  assert.ok(app.visible().some(n => n?.props?.accessibilityRole === 'alert'));
  assert.ok(app.button('업데이트')); assert.equal(app.button('업데이트').props.disabled, false); app.dispose();
});

test('QA never renders production updates/maintenance, fetches a production policy, or opens Play', async () => {
  const app = fixture({ ...forced, maintenanceMode: true }, true); await app.flush(); await app.resume();
  assert.equal(app.render().length, 0); assert.equal(app.fetches.length, 0); assert.equal(app.urls.length, 0); app.dispose();
});

test('update modal has scroll, scalable text and large labeled buttons, and never stacks release notes', async () => {
  const app = fixture({ ...optional, releaseNotes: 'notes', releaseNotesVersion: installed.version }); await app.flush();
  assert.equal(app.render().filter(n => n?.type === 'Modal' && n.props.visible).length, 1);
  assert.ok(app.visible().some(n => n?.type === 'ScrollView'));
  assert.ok(app.visible().some(n => n?.props?.accessibilityRole === 'header'));
  for (const label of ['나중에', '업데이트']) assert.ok(app.button(label).props.style.minHeight >= 48);
  for (const node of app.visible().filter(n => n?.type === 'Text')) assert.notEqual(node.props.allowFontScaling, false);
  await app.press('나중에'); assert.ok(app.visible().includes('변경사항')); app.dispose();
});

test('policy refresh parses the existing public endpoint, rejects HTTP/malformed failures and aborts a hung request', async () => {
  let abortRequest, timeoutMs, cleared = false;
  const config = load('mobile/src/platform/config.ts', {}, {
    setTimeout: (fn, ms) => { abortRequest = fn; timeoutMs = ms; return 1; }, clearTimeout: () => { cleared = true; },
  });
  const policy = await config.loadPublicMobileReleasePolicy(async (url, options) => {
    assert.equal(url, 'https://taejang.co.kr/.netlify/functions/staff-config');
    assert.equal(options.cache, 'no-store');
    return { ok: true, json: async () => ({ mobileRelease: { latest_version_code: 5, force_update: true } }) };
  });
  assert.equal(policy.latestVersionCode, 5); assert.equal(timeoutMs, 5000); assert.equal(cleared, true);
  await assert.rejects(config.loadPublicMobileReleasePolicy(async () => ({ ok: false })));
  await assert.rejects(config.loadPublicMobileReleasePolicy(async () => ({ ok: true, json: async () => ({}) })));
  const request = config.loadPublicMobileReleasePolicy(async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  abortRequest(); await assert.rejects(request, /aborted/);
});
