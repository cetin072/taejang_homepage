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
} = {}) {
  const h = hooks(), calls = [];
  let latestRequired = required, locationRequests = 0;
  let onAppStateChange = null;
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_my_attendance_today') return { data: {
      work_date: '2026-10-09', attendance_required: latestRequired,
      is_workday: isWorkday, day_reason: dayReason,
      clock_in_available: clockInAvailable, clock_in: null, clock_out: null,
    } };
    if (name === 'get_attendance_workday_status') return { data: calendarDay };
    return { data: result };
  } };
  const api = load('mobile/src/features/attendance/attendance-api.ts', {});
  const previewState = load('mobile/src/features/qa/qa-preview-state.ts', {});
  class AttendanceLocationError extends Error { constructor() { super('location'); this.code = 'TIMEOUT'; } }
  const card = load('mobile/src/features/attendance/attendance-card.tsx', {
    react: h.react,
    'react-native': {
      ...native,
      AppState: { addEventListener: (_event, callback) => {
        onAppStateChange = callback;
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
    calls, render, locationRequests: () => locationRequests, changeRequired(value) { latestRequired = value; },
    async foreground() {
      if (onAppStateChange) onAppStateChange('active');
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
      './release-policy': { installedAppVersion: () => ({ version: '0.1.3', versionCode: 4 }), decideUpdate: () => { decisions++; return 'forced'; } },
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
      },
      '@/src/features/notices/notice-api': { noticeDeepLinkPath: id => `/notices/${id}` },
      '@/src/features/schedules/schedule-api': { scheduleDeepLinkPath: id => `/schedules/${id}` },
      './push-registration': { registerCurrentPushDevice: async (_client, options) => registrations.push(options) },
      '@/src/platform/app-variant': { isQaApp: qa },
      '@/src/providers/platform-provider': { usePlatform: () => ({ client: {}, session: { access_token: 'fixture' } }) },
    });
    h.begin(); bridge.PushNotificationBridge();
    for (const effect of h.effects.splice(0)) effect();
    await settle();
    assert.equal(registrations.length, qa ? 0 : 1);
    for (const target of ['notice', 'schedule']) {
      listener({ notification: { request: { content: { data: { target, [`${target}Id`]: 'fixture' } } } } });
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
  assert.equal(first.props.accessibilityLabel, '출근했습니다');
  await fixture.press();
  assert.ok(fixture.render().includes('퇴근했습니다'));
  await fixture.foreground();
  assert.ok(fixture.render().includes('퇴근했습니다'), 'same-day foreground should retain the simulated clock-in');
  await fixture.press();
  assert.ok(fixture.render().includes('오늘 근무 완료'));
  await fixture.foreground();
  assert.ok(fixture.render().includes('오늘 근무 완료'), 'same-day foreground should retain the completed simulated day');
  assert.ok(fixture.render().includes('다시 체험'));
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
