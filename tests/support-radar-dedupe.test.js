const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260910082000_support_radar_cross_source_dedupe.sql'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'app', 'assets', 'support-radar-dedupe.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'app', 'assets', 'app-ui.js'), 'utf8');

test('cross-source dedupe is suggestion-only and never auto-merges canonical notices', () => {
  assert.match(sql, /support_find_duplicate_candidates/);
  assert.match(sql, /support_normalize_notice_title/);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.support_notices/i);
  assert.doesNotMatch(sql, /update\s+public\.support_notices\s+set/i);
  assert.match(sql, /Conservative cross-source duplicate suggestion/);
});

test('existing notice can receive a new source occurrence through a guarded audited RPC', () => {
  assert.match(sql, /support_attach_notice_occurrence/);
  assert.match(sql, /current_user_has_role\('operations_manager'\)/);
  assert.match(sql, /support_occurrence_attached/);
  assert.match(sql, /private_append_audit/);
});

test('separate registration can retain duplicate-candidate trace', () => {
  assert.match(sql, /support_mark_occurrence_duplicate_candidate/);
  assert.match(sql, /duplicate_candidate=true/);
  assert.match(ui, /support_mark_occurrence_duplicate_candidate/);
});

test('operator chooses attach or separate registration explicitly', () => {
  assert.match(ui, /window\.confirm/);
  assert.match(ui, /기존 공고에 새 출처만 연결/);
  assert.match(ui, /별도 공고로 등록하고 중복후보 표시/);
  assert.match(ui, /support_attach_notice_occurrence/);
  assert.match(ui, /support_create_notice/);
});

test('dedupe module is part of the app feature loader', () => {
  assert.match(loader, /support-radar-dedupe\.js/);
});
