const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const roleUi = fs.readFileSync(path.join(root, 'app', 'assets', 'phase-c-role-simulation.js'), 'utf8');
const previewPage = fs.readFileSync(path.join(root, 'app', 'qa-account-preview.html'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase', 'functions', 'qa-account-preview', 'index.ts'), 'utf8');

test('operations QA switcher exposes real-account preview separately from role simulation', () => {
  assert.match(roleUi, /실제 계정 검수/);
  assert.match(roleUi, /qa-account-preview/);
  assert.match(roleUi, /action:\s*'list'/);
  assert.match(roleUi, /action:\s*'create'/);
  assert.match(roleUi, /새 탭/);
  assert.match(roleUi, /역할만 바꾸며 실제 사용자 계정의 배정 데이터까지 바꾸지는 않습니다/);
});

test('QA preview page creates an isolated tab session and then loads the real app', () => {
  assert.match(previewPage, /taejang-staff-session-v1/);
  assert.match(previewPage, /sessionStorage\.setItem\(SESSION_KEY/);
  assert.doesNotMatch(previewPage, /localStorage/);
  assert.match(previewPage, /\/auth\/v1\/verify/);
  assert.match(previewPage, /token_hash/);
  assert.match(previewPage, /frame\.src = '\/app\/'/);
  assert.match(previewPage, /Production에서는 사용하지 않습니다/);
});

test('QA edge function is hard-locked to staging and requires actual top authority', () => {
  assert.match(edge, /jgsxpdflgkqroecfjzxq/);
  assert.match(edge, /STAGING_ONLY/);
  assert.match(edge, /operations_manager/);
  assert.match(edge, /super_admin/);
  assert.match(edge, /admin\.auth\.getUser\(token\)/);
  assert.match(edge, /profile_roles/);
  assert.match(edge, /generateLink/);
  assert.match(edge, /getUserById/);
  assert.match(edge, /type:\s*'magiclink'/);
  assert.doesNotMatch(edge, /password\s*:/i);
});
