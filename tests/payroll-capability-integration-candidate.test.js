const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const candidate = fs.readFileSync(
  path.join(root, 'prototypes/payroll-backend/payroll_capability_candidate.sql'),
  'utf8'
);
const executableSql = candidate
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

test('payroll capability candidate remains rollback-only and outside executable migrations', () => {
  assert.match(candidate, /Status: CANDIDATE ONLY\. ROLLBACK-ONLY/i);
  assert.match(candidate.trim(), /rollback;$/i);
  assert.equal(
    fs.existsSync(path.join(root, 'supabase/migrations/payroll_capability_candidate.sql')),
    false
  );
});

test('approved payroll audience is represented by one operational operations-manager auto-grant capability', () => {
  assert.match(candidate, /'payroll\.manage'/i);
  assert.match(candidate, /'operational'/i);
  assert.match(candidate, /operations_manager_auto_grant[\s\S]*true/i);
  assert.doesNotMatch(executableSql, /insert into public\.role_capability_grants/i);
  assert.match(candidate, /PAYROLL_CAPABILITY_GRANT_CONFLICT/i);
});

test('public payroll authorization routes through the current-main capability source of truth', () => {
  assert.match(candidate, /create or replace function public\.private_payroll_operator_allowed\(\)/i);
  assert.match(candidate, /current_profile_is_active\(\)/i);
  assert.match(candidate, /private_actor_can\('payroll\.manage'\)/i);
  assert.doesNotMatch(executableSql, /current_user_has_role\('super_admin'\)/i);
  assert.doesNotMatch(executableSql, /current_user_has_role\('ceo'\)/i);
});

test('trusted service persistence rechecks original actor and respects lower-role simulation', () => {
  assert.match(candidate, /private_payroll_actor_allowed\(p_actor_id uuid\)/i);
  assert.match(candidate, /p\.account_status = 'active'/i);
  assert.match(candidate, /r\.code = 'operations_manager'/i);
  assert.match(candidate, /from public\.role_simulation_modes s/i);
  assert.match(candidate, /s\.expires_at > now\(\)/i);
  assert.match(candidate, /s\.role_code <> 'operations_manager'/i);
  assert.match(candidate, /c\.code = 'payroll\.manage'/i);
  assert.match(candidate, /c\.operations_manager_auto_grant/i);
});

test('candidate never grants browser table access or technical-super-admin payroll bypass', () => {
  assert.doesNotMatch(executableSql, /grant\s+(?:select|insert|update|delete)\s+on/i);
  assert.doesNotMatch(executableSql, /\bsuper_admin\b/i);
  assert.doesNotMatch(executableSql, /\bceo\b/i);
  assert.doesNotMatch(executableSql, /create\s+role\s+payroll_operator/i);
});
