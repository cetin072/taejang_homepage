const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260910083000_support_radar_review_tracking.sql'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'app', 'assets', 'support-radar-review.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'app', 'assets', 'app-ui.js'), 'utf8');
const access = fs.readFileSync(path.join(root, 'app', 'assets', 'support-radar-access.js'), 'utf8');
const capabilitySql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260911150000_support_radar_capability_contract.sql'), 'utf8');

test('human review is stored separately from evaluation and final decision', () => {
  assert.match(sql, /create table public\.support_notice_reviews/);
  assert.match(sql, /support_mark_notice_reviewed/);
  assert.match(sql, /reviewed_at timestamptz/);
  assert.doesNotMatch(sql, /update\s+public\.support_evaluations/i);
  assert.doesNotMatch(sql, /update\s+public\.support_decisions/i);
});

test('review mutation is limited to operations manager or active assignee', () => {
  assert.match(sql, /current_user_has_role\('operations_manager'\)/);
  assert.match(sql, /support_assignments/);
  assert.match(sql, /unassigned_at is null/);
  assert.match(sql, /private_append_audit/);
});

test('review metrics expose discovery-to-first-review KPI', () => {
  assert.match(sql, /average_hours_discovery_to_first_review/);
  assert.match(sql, /first_discovered_at/);
  assert.match(sql, /min\(reviewed_at\)/);
});

test('CEO can read review history but cannot mark review complete from UI', () => {
  assert.match(access, /legacyManagementView = new Set\(\['operations_manager', 'ceo'\]\)/);
  assert.match(capabilitySql, /\('ceo', 'support_radar\.management_view'\)/);
  assert.doesNotMatch(capabilitySql, /\('ceo', 'support_radar\.management_edit'\)/);
  assert.match(ui, /canReview/);
  assert.match(ui, /검토 완료 표시/);
});

test('review module is loaded by the app feature loader', () => {
  assert.match(loader, /support-radar-review\.js/);
});
