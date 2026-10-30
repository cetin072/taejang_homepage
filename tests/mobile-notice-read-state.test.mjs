import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

// Same transpiled native UI/hook harness used by mobile-qa-runtime.test.mjs.
const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const jsx = (type, props) => ({ type, props });
function load(path, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name in modules) return modules[name];
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return exports;
}
const readModule = storage => load('mobile/src/features/notices/notice-read-state.ts', {
  '@/src/platform/secure-storage': { secureSessionStorage: storage },
});
function memory() {
  const values = new Map();
  return { values, getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); } };
}
const notice = (id = 'a', extra = {}) => ({
  id, title: `공지 ${id}`, body_easy: '실제 공지 내용', importance: 'normal',
  version_no: 1, requires_acknowledgement: false, acknowledged: false, is_new: false,
  publish_start_at: new Date().toISOString(), publish_end_at: null, media: [], ...extra,
});
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
function nodes(tree) {
  if (tree == null || tree === false) return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== 'object') return [tree];
  return [tree, ...nodes(tree.props?.children)];
}
function hooks() {
  const values = [], deps = [], cleanups = [];
  let cursor = 0, effects = [], focuses = [], focused = true;
  const same = (a, b) => a && a.length === b.length && a.every((v, i) => v === b[i]);
  return {
    begin() { cursor = 0; },
    async flush() { const next = effects; effects = []; next.forEach(fn => fn()); await settle(); },
    blur() { focused = false; focuses.forEach(fn => fn?.()); focuses = []; },
    focus() { focused = true; deps.length = 0; },
    useFocusEffect(fn) {
      const index = cursor++;
      if (!focused || same(deps[index], fn.deps)) return;
      focuses[index]?.();
      deps[index] = fn.deps;
      focuses[index] = fn();
    },
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
        return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }];
      },
      useRef(initial) { const i = cursor++; return values[i] ??= { current: initial }; },
      useCallback(fn, deps) {
        const i = cursor++;
        if (!same(values[i]?.deps, deps)) values[i] = Object.assign(fn, { deps });
        return values[i];
      },
      useEffect(fn, next) {
        const i = cursor++;
        if (same(deps[i], next)) return;
        deps[i] = next;
        effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); });
      },
    },
  };
}
const native = Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'Button', 'Image', 'ActivityIndicator'].map(x => [x, x]));
let fontScale = 1;
native.useWindowDimensions = () => ({ fontScale });
native.StyleSheet = { create: value => value };

test('general reads persist across process restart, isolate users, and reappear for a new version', async () => {
  const storage = memory(), r = readModule(storage);
  assert.equal(r.isNoticeUnread(notice(), {}), true); // is_new=false still unread
  await r.noticeReadStore.markRead('alice', notice());
  const restarted = readModule(storage);
  const versions = await restarted.noticeReadStore.load('alice');
  assert.equal(restarted.isNoticeUnread(notice(), versions), false);
  assert.equal(restarted.isNoticeUnread(notice('a', { version_no: 2 }), versions), true);
  assert.equal(restarted.isNoticeUnread(notice(), await restarted.noticeReadStore.load('bob')), true);
  assert.equal(storage.values.size, 1);
});

test('concurrent reads do not lose updates; pending saves finish before home reads; storage failures retry', async () => {
  const storage = memory(), r = readModule(storage);
  await Promise.all(['a', 'b', 'c'].map(id => r.noticeReadStore.markRead('alice', notice(id))));
  assert.equal(Object.keys(await r.noticeReadStore.load('alice')).length, 3);
  let release;
  storage.setItem = () => new Promise(resolve => { release = resolve; });
  const pending = r.noticeReadStore.markRead('alice', notice('d'));
  await settle();
  let done = false;
  const home = r.noticeReadStore.load('alice').then(v => { done = true; return v; });
  await settle(); assert.equal(done, false);
  release(); await pending;
  assert.equal((await home).d, 1);
  storage.setItem = async () => { throw new Error('disk full'); };
  await assert.rejects(r.noticeReadStore.markRead('alice', notice('e')));
  assert.equal((await r.noticeReadStore.load('alice')).e, undefined);
  storage.setItem = async () => {};
  await r.noticeReadStore.markRead('alice', notice('e'));
  assert.equal((await r.noticeReadStore.load('alice')).e, 1);
});

