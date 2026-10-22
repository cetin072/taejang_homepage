import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
const jsx = (type, props) => ({ type, props });
function load(path, modules) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name in modules) return modules[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, setTimeout, clearTimeout });
  return exports;
}
function hooks() {
  const values = [], effects = [], dependencies = [];
  let cursor = 0;
  return {
    begin() { cursor = 0; },
    effects,
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in values)) values[index] = initial;
        return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }];
      },
      useRef(initial) {
        const index = cursor++;
        if (!(index in values)) values[index] = { current: initial };
        return values[index];
      },
      useCallback: fn => fn,
      useMemo: fn => fn(),
      useEffect(fn, deps) {
        const index = cursor++;
        if (!dependencies[index] || deps.some((value, i) => value !== dependencies[index][i])) effects.push(fn);
        dependencies[index] = deps;
      },
    },
  };
}
function nodes(tree) {
  if (tree == null || tree === false) return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== 'object') return [tree];
  return [tree, ...nodes(tree.props?.children)];
}
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const native = {
  View: 'View', Text: 'Text', Pressable: 'Pressable', Modal: 'Modal',
  StyleSheet: { create: value => value },
  AppState: { addEventListener: () => ({ remove() {} }) },
  Alert: { alert: (_title, _message, buttons) => buttons.at(-1).onPress() },
};
async function attendance({
  required = false,
  mode = 'qa',
  isWorkday = true,
  dayReason = '근무일',
  clockInAvailable = true,
  previewScenario = 'today',
  calendarDay = { work_date: '2026-10-09', is_workday: false, reason: '한글날' },
  result = { ok: true, writes_attendance: false, server_time: '2026-10-08T01:00:00Z' },
  locationFailure = false,
  locationCode = 'TIMEOUT',
  persistRecord = false,
  reduced = false, autoAnimation = true, hapticFailure = false, recordGate = null, serverFailure = false, refreshFailure = false, initialClockIn = null,
} = {}) {
  const h = hooks(), calls = [];
  let latestRequired = required, locationRequests = 0;
  let recordedIn = initialClockIn, recordedOut = null;
  const animations = [], pendingAnimations = [], haptics = [], appListeners = [];
  let motionListener, active = 'active', recordFinished = false, confirmations = 0;
  class Value {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    stopAnimation() {}
    interpolate(config) { return { value: this, config }; }
  }
  const feedbackNative = {
    ...native, Platform: { OS: 'android' },
    Animated: { Value, View: 'AnimatedView', timing: (value, config) => ({ start(callback) {
      animations.push(config);
      const finish = (finished = true) => { if (finished) value.setValue(config.toValue); callback({ finished }); };
      if (autoAnimation) finish(); else pendingAnimations.push(finish);
    } }) },
    AccessibilityInfo: { isReduceMotionEnabled: async () => reduced, addEventListener: (_event, callback) => {
      motionListener = callback; return { remove() {} };
    } },
    AppState: { get currentState() { return active; }, addEventListener: (_event, callback) => {
      appListeners.push(callback); return { remove() {} };
    } },
  };
  const feedback = load('mobile/src/features/attendance/attendance-feedback.ts', {
    react: h.react, 'react-native': feedbackNative,
    'expo-haptics': { AndroidHaptics: { Confirm: 'confirm' }, performAndroidHapticsAsync: async type => {
      haptics.push(type); if (hapticFailure) throw Error('no motor');
    } },
  });
  let onAppStateChange = null;
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_my_attendance_today' && recordFinished && refreshFailure) throw Error('refresh offline');
    if (name === 'record_attendance_event' || name === 'qa_validate_attendance_event') {
      if (recordGate) await recordGate;
      if (serverFailure) throw Error('offline');
      recordFinished = true;
    }
    if (name === 'get_my_attendance_today') return { data: {
      work_date: '2026-10-09', attendance_required: latestRequired,
      is_workday: isWorkday, day_reason: dayReason,
      clock_in_available: clockInAvailable, clock_in: recordedIn, clock_out: recordedOut,
    } };
    if (name === 'get_attendance_workday_status') return { data: calendarDay };
    if (persistRecord && name === 'record_attendance_event' && result.ok) {
      const event = { status: 'recorded', event_at: '2026-10-09T01:00:00Z', requested_at: null };
      if (args.p_event_type === 'clock_in') recordedIn = event;
      else recordedOut = event;
    }
    return { data: result };
  } };
  const api = load('mobile/src/features/attendance/attendance-api.ts', {});
  const previewState = load('mobile/src/features/qa/qa-preview-state.ts', {});
  class AttendanceLocationError extends Error { constructor() { super('location'); this.code = locationCode; } }
  const card = load('mobile/src/features/attendance/attendance-card.tsx', {
    react: h.react,
    './attendance-feedback': feedback,
    'react-native': {
      ...feedbackNative,
      Alert: { alert: (_title, _message, buttons) => { confirmations++; buttons.at(-1).onPress(); } },
      AppState: { addEventListener: (_event, callback) => {
        onAppStateChange = callback; appListeners.push(callback);
        return { remove() {} };
      } },
    },
    './attendance-api': api,
    './attendance-location': { AttendanceLocationError, getBestAttendancePosition: async () => {
      locationRequests++;
      if (locationFailure) throw new AttendanceLocationError();
      return { latitude: 1, longitude: 1, accuracy: 5 };
    } },
    '@/src/features/qa/qa-preview-state': previewState,
    '@/src/providers/platform-provider': { usePlatform: () => ({ client, session: {} }) },
  });
  const render = () => { h.begin(); return nodes(card.AttendanceCard({ mode, previewScenario })); };
  render();
  for (const effect of h.effects.splice(0)) effect();
  await settle();
  return {
    animations, haptics, finishAnimation: (finished = true) => pendingAnimations.shift()?.(finished),
    reduceMotion(value) { motionListener(value); },
    async background() { active = 'background'; appListeners.forEach(fn => fn('background')); await settle(); },
    confirmations: () => confirmations,
    calls, render, locationRequests: () => locationRequests, changeRequired(value) { latestRequired = value; },
    openClockIn() { clockInAvailable = true; },
    async foreground() {
      active = 'active'; appListeners.forEach(fn => fn('active'));
      await settle();
    },
    async press() {
      const button = render().find(node => node?.type === 'Pressable');
      button.props.onPress();
      await settle();
    },
  };
}
const mutations = fixture => fixture.calls.filter(call => !['get_my_attendance_today', 'get_attendance_workday_status'].includes(call.name));

