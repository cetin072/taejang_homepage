const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const ui = require('../app/assets/staff-information-ui.js');

test('schedule grouping prioritizes today, tomorrow, week, and later', () => {
  assert.equal(ui.scheduleGroup('2026-07-23T09:00:00+09:00', '2026-07-23'), 'today');
  assert.equal(ui.scheduleGroup('2026-07-24T09:00:00+09:00', '2026-07-23'), 'tomorrow');
  assert.equal(ui.scheduleGroup('2026-07-27T09:00:00+09:00', '2026-07-23'), 'week');
  assert.equal(ui.scheduleGroup('2026-08-03T09:00:00+09:00', '2026-07-23'), 'later');
});

test('date and time formatting includes Korean date words', () => {
  const label = ui.formatDateTime('2026-07-23T09:30:00+09:00');
  assert.match(label, /7월/);
  assert.match(label, /23일/);
  assert.match(label, /09:30/);
});

test('only HTTPS links without embedded credentials pass client validation', () => {
  assert.equal(ui.safeHttpsUrl('https://example.test/path').protocol, 'https:');
  assert.equal(ui.safeHttpsUrl('http://example.test/path'), null);
  assert.equal(ui.safeHttpsUrl('javascript:alert(1)'), null);
  assert.equal(ui.safeHttpsUrl('data:text/html,test'), null);
  assert.equal(ui.safeHttpsUrl('https://user:pass@example.test/private'), null);
});

test('worker navigation and detail screens are present', () => {
  const html = read('app/index.html');
  for (const id of [
    'open-schedule-list', 'open-notice-list', 'schedule-screen', 'schedule-list-view',
    'schedule-detail-view', 'notice-screen', 'notice-list-view', 'notice-detail-view',
    'notice-ack-slot'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /예정된 일정이 없습니다|가까운 일정/);
  assert.match(html, /내용 확인 필요/);
});

test('schedule, notice, acknowledgement, admin, and common concerns are separate modules', () => {
  const html = read('app/index.html');
  for (const file of [
    'staff-information-ui.js', 'staff-information-today.js', 'schedule-worker.js',
    'notice-worker.js', 'notice-acknowledgement.js', 'schedule-admin.js', 'notice-admin.js'
  ]) {
    assert.match(html, new RegExp(`assets/${file}`));
    assert.ok(fs.existsSync(path.join(root, 'app/assets', file)));
  }
  const app = read('app/assets/app.js');
  assert.doesNotMatch(app, /save_schedule_item|save_notice|acknowledge_notice/);
});

test('external links use safe new-window attributes and avoid HTML string insertion', () => {
  const noticeWorker = read('app/assets/notice-worker.js');
  assert.match(noticeWorker, /target = '_blank'/);
  assert.match(noticeWorker, /rel = 'noopener noreferrer'/);
  assert.match(noticeWorker, /실제 주소:/);
  for (const file of [
    'staff-information-ui.js', 'staff-information-today.js', 'schedule-worker.js',
    'notice-worker.js', 'notice-acknowledgement.js', 'schedule-admin.js', 'notice-admin.js'
  ]) {
    assert.doesNotMatch(read(`app/assets/${file}`), /\.innerHTML\s*=/);
  }
});

test('migration defines canonical tables, target scopes, versioned acknowledgement, and safe RPCs', () => {
  const sql = read('supabase/migrations/20260723000400_staff_schedules_and_notices.sql');
  assert.match(sql, /create table public\.schedule_items/);
  assert.match(sql, /create table public\.notices/);
  assert.match(sql, /create table public\.notice_acknowledgements/);
  assert.match(sql, /primary key \(notice_id, notice_version, profile_id\)/);
  assert.match(sql, /public\.private_validate_today_target/);
  assert.match(sql, /public\.current_user_can_manage_today_target/);
  assert.match(sql, /public\.is_safe_https_url/);
  assert.match(sql, /not requires_acknowledgement or importance in \('important', 'urgent'\)/);
  assert.match(sql, /create or replace function public\.acknowledge_notice/);
  assert.match(sql, /create or replace function public\.get_my_today_board/);
  assert.match(sql, /'source', 'schedule'/);
  assert.match(sql, /'source', 'notice'/);
});

test('browser assets do not contain service-role keys or secret values', () => {
  const files = [
    'app/index.html', 'app/assets/app.js', 'app/assets/staff-information-ui.js',
    'app/assets/staff-information-today.js', 'app/assets/schedule-worker.js',
    'app/assets/notice-worker.js', 'app/assets/notice-acknowledgement.js',
    'app/assets/schedule-admin.js', 'app/assets/notice-admin.js'
  ];
  const source = files.map(read).join('\n');
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service_role|sb_secret_/i);
  assert.doesNotMatch(source, /eyJ[a-zA-Z0-9_-]{40,}/);
});

test('CI includes pgTAP and the new real Auth/Data API integration', () => {
  const workflow = read('.github/workflows/phase1a-supabase-integration.yml');
  assert.match(workflow, /supabase db reset/);
  assert.match(workflow, /supabase db lint --level error/);
  assert.match(workflow, /supabase test db supabase\/tests\/database\/\*\.test\.sql/);
  assert.match(workflow, /staff-schedules-notices-auth-integration\.mjs/);
});
