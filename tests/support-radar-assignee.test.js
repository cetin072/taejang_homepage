const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'app', 'assets', 'support-radar-my-work.js'), 'utf8');
const assignmentUi = fs.readFileSync(path.join(root, 'app', 'assets', 'support-radar-assignment.js'), 'utf8');
const opsRefreshUi = fs.readFileSync(path.join(root, 'app', 'assets', 'support-radar-ops-progress-refresh.js'), 'utf8');
const resultUi = fs.readFileSync(path.join(root, 'app', 'assets', 'support-radar-result-record.js'), 'utf8');
const assignmentSql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260909234000_support_radar_assignment.sql'), 'utf8');
const mutationSql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260909214000_support_radar_phase1_mutations.sql'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'app', 'assets', 'app-ui.js'), 'utf8');
const accessUi = fs.readFileSync(path.join(root, 'app', 'assets', 'support-radar-access.js'), 'utf8');
const capabilitySql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260911150000_support_radar_capability_contract.sql'), 'utf8');

test('my support work UI is limited to roles eligible for assignment', () => {
  ['department_lead','promotion_lead','promotion_staff','worker_support_lead','worker_support_staff','office_staff']
    .forEach(role => {
      assert.match(accessUi, new RegExp(role));
      assert.match(capabilitySql, new RegExp(role));
      assert.match(assignmentSql, new RegExp(role));
    });
  assert.doesNotMatch(ui, /general_worker/);
});

test('assignee UI uses scoped notice queries and progress mutation only', () => {
  assert.match(ui, /support_list_notices/);
  assert.match(ui, /support_get_notice_detail/);
  assert.match(ui, /support_update_application_status/);
  assert.doesNotMatch(ui, /support_set_decision/);
  assert.doesNotMatch(ui, /support_evaluate_notice_v1/);
  assert.doesNotMatch(ui, /support_save_company_profile/);
});

test('assignment panel appears only after apply and avoids observer self-loops', () => {
  assert.match(assignmentUi, /if\(decision!==['"]apply['"]\) return/);
  assert.match(assignmentUi, /state\.injecting/);
  assert.match(assignmentUi, /note && note\.textContent !== desired/);
  assert.match(assignmentUi, /liveRoot!==root/);
  assert.match(assignmentUi, /taejang-support-radar-rendered/);
  assert.doesNotMatch(assignmentUi, /MutationObserver/);
});

test('operations view keeps full authority but hides detailed progress by default', () => {
  assert.match(assignmentUi, /supportOpsProgressSimplified/);
  assert.match(assignmentUi, /진행 현황/);
  assert.match(assignmentUi, /신청 진행 중/);
  assert.match(assignmentUi, /필요할 때 진행상태 직접 관리/);
  assert.match(assignmentUi, /option\[value="reviewing"\]/);
});

test('operations view can re-read assignee progress after another tab saves it', () => {
  assert.match(opsRefreshUi, /담당자 진행 현황/);
  assert.match(opsRefreshUi, /최신 상태 확인/);
  assert.match(opsRefreshUi, /data\.application\.updated_at/);
  assert.match(opsRefreshUi, /data\.application\.next_action/);
  assert.match(opsRefreshUi, /visibilitychange/);
  assert.match(opsRefreshUi, /TaejangSupportRadarNotices\?\.renderDetail\?\.\(noticeId\)/);
  assert.doesNotMatch(opsRefreshUi, /support_update_application_status/);
});

test('operations can record final result and realized support through the existing application RPC', () => {
  assert.match(resultUi, /결과·수혜이력/);
  assert.match(resultUi, /canManagementEdit/);
  assert.match(resultUi, /support_update_application_status/);
  assert.match(resultUi, /p_result_summary/);
  assert.match(resultUi, /p_actual_cash_benefit/);
  assert.match(resultUi, /p_actual_in_kind_value/);
  ['selected', 'not_selected', 'cancelled'].forEach(status => assert.match(resultUi, new RegExp(status)));
  assert.match(mutationSql, /p_result_summary/);
  assert.match(mutationSql, /p_actual_cash_benefit/);
  assert.match(mutationSql, /p_actual_in_kind_value/);
});

test('assigned employee view removes stale assignment wording from next action', () => {
  assert.match(ui, /employeeNextAction/);
  assert.match(ui, /담당자 지정 및 신청요건 재확인/);
  assert.match(ui, /신청요건 재확인/);
  assert.match(ui, /p_next_action:normalizedNextAction\|\|null/);
});

test('application status RPC recognizes active assignment authority', () => {
  assert.match(mutationSql, /support_assignments/);
  assert.match(mutationSql, /is_assignee/);
  assert.match(mutationSql, /authority.*assignee/s);
});

test('support radar assignee and result modules are loaded with the platform feature modules', () => {
  assert.match(loader, /support-radar-my-work\.js/);
  assert.match(loader, /support-radar-ops-progress-refresh\.js/);
  assert.match(loader, /support-radar-result-record\.js/);
});