test('QA required employee is disabled; stale eligibility is rechecked before any location/write', async () => {
  const blocked = await attendance({ required: true });
  assert.equal(blocked.render().find(node => node?.type === 'Pressable').props.disabled, true);
  await blocked.press();
  assert.equal(mutations(blocked).length, 0);
  const stale = await attendance();
  stale.changeRequired(true);
  await stale.press();
  assert.equal(mutations(stale).length, 0);
  assert.ok(stale.render().includes('QA 앱에서는 실제 근태를 기록하지 않습니다. 출퇴근 검수 권한 계정으로 확인해주세요.'));
});

test('QA clock-in and clock-out call only no-write RPC and keep local QA progression', async () => {
  const fixture = await attendance();
  await fixture.press();
  await fixture.press();
  assert.deepEqual(mutations(fixture).map(call => call.name), ['qa_validate_attendance_event', 'qa_validate_attendance_event']);
  assert.deepEqual(mutations(fixture).map(call => call.args.p_event_type), ['clock_in', 'clock_out']);
  assert.equal(mutations(fixture)[1].args.p_has_qa_clock_in, true);
  assert.ok(fixture.render().includes('검수 완료'));
});

test('missing QA capability, malformed no-write result and repeated GPS failure never fall back to real writes', async () => {
  for (const options of [
    { result: { ok: false, code: 'FORBIDDEN', writes_attendance: false } },
    { result: { ok: true, writes_attendance: true } },
    { result: { ok: true } },
    { locationFailure: true },
    { result: { ok: false, code: 'LOCATION_UNCERTAIN', writes_attendance: false } },
  ]) {
    const fixture = await attendance(options);
    await fixture.press();
    await fixture.press();
    assert.ok(mutations(fixture).every(call => call.name === 'qa_validate_attendance_event'));
    assert.equal(fixture.render().some(node => node === '관리자 확인 요청'), false);
    assert.equal(fixture.render().some(node => node === '검수 완료' || node === '다시 검수'), false);
  }
});

