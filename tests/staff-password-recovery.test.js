'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function syntax(file) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('staff login exposes a separate password recovery action without changing signup inputs', () => {
  const html = read('staff/index.html');
  assert.match(html, /id="show-recovery"/);
  assert.match(html, /id="recovery-panel"/);
  assert.match(html, /id="recovery-form"/);
  assert.match(html, /비밀번호를 잊으셨나요\?/);
  assert.doesNotMatch(html, /name="requested_role_code"/);
});

test('password recovery request uses Supabase recovery endpoint and avoids user enumeration copy', () => {
  syntax('staff/assets/password-recovery.js');
  const source = read('staff/assets/password-recovery.js');
  assert.match(source, /\/auth\/v1\/recover\?redirect_to=/);
  assert.match(source, /reset-password\.html/);
  assert.match(source, /등록된 계정이면 비밀번호 재설정 메일이 발송됩니다/);
  assert.doesNotMatch(source, /user not found|가입되지 않은 이메일/i);
});

test('recovery completion validates the recovery token and updates the password without persisting the token', () => {
  syntax('staff/assets/reset-password.js');
  const html = read('staff/reset-password.html');
  const source = read('staff/assets/reset-password.js');
  assert.match(html, /id="reset-password-form"/);
  assert.match(source, /params\.get\('type'\)/);
  assert.match(source, /type !== 'recovery'/);
  assert.match(source, /\/auth\/v1\/user/);
  assert.match(source, /method: 'PUT'/);
  assert.match(source, /Authorization: `Bearer \$\{recoveryToken\}`/);
  assert.match(source, /history\.replaceState/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test('signup approval source keeps operations manager as the sole approval authority', () => {
  const migration = read('supabase/migrations/20260903210000_phase_c_signup_approval_chain.sql');
  const ui = read('app/assets/phase-c-account-approval.js');
  assert.match(migration, /current_user_has_role\('operations_manager'\)/);
  assert.match(migration, /technical super_admin role does not independently grant signup approval/i);
  assert.doesNotMatch(migration, /current_user_has_role\('promotion_lead'\)/);
  assert.match(ui, /route\(\) !== 'operations_manager'/);
  assert.match(ui, /운영총괄 고유 권한/);
  assert.match(ui, /권한 선택/);
});
