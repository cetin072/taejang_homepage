const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('frequent staff guidance is a separate worker screen with accessible filters', () => {
  const html = read('app/index.html');
  for (const id of ['open-guidance-list', 'guidance-screen', 'guidance-list-view', 'guidance-detail-view', 'guidance-search', 'guidance-filters']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /회사생활 중 자주 확인하는 내용을 모았습니다/);
  assert.match(html, /자주 보는 안내 등록·수정/);
});

test('guidance code remains modular and does not add writes to app.js', () => {
  const app = read('app/assets/app.js');
  assert.match(app, /loadScript\('assets\/guidance-admin\.js'\)/);
  assert.doesNotMatch(app, /save_staff_guidance/);
  for (const file of ['guidance-worker.js', 'guidance-admin.js']) assert.ok(fs.existsSync(path.join(root, 'app/assets', file)));
});

test('worker guidance uses DOM nodes and safe external links', () => {
  const worker = read('app/assets/guidance-worker.js');
  assert.match(worker, /aria-pressed/);
  assert.match(worker, /target='_blank'/);
  assert.match(worker, /rel='noopener noreferrer'/);
  assert.match(worker, /실제 주소:/);
  assert.doesNotMatch(worker, /\.innerHTML\s*=/);
});

test('guidance migration separates long-lived guidance from notices and uses guarded RPCs', () => {
  const sql = read('supabase/migrations/20260724000100_frequent_staff_guidance.sql');
  assert.match(sql, /create table public\.staff_guidance_items/);
  assert.match(sql, /create type public\.staff_guidance_category/);
  assert.match(sql, /create or replace function public\.get_my_staff_guidance_list/);
  assert.match(sql, /create or replace function public\.get_my_staff_guidance_detail/);
  assert.match(sql, /create or replace function public\.list_manageable_staff_guidance/);
  assert.match(sql, /create or replace function public\.save_staff_guidance/);
  assert.match(sql, /public\.current_user_can_manage_today_target/);
  assert.match(sql, /public\.is_safe_https_url/);
  assert.match(sql, /alter table public\.staff_guidance_items enable row level security/);
  assert.match(sql, /revoke all on table public\.staff_guidance_items/);
  assert.match(read('.github/workflows/phase1a-supabase-integration.yml'), /frequent-staff-guidance-auth-integration\.mjs/);
});

test('guidance assets contain neither service role keys nor secrets', () => {
  const source = ['app/index.html', 'app/assets/guidance-worker.js', 'app/assets/guidance-admin.js', 'supabase/migrations/20260724000100_frequent_staff_guidance.sql'].map(read).join('\n');
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service_role|sb_secret_/i);
  assert.doesNotMatch(source, /eyJ[a-zA-Z0-9_-]{40,}/);
});