test('production keeps actual attendance write and repeated GPS exception request', async () => {
  const fixture = await attendance({ mode: 'record', required: true, result: { ok: true } });
  await fixture.press();
  assert.equal(mutations(fixture)[0].name, 'record_attendance_event');
  const failed = await attendance({ mode: 'record', required: true, locationFailure: true, result: { ok: true } });
  await failed.press(); await failed.press();
  const exception = failed.render().find(node => node?.type === 'Pressable' && nodes(node).includes('관리자 확인 요청'));
  assert.ok(exception);
  exception.props.onPress(); await settle();
  assert.equal(mutations(failed)[0].name, 'request_attendance_exception');
});

test('QA suppresses production forced/optional/minimum update and maintenance UI; production still renders', () => {
  for (const qa of [true, false]) {
    const h = hooks();
    let decisions = 0;
    const lifecycle = load('mobile/src/platform/update-lifecycle.tsx', {
      react: h.react, 'react-native': native, 'expo-linking': {},
      './app-variant': { isQaApp: qa }, './secure-storage': { secureSessionStorage: {} },
      './release-policy': { installedAppVersion: () => ({ version: '0.1.3', versionCode: 4 }), decideUpdate: () => { decisions++; return 'forced'; }, updateTargetKey: () => 'test-target' },
      './config': {},
      '@/src/providers/platform-provider': { usePlatform: () => ({ config: { mobileRelease: { forceUpdate: true, minimumVersionCode: 999, maintenanceMode: true } } }) },
    });
    h.begin(); const rendered = lifecycle.UpdateLifecycle();
    assert.equal(rendered === null, qa);
    assert.equal(decisions, qa ? 0 : 1);
  }
});

test('QA skips automatic push enrollment while notification routes stay active; production enrolls', async () => {
  for (const qa of [true, false]) {
    const h = hooks(), routes = [], registrations = [];
    let listener;
    const bridge = load('mobile/src/notifications/push-notification-bridge.tsx', {
      react: h.react, 'expo-router': { useRouter: () => ({ push: path => routes.push(path) }) },
      'expo-notifications': {
        getLastNotificationResponseAsync: async () => null, clearLastNotificationResponseAsync: async () => {},
        addNotificationResponseReceivedListener: fn => { listener = fn; return { remove() {} }; },
        addPushTokenListener: () => ({ remove() {} }),
      },
      '@/src/features/notices/notice-api': { noticeDeepLinkPath: id => `/notices/${id}` },
      '@/src/features/schedules/schedule-api': { scheduleDeepLinkPath: id => `/schedules/${id}` },
      './push-registration': { registerCurrentPushDevice: async (_client, options) => registrations.push(options) },
      '@/src/platform/app-variant': { isQaApp: qa },
      '@/src/providers/platform-provider': { usePlatform: () => ({ client: {}, session: { access_token: 'fixture', user: { id: 'tester' } } }) },
    });
    h.begin(); bridge.PushNotificationBridge();
    for (const effect of h.effects.splice(0)) effect();
    await settle();
    assert.equal(registrations.length, qa ? 0 : 1);
    for (const target of ['notice', 'schedule']) {
      const response = { notification: { request: { identifier: target, content: { data: { target, [`${target}Id`]: 'fixture' } } } } };
      listener(response);
      listener(response); // OS cold/warm delivery of the same tap opens only once.
    }
    await settle();
    assert.deepEqual(routes, ['/notices/fixture', '/schedules/fixture']);
  }
});

