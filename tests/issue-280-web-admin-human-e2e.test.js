'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260920043107_issue_280_web_admin_human_e2e_contract.sql');
const dashboard = read('app/assets/dashboard-shell.js');
const gates = read('app/assets/capability-ui-gates.js');
const app = read('app/assets/app.js');
const workspace = read('app/assets/app-workspace-surface.js');
const scheduleAdmin = read('app/assets/schedule-admin.js');
const noticeAdmin = read('app/assets/notice-admin.js');
const guidanceAdmin = read('app/assets/guidance-admin.js');
const capabilityAccess = read('app/assets/capability-access.js');
const attendance = read('app/assets/attendance-admin.js');
const correctionUi = read('app/assets/attendance-integrity-ui.js');
const simulation = read('app/assets/phase-c-role-simulation.js');
const onboarding = read('supabase/migrations/20260919235000_issue_274_mobile_onboarding_holiday.sql');

test('promotion lead operational capabilities appear through the shared master sidebar without gaining payroll management', () => {
  for (const capability of ['task.manage', 'schedule.manage', 'notice.manage']) {
    assert.match(migration, new RegExp(`'${capability.replace('.', '\\.')}'`));
    assert.match(gates, new RegExp(`'${capability.replace('.', '\\.')}'`));
  }
  assert.match(dashboard, /label: '업무 배정'[\s\S]*task\.manage/);
  assert.match(dashboard, /label: '일정 관리'[\s\S]*schedule\.manage/);
  assert.match(dashboard, /label: '공지 관리'[\s\S]*notice\.manage/);
  assert.match(dashboard, /function masterMenuItems\(\)/);
  assert.doesNotMatch(migration, /payroll\.manage|payroll\.operator|payroll\.draft/i);
});

test('promotion lead management modules initialize through capability context and retain exact server RPC guards', () => {
  assert.match(app, /await resolveCapabilityContext\(\)/);
  assert.match(app, /window\.TaejangCapabilityAccess\.refresh\(\)/);
  assert.match(app, /taejang-capability-access-ready/);
  assert.match(capabilityAccess, /taejang-capability-access-ready/);
  assert.match(app, /\{ source: 'assets\/schedule-admin\.js', capability: 'schedule\.manage' \}/);
  assert.match(app, /\{ source: 'assets\/notice-admin\.js', capability: 'notice\.manage' \}/);
  assert.match(app, /if \(canManage\('task\.manage'\)\) await loadAdminData\(\)/);
  assert.match(app, /if \(!canManage\('task\.manage'\)\) return;/);
  assert.match(scheduleAdmin, /app\.can\?\.\('schedule\.manage'\)/);
  assert.match(scheduleAdmin, /bind\(\);\s*resetForm\(\);/);
  assert.match(scheduleAdmin, /list_manageable_schedules/);
  assert.match(scheduleAdmin, /save_schedule_item/);
  assert.match(noticeAdmin, /app\.can\?\.\('notice\.manage'\)/);
  assert.match(noticeAdmin, /bind\(\);\s*resetForm\(\);/);
  assert.match(noticeAdmin, /list_manageable_notices/);
  assert.match(noticeAdmin, /save_notice/);
  assert.match(workspace, /'today-admin-panel': 'task\.manage'/);
  assert.match(workspace, /'schedule-admin-panel': 'schedule\.manage'/);
  assert.match(workspace, /'notice-admin-panel': 'notice\.manage'/);
  for (const rpc of ['get_today_board_admin_options', 'list_manageable_today_records', 'save_daily_work_assignment', 'list_manageable_schedules', 'save_schedule_item', 'list_manageable_notices', 'save_notice']) {
    assert.match(migration, new RegExp(rpc));
  }
});

test('promotion lead never loads or opens guidance administration without guidance.manage', () => {
  assert.match(app, /\{ source: 'assets\/guidance-admin\.js', capability: 'guidance\.manage' \}/);
  assert.match(app, /\{ source: 'assets\/work-guide-admin\.js', capability: 'guidance\.manage' \}/);
  assert.match(workspace, /app\.can\?\.\('guidance\.manage'\)/);
  assert.match(guidanceAdmin, /app\.can\?\.\('guidance\.manage'\)/);
  assert.doesNotMatch(migration, /\('promotion_lead',\s*'guidance\.manage'\)/);
  for (const rpc of ['save_work_guide', 'save_work_guide_step', 'save_staff_guidance']) {
    assert.match(migration, new RegExp(`private_${rpc}_pre280`));
  }
});