test('required notices use server acknowledgement only; expired highlight never hides unread', async () => {
  const r = readModule(memory());
  const required = notice('required', { requires_acknowledgement: true, publish_start_at: '2026-01-01T00:00:00Z' });
  await r.noticeReadStore.markRead('alice', required);
  assert.equal(Object.keys(await r.noticeReadStore.load('alice')).length, 0);
  assert.equal(r.isNoticeUnread(required, { required: 1 }), true);
  assert.equal(r.isNoticeUnread({ ...required, acknowledged: true }, {}), false);
  assert.equal(r.isRecentlyPublished(required), false);
  assert.equal(r.unreadNotices([required], {}).length, 1);
  assert.equal(r.isRecentlyPublished(notice('x', { publish_start_at: '2026-10-13T00:00:00Z' }), Date.parse('2026-10-16T00:00:00Z')), false);
});

test('latest unread is chronological despite server importance order; date uses KST', () => {
  const r = readModule(memory());
  const older = notice('important', { publish_start_at: '2026-10-11T00:00:00Z', importance: 'important' });
  const latest = notice('latest', { publish_start_at: '2026-10-12T23:00:00Z' });
  assert.equal(r.unreadNotices([older, latest], {})[0].id, 'latest');
  assert.equal(r.unreadNotices([older, latest], { latest: 1 })[0].id, 'important');
  assert.match(r.noticeDate(latest), /10월 13일/);
});

test('home and full list reuse native cards: 0–5 notices, stable publication order, read retention, navigation and errors', () => {
  const r = readModule(memory()), routes = [], api = load('mobile/src/features/notices/notice-api.ts');
  let retries = 0;
  let state = { items: [], versions: {}, loading: false, error: '', retry: () => retries++ };
  const router = { push: path => routes.push(path), replace: path => routes.push(path) };
  const cards = load('mobile/src/features/notices/notice-list-card.tsx', {
    'expo-router': { useRouter: () => router }, 'react-native': native,
    './notice-api': api, './notice-read-state': r,
  });
  const component = load('mobile/src/features/notices/notice-home-action.tsx', {
    'expo-router': { useRouter: () => router }, 'react-native': native,
    './notice-api': api, './notice-read-state': r, './notice-list-card': cards,
    './use-my-notices': { useMyNotices: () => state },
  });
  const list = load('mobile/app/notices/index.tsx', {
    'expo-router': { useRouter: () => router }, 'react-native': native,
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/src/features/notices/notice-api': api, '@/src/features/notices/notice-read-state': r,
    '@/src/features/notices/notice-list-card': cards,
    '@/src/features/notices/use-my-notices': { useMyNotices: () => state },
  });
  const render = () => nodes(component.NoticeHomeAction());
  for (let count = 0; count <= 5; count++) {
    state.items = Array.from({ length: count }, (_, i) => notice(`${i}`, {
      publish_start_at: `2026-01-0${i + 1}T00:00:00Z`, importance: i ? 'normal' : 'urgent',
    }));
    const original = [...state.items];
    const ui = render();
    const selected = ui.filter(x => x.type === cards.NoticeListCard);
    assert.equal(selected.length, Math.min(count, 3));
    assert.deepEqual(selected.map(x => x.props.item.id), original.toReversed().slice(0, 3).map(x => x.id));
    assert.deepEqual(state.items, original, 'shared cache is not mutated');
    assert.equal(ui.includes('새 공지가 없어요.'), count === 0);
    assert.equal(nodes(list.default()).filter(x => x.type === cards.NoticeListCard).length, count);
    assert.equal(ui.filter(x => x.props?.accessibilityLabel === '전체 공지 보기').length, 1);
    assert.equal(ui.some(x => typeof x === 'string' && /미확인.*건|내용 보기/.test(x)), false);
    if (selected.length) {
      const card = nodes(cards.NoticeListCard(selected[0].props));
      card.find(x => x.type === 'Pressable').props.onPress();
      assert.equal(routes.at(-1), `/notices/${count - 1}`);
      assert.equal(card.filter(x => x.type === 'Pressable').length, 1);
      assert.equal(card.filter(x => x.type === 'Text').length, 1, 'no separate publication date on home or full-list cards');
      assert.equal(card.find(x => x.type === 'Text').props.children, selected[0].props.item.title);
      assert.equal(card.find(x => x.type === 'Pressable').props.accessibilityLabel,
        `${selected[0].props.item.title}${selected[0].props.unread ? ', 미확인' : ''}, 공지 열기`);
      const unreadCard = nodes(cards.NoticeListCard({ item: selected[0].props.item, unread: true }));
      assert.equal(unreadCard.find(x => x.type === 'Pressable').props.accessibilityLabel,
        `${selected[0].props.item.title}, 미확인, 공지 열기`);
      assert.equal(unreadCard.filter(x => x.type === 'View').length, 1, 'unread dot remains visible');
    }
  }
  state.items = [notice('z', { publish_start_at: '2026-01-01T00:00:00Z' }), notice('a', { publish_start_at: '2026-01-01T00:00:00Z' })];
  state.versions = { z: 1, a: 1 };
  let ui = render(), selected = ui.filter(x => x.type === cards.NoticeListCard);
  assert.deepEqual(selected.map(x => x.props.item.id), ['z', 'a'], 'equal dates preserve server order');
  assert.ok(selected.every(x => !x.props.unread), 'old read notices stay visible without dots');
  state.versions = {};
  assert.ok(render().filter(x => x.type === cards.NoticeListCard).every(x => x.props.unread));
  const long = notice('long', { title: '매우 긴 공지 제목 '.repeat(100) });
  fontScale = 2;
  const title = nodes(cards.NoticeListCard({ item: long })).find(x => x.props?.numberOfLines);
  assert.equal(title.props.numberOfLines, 2);
  assert.equal(title.props.ellipsizeMode, 'tail');
  assert.equal(title.props.children, long.title, 'full title remains available to accessibility');
  fontScale = 1;
  ui.find(x => x.props?.accessibilityLabel === '전체 공지 보기').props.onPress();
  assert.equal(routes.at(-1), '/notices');
  nodes(list.default()).find(x => x.type === 'Pressable').props.onPress();
  assert.equal(routes.at(-1), '/');
  state = { ...state, items: [], loading: true };
  assert.ok(render().includes('공지 확인 중…'));
  assert.ok(!render().includes('새 공지가 없어요.'));
  state = { ...state, loading: false, error: '공지 정보를 불러오지 못했습니다. 다시 시도' };
  ui = render(); assert.ok(ui.includes(state.error));
  assert.ok(!ui.includes('새 공지가 없어요.'));
  ui.find(x => x.type === 'Pressable').props.onPress(); assert.equal(retries, 1);
  state.items = [notice()];
  assert.equal(render().filter(x => x.type === cards.NoticeListCard).length, 1, 'cached cards remain usable on refresh failure');
});