test('Hangul Day preview shows server-matching holiday label, disables clock-in and never requests GPS', async () => {
  const fixture = await attendance({ mode: 'preview', previewScenario: 'hangul', required: false });
  const button = fixture.render().find(node => node?.type === 'Pressable');
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.accessibilityLabel, '오늘은 출근일이 아닙니다');
  assert.ok(fixture.render().includes('한글날'));
  await fixture.press();
  assert.deepEqual(mutations(fixture), []);
  assert.equal(fixture.locationRequests(), 0);
});

test('cold notice response survives login, then opens exactly once without acknowledging', async () => {
  const h = hooks(), routes = [];
  let session = null, cleared = 0, listener;
  const response = { actionIdentifier: 'default', notification: { request: { identifier: 'notice-cold',
    content: { data: { target: 'notice', noticeId: 'notice-1' } } } } };
  const router = { push: path => routes.push(path) };
  const bridge = load('mobile/src/notifications/push-notification-bridge.tsx', {
    react: h.react, 'expo-router': { useRouter: () => router },
    'expo-notifications': {
      getLastNotificationResponseAsync: async () => response,
      clearLastNotificationResponseAsync: async () => { cleared++; },
      addNotificationResponseReceivedListener: fn => { listener = fn; return { remove() {} }; },
    },
    '@/src/features/notices/notice-api': { noticeDeepLinkPath: id => `/notices/${id}` },
    '@/src/features/schedules/schedule-api': { scheduleDeepLinkPath: id => `/schedules/${id}` },
    './push-registration': {}, '@/src/platform/app-variant': { isQaApp: true },
    '@/src/providers/platform-provider': { usePlatform: () => ({ client: null, session }) },
  });
  const render = async () => { h.begin(); bridge.PushNotificationBridge(); for (const effect of h.effects.splice(0)) effect(); await settle(); };
  await render(); assert.equal(routes.length, 0); assert.equal(cleared, 0);
  session = { user: { id: 'tester' }, access_token: 'fixture' };
  await render(); listener(response); await settle();
  assert.deepEqual(routes, ['/notices/notice-1']); assert.equal(cleared, 1);
});

test('QA today uses canonical server KST calendar instead of operator attendance exemption', async () => {
  const fixture = await attendance({ mode: 'preview', previewScenario: 'today', required: false });
  assert.deepEqual(fixture.calls.map(call => call.name).sort(),
    ['get_attendance_workday_status', 'get_my_attendance_today']);
  const button = fixture.render().find(node => node?.type === 'Pressable');
  assert.equal(button.props.disabled, true);
  assert.ok(fixture.render().includes('한글날'));
  await fixture.press();
  assert.deepEqual(mutations(fixture), []);
});

test('weekday employee preview shares the production button and confirmation flow with zero writes', async () => {
  const fixture = await attendance({ mode: 'preview', previewScenario: 'workday', required: false });
  const first = fixture.render().find(node => node?.type === 'Pressable');
  assert.equal(first.props.disabled, false);
  assert.equal(first.props.accessibilityLabel, '출근하기');
  await fixture.press();
  assert.ok(fixture.render().includes('퇴근하기'));
  await fixture.foreground();
  assert.ok(fixture.render().includes('퇴근하기'), 'same-day foreground should retain the simulated clock-in');
  await fixture.press();
  assert.ok(fixture.render().includes('✓ 오늘 근무 완료'));
  await fixture.foreground();
  assert.ok(fixture.render().includes('✓ 오늘 근무 완료'), 'same-day foreground should retain the completed simulated day');
  assert.ok(fixture.render().includes('다시 체험'));
  assert.ok(fixture.render().includes('가상 체험 · GPS 위치 검사 안 함 · 실제 근태 저장 안 함'));
  assert.ok(fixture.render().includes('가상 출퇴근 내역 · 실제 기록 아님'));
  assert.equal(fixture.render().includes('기록됨'), false, 'preview must not imply real attendance');
  assert.deepEqual(mutations(fixture), []);
  assert.equal(fixture.locationRequests(), 0);
});

