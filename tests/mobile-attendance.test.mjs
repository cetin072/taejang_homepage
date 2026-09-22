import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('mobile attendance pins Expo Location and requests foreground use only', async () => {
  const pkg = JSON.parse(await text('mobile/package.json'));
  const app = JSON.parse(await text('mobile/app.json'));
  assert.equal(pkg.dependencies['expo-location'], '57.0.19');
  const plugin = app.expo.plugins.find(item => Array.isArray(item) && item[0] === 'expo-location');
  assert.ok(plugin, 'expo-location config plugin must be present');
  assert.equal(plugin[1].isAndroidBackgroundLocationEnabled, false);
  assert.equal(plugin[1].isAndroidForegroundServiceEnabled, false);
});

test('native attendance location improves accuracy without client-side geofence rules', async () => {
  const location = await text('mobile/src/features/attendance/attendance-location.ts');
  assert.match(location, /requestForegroundPermissionsAsync/);
  assert.match(location, /watchPositionAsync/);
  assert.match(location, /Accuracy\.Highest/);
  assert.match(location, /MAX_ACCEPTABLE_ACCURACY_M = 80/);
  assert.match(location, /FINAL_TIMEOUT_MS = 14000/);
  assert.doesNotMatch(location, /background|startLocationUpdatesAsync|startGeofencingAsync/i);
  assert.doesNotMatch(location, /60\s*\*|radius|haversine|taejang_main/i);
});

test('mobile attendance reuses existing server RPC contracts', async () => {
  const api = await text('mobile/src/features/attendance/attendance-api.ts');
  assert.match(api, /get_my_attendance_today/);
  assert.match(api, /record_attendance_event/);
  assert.match(api, /request_attendance_exception/);
  assert.match(api, /qa_validate_attendance_event/);
  assert.match(api, /holiday_work_assigned/);
  assert.doesNotMatch(api, /attendance_events|attendance_locations|service_role/i);
});

test('holiday action stays visible but re-checks server authorization before GPS', async () => {
  const card = await text('mobile/src/features/attendance/attendance-card.tsx');
  const serverCheck = card.indexOf('const latest = await loadMyAttendanceToday(client)');
  const locationCheck = card.indexOf('position = await getBestAttendancePosition');
  assert.ok(serverCheck >= 0 && locationCheck > serverCheck, 'server day status must be rechecked before GPS');
  assert.match(card, /오늘은 휴일입니다\. 휴일근무가 지정된 직원만 출퇴근할 수 있습니다/);
  assert.match(card, /let action: AttendanceEventType \| null = 'clock_in'/);
  assert.doesNotMatch(card, /today\?\.is_workday !== false \? \(/);
});

test('employee attendance UX preserves hard geofence failure and conservative exceptions', async () => {
  const card = await text('mobile/src/features/attendance/attendance-card.tsx');
  assert.match(card, /OUTSIDE_GEOFENCE/);
  assert.match(card, /LOCATION_UNCERTAIN/);
  assert.match(card, /CLOCK_IN_REQUIRED/);
  assert.match(card, /PERMISSION_DENIED/);
  assert.match(card, /attempts\.current\[eventType\] < 2/);
  assert.match(card, /관리자 확인 요청/);
  assert.match(card, /Alert\.alert/);
  assert.match(card, /정말 퇴근하시겠습니까/);
  assert.match(card, /text: '취소'/);
  assert.match(card, /text: mode === 'qa' \? '검수 계속' : '퇴근했습니다'/);

  const permissionBranch = card.match(/if \(error\.code === 'PERMISSION_DENIED'\)[\s\S]*?\} else \{/i)?.[0] || '';
  assert.doesNotMatch(permissionBranch, /allowException/);
});

test('employee mobile home always keeps one attendance block before notice even for non-attendance roles', async () => {
  const home = await text('mobile/app/index.tsx');
  const attendance = home.indexOf('<AttendanceCard');
  const notices = home.indexOf('<NoticeHomeAction');
  assert.ok(attendance >= 0 && notices > attendance, 'attendance action must precede notices');
  assert.doesNotMatch(home, /canRecordAttendance\s*\?\s*<AttendanceCard/);
  assert.match(home, /<AttendanceCard[\s\S]*?minHeight=\{actionHeight\}/);
});