import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('attendance mobile uses Expo 57 location with foreground-only policy', async () => {
  const pkg = JSON.parse(await text('mobile/package.json'));
  const app = JSON.parse(await text('mobile/app.json'));
  const location = await text('mobile/src/features/attendance/location-acquisition.ts');

  assert.equal(pkg.dependencies['expo-location'], '57.0.18');
  assert.ok(app.expo.plugins.includes('expo-location'));
  assert.match(location, /getForegroundPermissionsAsync/);
  assert.match(location, /requestForegroundPermissionsAsync/);
  assert.match(location, /watchPositionAsync/);
  assert.match(location, /Location\.Accuracy\.Highest/);
  assert.match(location, /MAX_ACCEPTABLE_ACCURACY_M = 80/);
  assert.match(location, /ACQUISITION_TIMEOUT_MS = 14_000/);
  assert.match(location, /backgroundTrackingEnabled:\s*false/);
  assert.match(location, /clientGeofenceDecisionEnabled:\s*false/);
  assert.doesNotMatch(location, /requestBackgroundPermissionsAsync|startLocationUpdatesAsync/);
});

test('attendance mobile reuses existing server RPCs and does not implement geofence distance', async () => {
  const api = await text('mobile/src/features/attendance/attendance-api.ts');
  const location = await text('mobile/src/features/attendance/location-acquisition.ts');

  assert.match(api, /get_my_attendance_today/);
  assert.match(api, /record_attendance_event/);
  assert.match(api, /request_attendance_exception/);
  assert.match(api, /p_latitude/);
  assert.match(api, /p_longitude/);
  assert.match(api, /p_accuracy_m/);
  assert.doesNotMatch(api + location, /haversine|private_attendance_distance_m|office\.latitude|office\.longitude/i);
});

test('attendance exception request excludes permission denial and keeps outside-geofence fail closed', async () => {
  const api = await text('mobile/src/features/attendance/attendance-api.ts');
  const card = await text('mobile/src/features/attendance/attendance-card.tsx');

  assert.match(api, /'POSITION_UNAVAILABLE' \| 'TIMEOUT' \| 'LOCATION_UNCERTAIN'/);
  assert.doesNotMatch(api.match(/requestMyAttendanceException[\s\S]*?\n}/)?.[0] || '', /PERMISSION_DENIED/);
  assert.match(card, /관리자 요청으로 대신할 수 없습니다/);
  assert.match(card, /OUTSIDE_GEOFENCE/);
  assert.match(card, /회사 출퇴근 가능 위치 밖/);
  assert.match(card, /nextCount >= 2/);
});

test('network failures do not become location-failure attempts', async () => {
  const card = await text('mobile/src/features/attendance/attendance-card.tsx');
  assert.match(card, /네트워크 또는 서버 연결을 확인해 주세요\. 위치 실패 횟수에는 포함하지 않습니다/);
  assert.doesNotMatch(card, /catch \{[\s\S]{0,180}registerLocationFailure\(eventType/);
});

test('employee home renders attendance before notices', async () => {
  const app = await text('mobile/app/index.tsx');
  const attendanceIndex = app.indexOf('<AttendanceCard />');
  const noticeIndex = app.indexOf('<Text style={styles.sectionTitle}>공지사항</Text>');
  assert.ok(attendanceIndex >= 0 && noticeIndex > attendanceIndex);
});

test('attendance card handles required lifecycle and duplicate-safe server responses', async () => {
  const card = await text('mobile/src/features/attendance/attendance-card.tsx');
  for (const code of [
    'ATTENDANCE_RECORDED',
    'ALREADY_RECORDED',
    'EXCEPTION_APPROVED',
    'EXCEPTION_PENDING',
    'EXCEPTION_REJECTED',
    'CLOCK_IN_REQUIRED',
    'NON_WORKDAY',
    'LOCATION_UNCERTAIN',
    'OUTSIDE_GEOFENCE',
  ]) {
    assert.match(card, new RegExp(code));
  }
  assert.match(card, /attendance_required === false/);
  assert.match(card, /is_workday === false/);
  assert.match(card, /오늘 출퇴근 기록을 완료했습니다/);
});
