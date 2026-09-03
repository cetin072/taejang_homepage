const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('worker mobile scripts parse', () => {
  for (const file of [
    'app/assets/pwa-install.js',
    'app/assets/worker-mobile-v1.js',
    'app/assets/employee-common-home-v1.js',
    'app/assets/attendance-admin.js'
  ]) {
    assert.doesNotThrow(() => new Function(read(file)), file);
  }
});

test('app UI loads PWA, worker attendance, common employee home, and attendance admin modules', () => {
  const source = read('app/assets/app-ui.js');
  assert.match(source, /pwa-install\.js/);
  assert.match(source, /worker-mobile-v1\.js/);
  assert.match(source, /employee-common-home-v1\.js/);
  assert.match(source, /attendance-admin\.js/);
});

test('worker UI remains simple and blocks abusive exception patterns', () => {
  const source = read('app/assets/worker-mobile-v1.js');
  assert.match(source, /출근했습니다/);
  assert.match(source, /퇴근했습니다/);
  assert.match(source, /확인했습니다/);
  assert.match(source, /attempts\[eventType\] < 2/);
  assert.match(source, /관리자에게 한 번만 확인을 요청했습니다/);
  assert.match(source, /위치 권한을 허용해주세요.*관리자 요청으로 대신할 수 없습니다/);
  assert.match(source, /OUTSIDE_GEOFENCE/);
});

test('promotion staff and lead start from the common employee home with work shortcuts', () => {
  const source = read('app/assets/employee-common-home-v1.js');
  assert.match(source, /promotion_staff/);
  assert.match(source, /promotion_lead/);
  assert.match(source, /홍보 업무 열기/);
  assert.match(source, /운영팀 업무 열기/);
  assert.match(source, /직원 홈/);
  assert.match(source, /출근했습니다/);
  assert.match(source, /퇴근했습니다/);
  assert.match(source, /확인했습니다/);
});

test('operations manager can enter server-backed general worker simulation', () => {
  const migration = read('supabase/migrations/20260904002000_employee_common_home_roles.sql');
  const bridge = read('app/assets/employee-common-home-v1.js');
  assert.match(migration, /general_worker', 'promotion_staff', 'promotion_lead/);
  assert.match(migration, /set_role_simulation_mode/);
  assert.match(bridge, /일반직원 보기/);
  assert.match(bridge, /set_role_simulation_mode/);
  assert.match(bridge, /운영총괄 복귀/);
});

test('attendance database enforces one event per person/date/type and role boundaries', () => {
  const first = read('supabase/migrations/20260903234500_worker_mobile_attendance_v1.sql');
  const guard = read('supabase/migrations/20260903234600_worker_attendance_non_workday_guard.sql');
  const fatigue = read('supabase/migrations/20260903234700_worker_attendance_exception_fatigue_guard.sql');
  const employeeScope = read('supabase/migrations/20260904002000_employee_common_home_roles.sql');
  assert.match(first, /unique \(profile_id, work_date, event_type\)/i);
  assert.match(first, /promotion_lead/);
  assert.match(first, /operations_manager/);
  assert.match(first, /general_worker/);
  assert.match(guard, /extract\(isodow from p_work_date\)/i);
  assert.match(guard, /NON_WORKDAY/);
  assert.match(guard, /set_attendance_workday_override/);
  assert.match(fatigue, /LOCATION_PERMISSION_REQUIRED/);
  assert.match(fatigue, /OUTSIDE_GEOFENCE_NO_EXCEPTION/);
  assert.match(employeeScope, /r\.code in \('general_worker', 'promotion_staff', 'promotion_lead'\)/);
});

test('PWA is standalone and network-first without offline staff-data cache', () => {
  const manifest = JSON.parse(read('staff/manifest.webmanifest'));
  const worker = read('sw.js');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/staff/');
  assert.match(worker, /respondWith\(fetch\(event\.request\)\)/);
  assert.doesNotMatch(worker, /caches\.open/);
});

test('expired opening invitation announcement is removed from homepage', () => {
  const home = read('index.html');
  assert.doesNotMatch(home, /taejang-news01\.netlify\.app/);
  assert.doesNotMatch(home, /초대장 보기/);
});
