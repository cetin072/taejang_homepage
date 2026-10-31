import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const jsx = (type, props) => ({ type, props });
function load(path, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name in modules) return modules[name];
    throw new Error(`Unexpected runtime dependency: ${name}`);
  }, fetch: () => { throw new Error('Patch notes must work offline'); } });
  return exports;
}
function nodes(tree) {
  if (tree == null || tree === false) return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== 'object') return [tree];
  return [tree, ...nodes(tree.props?.children)];
}
const native = {
  View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
  StyleSheet: { create: value => value },
};
const notesModule = load('mobile/src/features/settings/patch-notes.ts');
const notes = notesModule.MOBILE_PATCH_NOTES;

test('bundled history preserves unique entries with real dates in newest-first order', () => {
  assert.ok(notes.length > 0);
  assert.equal(new Set(notes.map(note => note.id)).size, notes.length);
  let previous = '9999-12-31';
  for (const note of notes) {
    assert.match(note.id, /^[a-z0-9-]+$/);
    assert.match(note.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(`${note.date}T00:00:00Z`).toISOString().slice(0, 10), note.date);
    assert.ok(note.date <= previous, 'new changes must precede older history');
    previous = note.date;
    for (const value of [note.title, note.summary, ...note.items]) {
      assert.equal(typeof value, 'string');
      assert.ok(value.trim(), 'no blank user-facing notes');
    }
    assert.ok(note.items.length > 0);
    assert.equal(new Set(note.items).size, note.items.length);
  }
});

test('settings opens native patch notes with and without a login session', () => {
  for (const session of [null, { user: { id: 'fixture', user_metadata: {}, email: 'test@example.invalid' } }]) {
    const routes = [];
    const screen = load('mobile/app/settings.tsx', {
      'expo-constants': { default: { expoConfig: { version: 'test-version' } } },
      'expo-linking': {},
      'expo-router': { useRouter: () => ({ push: route => routes.push(route) }) },
      react: { useEffect: () => {}, useState: value => [value, () => {}] },
      'react-native': native,
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 20, bottom: 12 }) },
      '@/src/features/common/policy-links': { PolicyLinks: 'PolicyLinks' },
      '@/src/platform/app-variant': { appVariantLabel: () => '태장', isQaApp: false },
      '@/src/notifications/push-registration': {},
      '@/src/providers/platform-provider': { usePlatform: () => ({ session }) },
    });
    const button = nodes(screen.default()).find(node => node?.props?.accessibilityLabel === '패치노트 열기');
    assert.ok(button, 'patch notes must not require a current login');
    button.props.onPress();
    assert.deepEqual(routes, ['/patch-notes']);
  }
});

test('offline screen renders the complete bundled history and returns to settings even on a direct link', () => {
  const routes = [];
  // No platform provider, Auth, Storage, Linking or network dependency is supplied.
  const screen = load('mobile/app/patch-notes.tsx', {
    'expo-router': { useRouter: () => ({ replace: route => routes.push(route) }) },
    'react-native': native,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 20, bottom: 12 }) },
    '@/src/features/settings/patch-notes': notesModule,
    '@/src/platform/release-policy': { installedAppVersion: () => ({ version: '0.1.6', versionCode: 7 }) },
  });
  const tree = nodes(screen.default());
  assert.ok(tree.some(node => node?.type === 'ScrollView'));
  assert.ok(tree.includes('0.1.6'));
  assert.ok(tree.includes(' · 빌드 7'));
  for (const note of notes) {
    assert.ok(tree.includes(note.date));
    assert.ok(tree.includes(note.title));
    assert.ok(tree.includes(note.summary));
    for (const item of note.items) assert.ok(tree.includes(item));
  }
  tree.find(node => node?.props?.accessibilityLabel === '설정으로 돌아가기').props.onPress();
  assert.deepEqual(routes, ['/settings']);
});

test('unknown native build number never appears as null or a fake build in the history', () => {
  const screen = load('mobile/app/patch-notes.tsx', {
    'expo-router': { useRouter: () => ({}) },
    'react-native': native,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/src/features/settings/patch-notes': notesModule,
    '@/src/platform/release-policy': { installedAppVersion: () => ({ version: '0.1.6', versionCode: null }) },
  });
  const values = nodes(screen.default());
  assert.ok(values.includes('0.1.6'));
  assert.ok(!values.some(value => typeof value === 'string' && value.includes('빌드')));
});
