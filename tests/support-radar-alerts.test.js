const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260910074000_support_radar_alert_candidates.sql'), 'utf8');
const querySql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260910081000_support_radar_alert_flag_query.sql'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'app', 'assets', 'support-radar-alerts.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'app', 'assets', 'app-ui.js'), 'utf8');

test('alert candidate query includes all Phase 1 trigger classes', () => {
  ['score_85','amount_5m','in_kind_vehicle_facility_equipment','priority_domain','deadline_7','rare_national','manual_priority']
    .forEach(trigger => assert.match(sql, new RegExp(trigger)));
});

test('alert candidates are relevance filtered instead of trigger-only', () => {
  assert.match(sql, /e\.hard_gate <> 'fail'/);
  assert.match(sql, /e\.recommended_application_mode <> 'none'/);
  assert.match(sql, /strategic_fit_score>=6/);
  assert.match(sql, /overall_score>=85/);
});

test('priority flags are guarded and audited', () => {
  assert.match(sql, /current_user_has_role\('operations_manager'\)/);
  assert.match(sql, /private_append_audit/);
  assert.match(sql, /revoke all on public\.support_notice_priority_flags from anon, authenticated/);
  assert.match(querySql, /support_can_view_notice\(p_notice_id\)/);
});

test('alert UI is in-app only and explains trigger reasons', () => {
  assert.match(ui, /긴급 확인/);
  assert.match(ui, /적합도 85점 이상/);
  assert.match(ui, /지원규모 500만원 이상/);
  assert.match(ui, /희소 전국공모/);
  assert.doesNotMatch(ui, /kakao|sendmail|smtp|fetch\(['"]https?:\/\//i);
});

test('assignment and alert modules are both loaded by the app feature loader', () => {
  assert.match(loader, /support-radar-assignment\.js/);
  assert.match(loader, /support-radar-alerts\.js/);
});
