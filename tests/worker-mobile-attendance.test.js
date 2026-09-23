const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('worker mobile and optional operations scripts parse', () => {
  for (const file of [
    'app/assets/pwa-install.js',
    'app/assets/employee-common-home-v1.js',
    'app/assets/attendance-admin.js',
    'app/assets/attendance-integrity-ui.js',
    'app/assets/operations-promotion-writer.js',
    'app/assets/operations-homepage-direct.js',
    'assets/js/homepage-live-overrides.js'
  ]) {
    assert.doesNotThrow(() => new Function(read(file)), file);
  }
});

test('app UI uses one production employee-home renderer while keeping shared PWA and attendance modules', () => {
  const source = read('app/assets/app-ui.js');
  assert.match(source, /pwa-install\.js/);
  assert.doesNotMatch(source, /worker-mobile-v1\.js/);
  assert.match(source, /employee-common-home-v1\.js/);
  assert.match(source, /attendance-admin\.js/);
  assert.match(source, /attendance-integrity-ui\.js/);
  assert.match(source, /operations-promotion-writer\.js/);
  assert.match(source, /operations-homepage-direct\.js/);
});

test('PWA install card owns one role-independent visual contract', () => {
  const source = read('app/assets/pwa-install.js');
  assert.match(source, /data-pwa-install-card/);
  assert.match(source, /\.worker-install-card/);
  assert.match(source, /\.worker-primary-button/);
  assert.match(source, /ensureStyles\(\)/);
});



test('common employee home owns live attendance, no-write QA, and preview-safe behavior', () => {
  const source = read('app/assets/employee-common-home-v1.js');
  assert.match(source, /record_attendance_event/);
  assert.match(source, /qa_validate_attendance_event/);
  assert.match(source, /attendance\.qa_validate/);
  assert.match(source, /기능 검수 모드 · 실제 근태에 반영되지 않음/);
  assert.match(source, /화면 미리보기 · 실제 근태 기록 없음/);
  assert.match(source, /근태 기록 대상이 아닙니다/);
  assert.match(source, /if \(isPreviewMode\(\)\)/);
  assert.match(source, /writes_attendance !== false/);
  assert.match(source, /if \(!qaMode\) allowException/);
  assert.match(source, /OUTSIDE_GEOFENCE/);
});



test('attendance integrity UI hides personal attendance for excluded employees and gates correction by capability', () => {
  const source = read('app/assets/attendance-integrity-ui.js');
  assert.match(source, /근태 기록 대상이 아닙니다/);
  assert.match(source, /attendance\.correct/);
  assert.match(source, /hasCapabilityContract/);
  assert.match(source, /create_attendance_correction/);
  assert.match(source, /누락 시간 추가/);
  assert.match(source, /시간 정정/);
  assert.match(source, /무효 처리/);
  assert.match(source, /원본 기록은 그대로 보존/);
  assert.match(source, /get_attendance_correction_history/);
});

test('attendance admin separates view and exception-review capabilities', () => {
  const source = read('app/assets/attendance-admin.js');
  assert.match(source, /attendance\.admin_view/);
  assert.match(source, /attendance\.exception_review/);
  assert.match(source, /hasCapabilityContract/);
  assert.match(source, /review_attendance_exception/);
});

test('operations manager employee-home entry injects common employee styling before rendering', () => {
  const source = read('app/assets/employee-common-home-v1.js');
  const match = source.match(/function showEmployeeHome\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(match, 'showEmployeeHome should exist');
  assert.match(match[1], /injectStyles\(\);[\s\S]*const home = buildHome\(\);/);
});

test('employee home releases the desktop sidebar scroll lock on every entry path and restores it for the role dashboard', () => {
  const source = read('app/assets/employee-common-home-v1.js');
  const home = source.match(/function showEmployeeHome\(\) \{([\s\S]*?)\n  \}/);
  const start = source.match(/async function startEmployeeHome\(\) \{([\s\S]*?)\n  \}/);
  const dashboard = source.match(/function showRoleDashboard\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(home, 'showEmployeeHome should exist');
  assert.ok(start, 'startEmployeeHome should exist');
  assert.ok(dashboard, 'showRoleDashboard should exist');
  assert.match(home[1], /classList\.remove\('desktop-app-mode'\)/);
  assert.match(start[1], /classList\.remove\('desktop-app-mode'\)/);
  assert.match(source, /body\.employee-home-mode \{ background:#f6f6f2; overflow-y:auto !important; overflow-x:hidden; \}/);
  assert.match(dashboard[1], /classList\.toggle\('desktop-app-mode', route\(\) !== 'general_worker'\)/);
});

test('general worker, promotion staff, and lead share the common employee home while only work roles get shortcuts', () => {
  const source = read('app/assets/employee-common-home-v1.js');
  assert.match(source, /\['general_worker', 'promotion_staff', 'promotion_lead'\]\.includes\(currentRoute\)/);
  assert.match(source, /currentRoute !== 'general_worker'/);
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

test('employee attendance eligibility is data-driven while operations manager keeps the employee home', () => {
  const bridge = read('app/assets/employee-common-home-v1.js');
  const integrity = read('app/assets/attendance-integrity-ui.js');
  const migration = read('supabase/migrations/20260922010000_goal_329_employee_app_attendance_qa.sql');
  assert.match(bridge, /ALL_EMPLOYEE_HOME_ROLES = new Set\(\['general_worker', 'promotion_staff', 'promotion_lead', 'operations_manager'\]\)/);
  assert.match(bridge, /currentRoute === 'operations_manager'/);
  assert.match(bridge, /attendance\.qa_validate/);
  assert.match(integrity, /attendance_required !== false/);
  assert.match(migration, /e\.attendance_required/);
  const subject = migration.match(/create or replace function public\.private_employee_is_attendance_subject[\s\S]*?create or replace function public\.private_validate_attendance_attempt/)?.[0] || '';
  assert.doesNotMatch(subject, /ceo|operations_manager|profile_roles|positions/i);
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

test('attendance correction ledger is additive and raw GPS table is not mutated by correction RPC', () => {
  const migration = read('supabase/migrations/20260908233000_issue_149_attendance_executive_exclusion_and_corrections.sql');
  assert.match(migration, /create table public\.attendance_corrections/);
  assert.match(migration, /ATTENDANCE_CORRECTION_APPEND_ONLY/);
  assert.match(migration, /attendance_correction_created/);
  const functionMatch = migration.match(/create or replace function public\.create_attendance_correction[\s\S]*?create or replace function public\.get_attendance_correction_history/);
  assert.ok(functionMatch, 'correction RPC body should be present');
  assert.doesNotMatch(functionMatch[0], /update public\.attendance_events/i);
  assert.doesNotMatch(functionMatch[0], /delete from public\.attendance_events/i);
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
