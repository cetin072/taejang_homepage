const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'app', 'assets', 'support-radar-my-work.js'), 'utf8');
const assignmentUi = fs.readFileSync(path.join(root, 'app', 'assets', 'support-radar-assignment.js'), 'utf8');
const assignmentSql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260909234000_support_radar_assignment.sql'), 'utf8');
const mutationSql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260909214000_support_radar_phase1_mutations.sql'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'app', 'assets', 'app-ui.js'), 'utf8');

test('my support work UI is limited to roles eligible for assignment', () => {
  ['department_lead','promotion_lead','promotion_staff','worker_support_lead','worker_support_staff','office_staff']
    .forEach(role => {
      assert.match(ui, new RegExp(role));
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
});

test('operations view keeps full authority but hides detailed progress by default', () => {
  assert.match(assignmentUi, /supportOpsProgressSimplified/);
  assert.match(assignmentUi, /진행 현황/);
  assert.match(assignmentUi, /신청 진행 중/);
  assert.match(assignmentUi, /필요할 때 진행상태 직접 관리/);
  assert.match(assignmentUi, /option\[value="reviewing"\]/);
});

test('application status RPC recognizes active assignment authority', () => {
  assert.match(mutationSql, /support_assignments/);
  assert.match(mutationSql, /is_assignee/);
  assert.match(mutationSql, /authority.*assignee/s);
});

test('my-work module is loaded with the platform feature modules', () => {
  assert.match(loader, /support-radar-my-work\.js/);
});