test('server calendar failure in QA preview fails closed instead of faking an eligible weekday', async () => {
  const fixture = await attendance({
    mode: 'preview',
    previewScenario: 'today',
    calendarDay: { work_date: '2026-10-09', is_workday: null, reason: '한글날' },
  });
  const button = fixture.render().find(node => node?.type === 'Pressable');
  assert.equal(button.props.disabled, true);
  assert.ok(fixture.render().includes('서버 근무일 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.'));
  await fixture.press();
  assert.deepEqual(mutations(fixture), []);
});

test('production ordinary employee respects Hangul Day server closure and blocks attendance', async () => {
  const fixture = await attendance({ mode: 'record', required: true, isWorkday: false, dayReason: '한글날' });
  const button = fixture.render().find(node => node?.type === 'Pressable');
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.accessibilityLabel, '오늘은 출근일이 아닙니다');
  assert.ok(fixture.render().includes('한글날'));
  await fixture.press();
  assert.deepEqual(mutations(fixture), []);
  assert.equal(fixture.locationRequests(), 0);
});

test('production ordinary employee cannot check in before the server opens at 06:00 KST', async () => {
  const fixture = await attendance({ mode: 'record', required: true, isWorkday: true, clockInAvailable: false });
  const button = fixture.render().find(node => node?.type === 'Pressable');
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.accessibilityLabel, '출근 전입니다');
  await fixture.press();
  assert.deepEqual(mutations(fixture), []);
});


test('production server state progresses from 06:00 opening through clock-in/out and survives foreground refresh', async () => {
  const fixture = await attendance({ mode: 'record', required: true, clockInAvailable: false, persistRecord: true, result: { ok: true } });
  assert.equal(fixture.render().find(node => node?.type === 'Pressable').props.disabled, true);
  fixture.openClockIn();
  await fixture.foreground();
  assert.equal(fixture.render().find(node => node?.type === 'Pressable').props.disabled, false);
  await fixture.press();
  assert.equal(fixture.render().find(node => node?.type === 'Pressable').props.accessibilityLabel, '퇴근하기');
  await fixture.foreground();
  assert.equal(fixture.render().find(node => node?.type === 'Pressable').props.accessibilityLabel, '퇴근하기');
  await fixture.press();
  assert.ok(fixture.render().includes('✓ 오늘 근무 완료'));
  assert.equal(fixture.render().find(node => node?.type === 'Pressable').props.disabled, true);
  await fixture.foreground();
  await fixture.press();
  assert.deepEqual(mutations(fixture).map(call => [call.name, call.args.p_event_type]),
    [['record_attendance_event', 'clock_in'], ['record_attendance_event', 'clock_out']]);
});

test('denied location never writes attendance or offers an exception after repeated taps', async () => {
  for (const mode of ['record', 'qa']) {
    const fixture = await attendance({ mode, required: mode === 'record', locationFailure: true, locationCode: 'PERMISSION_DENIED' });
    await fixture.press(); await fixture.press();
    assert.deepEqual(mutations(fixture), []);
    assert.ok(fixture.render().includes('출퇴근을 위해 휴대폰의 위치 권한을 허용해주세요.'));
    assert.equal(fixture.render().includes('관리자 확인 요청'), false);
  }
});

test('SecureStore adapter restores a long session on module restart and removes all chunks on signout', async () => {
  const disk = new Map();
  const secureStore = {
    getItemAsync: async key => disk.get(key) ?? null,
    setItemAsync: async (key, value) => { disk.set(key, value); },
    deleteItemAsync: async key => { disk.delete(key); },
  };
  const freshStorage = () => load('mobile/src/platform/secure-storage.ts', { 'expo-secure-store': secureStore }).secureSessionStorage;
  const key = 'fixture-session', session = JSON.stringify({ fixture: 'x'.repeat(4000) });
  await freshStorage().setItem(key, session);
  assert.equal(await freshStorage().getItem(key), session);
  await freshStorage().setItem(key, 'refreshed-fixture');
  assert.equal(await freshStorage().getItem(key), 'refreshed-fixture');
  assert.equal(disk.size, 1, 'refresh retires old chunks');
  await freshStorage().setItem(key, session);
  await freshStorage().removeItem(key);
  assert.equal(await freshStorage().getItem(key), null);
  assert.equal(disk.size, 0, 'signout must leave no session chunk behind');
});