function loaderHarness() {
  const h = hooks(), r = readModule(memory()), cache = load('mobile/src/features/notices/notice-cache.ts');
  let actor = 'alice', response = [notice()], listener, calls = 0, fail = false, deferred;
  const client = { rpc: async () => { calls++; if (fail) throw Error('offline'); return deferred ? deferred() : { data: response }; } };
  const api = load('mobile/src/features/notices/notice-api.ts');
  const hook = load('mobile/src/features/notices/use-my-notices.ts', {
    react: h.react, 'expo-router': { useFocusEffect: fn => h.useFocusEffect(fn) },
    'react-native': { AppState: { currentState: 'active', addEventListener: (_, fn) => { listener = fn; return { remove() { listener = null; } }; } } },
    '@/src/providers/platform-provider': { usePlatform: () => ({ client, session: { user: { id: actor } } }) },
    './notice-api': api, './notice-cache': cache, './notice-read-state': r,
  });
  return { h, r, client, api, render() { h.begin(); return hook.useMyNotices(); },
    actor(value) { actor = value; }, response(value) { response = value; }, fail(value) { fail = value; },
    defer(value) { deferred = value; }, change(value) { listener?.(value); }, calls: () => calls,
  };
}

test('focus/resume loader refreshes read/ack/version/count and retires removed notices without polling', async () => {
  const f = loaderHarness();
  f.render(); await settle(); assert.equal(f.render().items.length, 1); assert.equal(f.calls(), 1);
  f.change('active'); await settle(); assert.equal(f.calls(), 1);
  f.change('background'); f.change('active'); await settle(); assert.equal(f.calls(), 2);
  f.h.blur(); await f.r.noticeReadStore.markRead('alice', notice());
  f.h.focus(); f.render(); await settle();
  assert.equal(f.r.isNoticeUnread(f.render().items[0], f.render().versions), false);
  f.response([notice('a', { version_no: 2 }), notice('b')]);
  f.h.blur(); f.h.focus(); f.render(); await settle();
  assert.equal(f.r.unreadNotices(f.render().items, f.render().versions).length, 2);
  f.response([]); f.change('background'); f.change('active'); await settle();
  assert.equal(f.render().items.length, 0);
  f.fail(true); await f.render().retry();
  assert.match(f.render().error, /불러오지 못했습니다/);
  f.fail(false); await f.render().retry(); assert.equal(f.render().error, '');
});