test('operations manager retains the full management-capability path', () => {
  assert.match(migration, /public\.current_user_has_role\('operations_manager'\) then\s*return true/);
  assert.match(migration, /'company_allowed', public\.current_user_has_role\('operations_manager'\)/);
  assert.match(app, /return isTodayManager\(\);/);
});

test('promotion lead onboarding stays limited to general worker and promotion staff', () => {
  assert.match(onboarding, /role\.code in \('general_worker', 'promotion_staff'\)/);
  assert.match(onboarding, /can_assign_lead and role\.code = 'promotion_lead'/);
  assert.match(onboarding, /normalized_role = 'promotion_lead'[\s\S]{0,180}operations_manager/);
  assert.match(onboarding, /private_actor_can\('employee\.onboard'\)/);
});

test('attendance subject policy reads actual account roles and role preview discloses that boundary', () => {
  const policy = read('supabase/migrations/20260919123500_issue_249_attendance_lead_correction_policy.sql');
  assert.match(policy, /not employee_row\.attendance_required/);
  assert.match(policy, /in \('ceo', 'operations_manager'\)/);
  assert.match(policy, /from public\.account_person_links apl/);
  assert.match(policy, /join public\.profile_roles pr on pr\.profile_id = apl\.profile_id and pr\.revoked_at is null/);
  assert.match(simulation, /권한만 운영팀장으로 미리보기 중이며 근태 대상 여부는 실제 계정 기준입니다/);
  assert.doesNotMatch(policy, /private_effective_role_codes\(\)/);
});

test('attendance correction uses an accessible time dialog and explains server codes', () => {
  assert.match(correctionUi, /document\.createElement\('dialog'\)/);
  assert.match(correctionUi, /timeInput\.type = 'time'/);
  assert.match(correctionUi, /eventType === 'clock_in' \? '09:00' : '18:00'/);
  assert.match(correctionUi, /reasonInput\.minLength = 5/);
  assert.match(correctionUi, /cancel\.addEventListener\('click', \(\) => dialog\.close\('cancel'\)\)/);
  assert.match(correctionUi, /submit\.type = 'submit'/);
  assert.match(correctionUi, /append-only 보정 이력을 추가합니다/);
  assert.doesNotMatch(correctionUi, /window\.prompt/);
  for (const code of ['CORRECTED_TIME_REQUIRED', 'CORRECTED_TIME_DATE_MISMATCH', 'FUTURE_ATTENDANCE_TIME', 'REASON_REQUIRED', 'CLOCK_OUT_BEFORE_CLOCK_IN']) {
    assert.match(correctionUi, new RegExp(code));
  }
});

test('attendance roster remains visible when secondary RPCs are unavailable', () => {
  assert.match(attendance, /await Promise\.allSettled\(\[/);
  assert.match(attendance, /rosterResult\.status !== 'fulfilled'/);
  assert.match(attendance, /지문 근거자료 서버 동기화 필요/);
  assert.match(attendance, /syncRequiredPanel\('일일 근태 확정'\)/);
  assert.match(attendance, /직원 출근부는 계속 표시합니다/);
});

test('all payroll standalone pages prioritize localStorage and migrate legacy sessions without token URLs', () => {
  const pages = [
    'app/assets/payroll-operator-live.js',
    'app/assets/payroll-draft-handoff.js',
    'app/assets/payroll-payslip-draft.js',
    'app/assets/payroll-attendance-editor.js'
  ].map(read);
  for (const source of pages) {
    assert.match(source, /localStorage\.getItem\(SESSION_KEY\)/);
    assert.match(source, /sessionStorage\.getItem\(SESSION_KEY\)/);
    assert.match(source, /localStorage\.setItem\(SESSION_KEY,/);
    assert.match(source, /sessionStorage\.removeItem\(SESSION_KEY\)/);
    assert.match(source, /localStorage\.removeItem\(SESSION_KEY\)/);
  }
  for (const page of ['app/payroll/live.html', 'app/payroll/handoff.html', 'app/payroll/payslip.html']) {
    assert.doesNotMatch(read(page), /[?&](?:access_token|refresh_token)=/i);
  }
});

test('hosted-required attendance RPC contracts are represented by repository migrations', () => {
  const migrationSources = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter(file => file.endsWith('.sql'))
    .map(file => read(path.join('supabase', 'migrations', file)))
    .join('\n');
  for (const rpc of [
    'get_attendance_admin_today',
    'get_attendance_external_evidence',
    'get_attendance_confirmation_status',
    'get_attendance_workday_status',
    'get_attendance_holiday_work_assignments',
    'create_attendance_correction',
    'get_confirmed_attendance_period'
  ]) assert.match(migrationSources, new RegExp(rpc));
});
