const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const foundation = read('supabase/migrations/20260904083000_employee_identity_foundation_v1.sql');
const storage = read('supabase/migrations/20260904083300_employee_private_media_path_fix.sql');
const signupGuard = read('supabase/migrations/20260904083200_employee_signup_link_guard.sql');
const config = read('supabase/config.toml');
const appUi = read('app/assets/app-ui.js');
const employeeUi = read('app/assets/employee-management.js');
const approvalUi = read('app/assets/phase-c-account-approval.js');
const menuStatus = read('app/assets/menu-status.js');
const attendance = read('supabase/migrations/20260903234500_worker_mobile_attendance_v1.sql');

test('employee identity is separate from Auth/profile and employee_id is immutable', () => {
  for (const table of ['people', 'employees', 'account_person_links', 'employee_photos', 'employee_change_requests']) {
    assert.match(foundation, new RegExp(`create table if not exists public\\.${table}\\b`));
    assert.match(foundation, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(foundation, /employee_id text not null unique/);
  assert.match(foundation, /\^TJ-\[0-9\]\{6,\}\$/);
  assert.match(foundation, /EMPLOYEE_ID_IMMUTABLE/);
  assert.match(foundation, /account_person_links_one_active_profile/);
  assert.match(foundation, /account_person_links_one_active_person/);
});

test('employee tables are not directly exposed to browser roles', () => {
  assert.match(foundation, /revoke all on public\.people, public\.employees, public\.account_person_links, public\.employee_photos, public\.employee_change_requests\s+from public, anon, authenticated/s);
  assert.doesNotMatch(foundation, /grant\s+(?:select|insert|update|delete)[^;]*public\.employees[^;]*authenticated/i);
});

test('operations manager and team-lead boundaries are enforced in guarded RPCs', () => {
  assert.match(foundation, /current_user_has_role\('operations_manager'\)/);
  assert.match(foundation, /current_user_has_role\('promotion_lead'\) or public\.current_user_has_role\('department_lead'\)/);
  assert.match(foundation, /EMPLOYEE_OUT_OF_SCOPE/);
  assert.match(foundation, /PROTECTED_EMPLOYEE_CHANGE_FORBIDDEN/);
  assert.match(foundation, /department_id\s*=\s*public\.private_team_lead_department\(\)/);
  assert.match(foundation, /review_employee_change_request/);
});

test('employee photos use a private bucket and id photos are not team-lead readable', () => {
  assert.match(config, /\[storage\.buckets\.employee-private-media\][\s\S]*?public = false/);
  assert.match(storage, /bucket_id = 'employee-private-media'/);
  assert.match(storage, /array_length\(storage\.foldername\(name\), 1\) >= 2/);
  assert.match(storage, /\(storage\.foldername\(name\)\)\[2\] = 'profile'/);
  assert.doesNotMatch(storage, /employee\.department_id = public\.private_team_lead_department\(\)[\s\S]{0,120}\(storage\.foldername\(name\)\)\[2\] = 'id_photo'/);
  assert.match(employeeUi, /storage\/v1\/object\/employee-private-media/);
  assert.match(employeeUi, /storage\/v1\/object\/sign\/employee-private-media/);
  assert.doesNotMatch(employeeUi, /storage\/v1\/object\/public\/employee-private-media/);
});

test('employee management UI supports direct ops management and team requests without editable employee id', () => {
  assert.match(appUi, /assets\/employee-management\.js/);
  assert.match(employeeUi, /new Set\(\['operations_manager', 'promotion_lead', 'department_lead'\]\)/);
  assert.match(employeeUi, /create_employee/);
  assert.match(employeeUi, /update_employee_core/);
  assert.match(employeeUi, /submit_employee_change_request/);
  assert.match(employeeUi, /review_employee_change_request/);
  assert.match(employeeUi, /직원 관리/);
  assert.match(employeeUi, /팀 직원 관리/);
  assert.doesNotMatch(employeeUi, /field\(['"]직원번호['"]/);
});

test('staff signup approval requires an explicit Employee selection and blocks legacy bypass', () => {
  assert.match(approvalUi, /get_signup_employee_options/);
  assert.match(approvalUi, /approve_signup_request_with_employee/);
  assert.match(approvalUi, /연결할 직원 선택/);
  assert.match(approvalUi, /이름이나 이메일로 자동매칭하지 않습니다/);
  assert.match(signupGuard, /EMPLOYEE_LINK_REQUIRED/);
  assert.match(signupGuard, /general_worker/);
  assert.match(signupGuard, /promotion_staff/);
  assert.match(signupGuard, /promotion_lead/);
});

test('unfinished menus are explicitly labelled 점검중 while implemented menus remain untouched', () => {
  assert.match(appUi, /assets\/menu-status\.js/);
  assert.match(menuStatus, /INCOMPLETE_MENU_LABELS = new Set\(\['신규 사업 기획'\]\)/);
  assert.match(menuStatus, /`\$\{label\} · 점검중`/);
  assert.doesNotMatch(menuStatus, /일정 관리|공지 관리|안내 관리|작업 매뉴얼/);
});

test('attendance remains profile-based in this phase to avoid a risky migration', () => {
  assert.match(attendance, /profile_id uuid not null references public\.profiles\(id\)/);
  assert.doesNotMatch(foundation, /alter table public\.attendance_events/);
  assert.doesNotMatch(foundation, /update public\.attendance_events/);
});