test('confirmed clock-in turns edge-on once, blocks same-frame taps and clock-out until the full 420ms transition ends', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = await attendance({ mode: 'record', required: true, persistRecord: true, result: { ok: true }, autoAnimation: false, recordGate: gate });
  const press = f.render().find(n => n.type === 'Pressable');
  press.props.onPress(); press.props.onPress(); await settle();
  assert.equal(mutations(f).length, 1); assert.equal(f.haptics.length, 0); assert.equal(f.animations.length, 0);
  release(); await settle();
  let button = f.render().find(n => n.type === 'Pressable');
  assert.equal(f.haptics.length, 1); assert.equal(f.animations.length, 1);
  assert.equal(button.props.disabled, true); assert.equal(button.props.accessibilityLabel, '출근하기');
  await f.press(); assert.equal(mutations(f).length, 1);
  f.finishAnimation();
  button = f.render().find(n => n.type === 'Pressable');
  assert.equal(button.props.accessibilityLabel, '퇴근하기'); assert.equal(button.props.disabled, true);
  assert.ok(f.render().some(n => typeof n === 'string' && n.includes('출근 완료')));
  f.finishAnimation();
  assert.equal(f.render().find(n => n.type === 'Pressable').props.disabled, false);
  assert.deepEqual(f.animations.map(a => [a.toValue, a.duration, a.useNativeDriver]), [[90,210,true],[0,210,true]]);
  await f.press();
  assert.equal(f.confirmations(), 1); assert.equal(f.haptics.length, 2); assert.equal(f.animations.length, 2);
  assert.ok(f.render().includes('✓ 오늘 근무 완료'));
  await f.foreground(); f.render();
  assert.equal(f.haptics.length, 2); assert.equal(f.animations.length, 2);
});

test('reduce motion uses immediate text; changing it during a turn cancels remaining motion without losing saved state', async () => {
  const reduced = await attendance({ mode: 'preview', previewScenario: 'workday', reduced: true });
  await reduced.press();
  assert.equal(reduced.animations.length, 0); assert.equal(reduced.haptics.length, 1);
  assert.equal(reduced.render().find(n => n.type === 'Pressable').props.accessibilityLabel, '퇴근하기');
  const f = await attendance({ mode: 'preview', previewScenario: 'workday', autoAnimation: false });
  await f.press(); f.reduceMotion(true);
  assert.equal(f.render().find(n => n.type === 'Pressable').props.accessibilityLabel, '퇴근하기');
  assert.equal(f.render().find(n => n.type === 'Pressable').props.disabled, false);
  f.finishAnimation(); assert.equal(f.animations.length, 1);
  await f.foreground(); assert.equal(f.haptics.length, 1);
});

test('GPS denial, server errors, already-recorded/approved responses and failed confirmation reads never signal a fresh success', async () => {
  for (const options of [
    { locationFailure: true, locationCode: 'PERMISSION_DENIED' },
    { locationFailure: true }, { serverFailure: true },
    { result: { ok: false, code: 'OUTSIDE_GEOFENCE' } },
    { result: { ok: false, code: 'ALREADY_RECORDED' } },
    { result: { ok: true, code: 'EXCEPTION_APPROVED' } }, { refreshFailure: true },
  ]) {
    const f = await attendance({ mode: 'record', required: true, persistRecord: true, result: { ok: true }, ...options });
    await f.press(); assert.equal(f.haptics.length, 0); assert.equal(f.animations.length, 0);
  }
});

