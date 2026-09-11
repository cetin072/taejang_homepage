const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app/assets/attendance-location.js'), 'utf8');
const position = accuracy => ({ coords: { latitude: 35.2476581, longitude: 128.61418, accuracy } });

function locationApi({ permission = 'granted', geolocation, timers = { setTimeout, clearTimeout } }) {
  const window = {};
  const navigator = { geolocation, permissions: { query: async () => ({ state: permission }) } };
  new Function('window', 'navigator', 'setTimeout', 'clearTimeout', source)(window, navigator, timers.setTimeout, timers.clearTimeout);
  return window.TaejangAttendanceLocation;
}

function manualTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    run(ms) {
      const due = [...pending.entries()].filter(([, timer]) => timer.ms === ms);
      due.forEach(([id, timer]) => {
        pending.delete(id);
        timer.fn();
      });
    }
  };
}

test('attendance location keeps sampling after an inaccurate first fix and uses the better fix', async () => {
  let success;
  let cleared;
  const api = locationApi({ geolocation: {
    watchPosition: (ok, fail, options) => { success = ok; assert.equal(options.enableHighAccuracy, true); assert.equal(options.maximumAge, 0); return 42; },
    clearWatch: id => { cleared = id; }
  } });
  const pending = api.getBestPosition();
  await new Promise(resolve => setTimeout(resolve, 0));
  success(position(120));
  success(position(24));
  assert.equal((await pending).coords.accuracy, 24);
  assert.equal(cleared, 42);
});

test('attendance location does not settle an inaccurate fix at the 6 second sample window', async () => {
  let success;
  let cleared;
  const timers = manualTimers();
  const stages = [];
  const api = locationApi({ timers, geolocation: {
    watchPosition: ok => { success = ok; return 51; },
    clearWatch: id => { cleared = id; }
  } });

  const pending = api.getBestPosition({ onStage: (...args) => stages.push(args) });
  await new Promise(resolve => setTimeout(resolve, 0));
  success(position(125));
  timers.run(6000);
  success(position(28));

  assert.equal((await pending).coords.accuracy, 28);
  assert.equal(cleared, 51);
  assert.ok(stages.some(([stage, accuracy]) => stage === 'improving' && accuracy === 125));
});

test('attendance location returns the best available fix only at the final acquisition timeout', async () => {
  let success;
  const timers = manualTimers();
  const api = locationApi({ timers, geolocation: {
    watchPosition: ok => { success = ok; return 61; },
    clearWatch() {}
  } });

  const pending = api.getBestPosition();
  await new Promise(resolve => setTimeout(resolve, 0));
  success(position(130));
  timers.run(6000);
  timers.run(14000);
  assert.equal((await pending).coords.accuracy, 130);
});

test('attendance location reports a denied permission before location collection', async () => {
  const api = locationApi({ permission: 'denied', geolocation: { watchPosition() { throw new Error('must not start'); }, clearWatch() {} } });
  await assert.rejects(api.getBestPosition(), error => error.code === 'PERMISSION_DENIED');
});

test('attendance location distinguishes unavailable and timeout browser failures', async () => {
  const unsupported = locationApi({ geolocation: undefined });
  await assert.rejects(unsupported.getBestPosition(), error => error.code === 'GEOLOCATION_UNAVAILABLE');

  let failure;
  const api = locationApi({ geolocation: {
    watchPosition: (ok, fail) => { failure = fail; return 7; },
    clearWatch() {}
  } });
  const pending = api.getBestPosition();
  await new Promise(resolve => setTimeout(resolve, 0));
  failure({ code: 3 });
  await assert.rejects(pending, error => error.code === 'TIMEOUT');
});

test('attendance clients distinguish location, server, duplicate, and in-flight states without changing server contracts', () => {
  for (const file of ['app/assets/worker-mobile-v1.js', 'app/assets/employee-common-home-v1.js']) {
    const client = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(client, /attendanceInFlight\[eventType\]/);
    assert.match(client, /getBestPosition/);
    assert.match(client, /위치 정확도를 확인하고 있습니다/);
    assert.match(client, /서버에 출근·퇴근 기록을 확인하고 있습니다/);
    assert.match(client, /이미 등록된 기록이 있습니다/);
    assert.match(client, /stage === 'server'/);
    assert.match(client, /OUTSIDE_GEOFENCE/);
    assert.match(client, /LOCATION_UNCERTAIN/);
    assert.doesNotMatch(client, /getCurrentPosition/);
  }
  assert.match(source, /watchPosition/);
  assert.match(source, /MAX_ACCEPTABLE_ACCURACY_M = 80/);
  assert.match(source, /enableHighAccuracy: true/);
  assert.doesNotMatch(source, /sampleTimer = setTimeout\(\(\) => finish\(best/);
});

test('attendance exception retry count only tracks real location failures', () => {
  for (const file of ['app/assets/worker-mobile-v1.js', 'app/assets/employee-common-home-v1.js']) {
    const client = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(client, /result\?\.code !== 'LOCATION_UNCERTAIN'\) attempts\[eventType\] = Math\.max\(0, attempts\[eventType\] - 1\)/);
    assert.match(client, /if \(stage === 'server'\) \{[\s\S]*attempts\[eventType\] = Math\.max\(0, attempts\[eventType\] - 1\)/);
    assert.match(client, /code === 'PERMISSION_DENIED'[\s\S]*attempts\[eventType\] = Math\.max\(0, attempts\[eventType\] - 1\)/);
    assert.match(client, /code === 'GEOLOCATION_UNAVAILABLE'[\s\S]*attempts\[eventType\] = Math\.max\(0, attempts\[eventType\] - 1\)/);
  }
});