test('late old-account responses are discarded and cannot replace current cache', async () => {
  const f = loaderHarness(); let resolve;
  f.defer(() => new Promise(done => { resolve = done; })); f.render(); await settle();
  f.actor('bob'); f.defer(null); f.response([notice('bob')]);
  assert.equal(f.render().items.length, 0); await settle();
  resolve({ data: [notice('alice-private')] }); await settle();
  assert.equal(f.render().items[0].id, 'bob');
});

test('invalid RPC payload is an error rather than no notices', async () => {
  const api = load('mobile/src/features/notices/notice-api.ts');
  await assert.rejects(api.loadMyNotices({ rpc: async () => ({ data: null }) }));
  await assert.rejects(api.loadMyNotices({ rpc: async () => ({ data: { message: 'bad' } }) }));
});

async function detailHarness(required = false) {
  const h = hooks(), r = readModule(memory()), client = {};
  let actor = 'alice', current = notice('a', { requires_acknowledgement: required }), ackCalls = 0, fail = false;
  const component = load('mobile/app/notices/[id].tsx', {
    react: h.react, 'expo-router': { useFocusEffect: fn => h.useFocusEffect(fn), useRouter: () => ({ back() {}, replace() {} }), useLocalSearchParams: () => ({ id: 'a' }) },
    'expo-status-bar': { StatusBar: 'StatusBar' }, 'react-native': native,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/src/providers/platform-provider': { usePlatform: () => ({ client, session: { user: { id: actor } } }) },
    '@/src/features/notices/notice-cache': { getCachedNoticeMediaUrl: () => null },
    '@/src/features/notices/notice-read-state': r,
    '@/src/features/notices/notice-api': {
      loadMyNoticeDetail: async () => { if (fail) throw Error('offline'); return current; },
      acknowledgeMyNotice: async (_client, _id, version) => { assert.equal(version, 1); ackCalls++; current = { ...current, acknowledged: true }; },
    },
  });
  return { h, r, render() { h.begin(); return nodes(component.default()); }, actor(v) { actor = v; }, fail(v) { fail = v; }, ackCalls: () => ackCalls };
}

test('actual detail commits general read only after successful text render; failed detail stays unread', async () => {
  const f = await detailHarness(); f.render(); await settle();
  assert.equal((await f.r.noticeReadStore.load('alice')).a, undefined);
  assert.ok(f.render().includes('실제 공지 내용')); await f.h.flush();
  assert.equal((await f.r.noticeReadStore.load('alice')).a, 1);
  f.actor('bob'); f.fail(true); assert.ok(!f.render().includes('실제 공지 내용'));
  await settle(); f.render(); await f.h.flush();
  assert.equal((await f.r.noticeReadStore.load('bob')).a, undefined);
});

test('actual required detail stays unread until explicit current-version acknowledgement', async () => {
  const f = await detailHarness(true); f.render(); await settle();
  let ui = f.render(); await f.h.flush();
  assert.equal((await f.r.noticeReadStore.load('alice')).a, undefined); assert.equal(f.ackCalls(), 0);
  ui.find(x => x.type === 'Button' && x.props.title === '내용 확인했습니다').props.onPress();
  await settle(); ui = f.render(); await f.h.flush();
  assert.equal(f.ackCalls(), 1); assert.ok(ui.includes('✓ 내용을 확인했습니다.'));
});