test('initial restored attendance and foreground reads never animate; unsupported haptics do not change a successful result', async () => {
  const restored = await attendance({ mode: 'record', required: true, initialClockIn: { status: 'recorded', event_at: '2026-10-19T00:02:00Z' } });
  assert.equal(restored.render().find(n => n.type === 'Pressable').props.accessibilityLabel, '퇴근하기');
  await restored.foreground(); assert.equal(restored.animations.length, 0); assert.equal(restored.haptics.length, 0);
  const f = await attendance({ mode: 'preview', previewScenario: 'workday', hapticFailure: true });
  await f.press(); assert.ok(f.render().includes('퇴근하기')); assert.equal(f.haptics.length, 1);
  assert.equal(f.animations.length, 2); assert.deepEqual(mutations(f), []); assert.equal(f.locationRequests(), 0);
});

test('QA write guard suppresses feedback; safe QA validates then gives one feedback and never records attendance', async () => {
  const blocked = await attendance({ result: { ok: true, writes_attendance: true } });
  await blocked.press(); assert.equal(blocked.haptics.length, 0); assert.equal(blocked.animations.length, 0);
  const f = await attendance(); await f.press();
  assert.equal(f.haptics.length, 1); assert.equal(f.animations.length, 2);
  assert.deepEqual(mutations(f).map(c => c.name), ['qa_validate_attendance_event']);
});

test('background interrupts rotation without replay; accessibility state follows busy and disabled state', async () => {
  const f = await attendance({ mode: 'preview', previewScenario: 'workday', autoAnimation: false });
  await f.press(); let button = f.render().find(n => n.type === 'Pressable');
  assert.equal(button.props.accessibilityState.busy, true); assert.equal(button.props.accessibilityState.disabled, true);
  await f.background(); f.finishAnimation(); await f.foreground();
  button = f.render().find(n => n.type === 'Pressable');
  assert.equal(button.props.accessibilityState.busy, false); assert.equal(button.props.accessibilityLabel, '퇴근하기');
  assert.equal(f.animations.length, 1); assert.equal(f.haptics.length, 1);
});


test('native animation cancellation releases the action lock and keeps confirmed attendance text', async () => {
  const f = await attendance({ mode: 'preview', previewScenario: 'workday', autoAnimation: false });
  await f.press(); f.finishAnimation(false);
  const button = f.render().find(n => n.type === 'Pressable');
  assert.equal(button.props.disabled, false); assert.equal(button.props.accessibilityLabel, '퇴근하기');
  assert.equal(f.animations.length, 1); assert.equal(f.haptics.length, 1);
});


test('supporting attendance chips only show present events, wrap large text and preserve simulated/exception labels', async () => {
  const f = await attendance({ mode: 'preview', previewScenario: 'workday', reduced: true });
  const chips = () => f.render().filter(n => n.type === 'View' && n.props?.accessible === true);
  assert.equal(chips().length, 0, 'no placeholder clock-in/out before attendance');
  await f.press();
  assert.equal(chips().length, 1); assert.match(chips()[0].props.accessibilityLabel, /가상 출근.*실제 기록 아님/);
  assert.ok(!f.render().some(n => typeof n === 'string' && n.includes('아직 기록 없음')));
  const chipText = f.render().find(n => n.type === 'Text' && n.props?.style?.fontSize === 15 && n.props?.style?.fontWeight === '600');
  assert.equal(chipText.props.numberOfLines, undefined); assert.equal(chipText.props.allowFontScaling, undefined);
  assert.equal(chips()[0].props.style.maxWidth, '100%');
  await f.press(); assert.equal(chips().length, 2);
  assert.match(chips()[1].props.accessibilityLabel, /가상 퇴근.*실제 기록 아님/);
  const exception = await attendance({ mode: 'record', required: true, initialClockIn: { status: 'exception_pending', event_at: null, requested_at: '2026-10-19T00:02:00Z' } });
  const pendingChip = exception.render().find(n => n.type === 'View' && n.props?.accessible === true);
  assert.match(pendingChip.props.accessibilityLabel, /출근.*관리자 확인 중/);
  assert.ok(exception.render().includes('관리자 확인 중'));
});
