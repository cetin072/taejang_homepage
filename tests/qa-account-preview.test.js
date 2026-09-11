const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const roleUi = fs.readFileSync(path.join(root, 'app', 'assets', 'phase-c-role-simulation.js'), 'utf8');
const previewPage = fs.readFileSync(path.join(root, 'app', 'qa-account-preview.html'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase', 'functions', 'qa-account-preview', 'index.ts'), 'utf8');
const supabaseConfig = fs.readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app', 'assets', 'app.js'), 'utf8');
const stagingDeploy = fs.readFileSync(path.join(root, '.github', 'workflows', 'qa-account-preview-staging-deploy.yml'), 'utf8');

test('operations QA switcher exposes real-account preview separately from role simulation', () => {
  assert.match(roleUi, /실제 계정 검수/);
  assert.match(roleUi, /qa-account-preview/);
  assert.match(roleUi, /action:\s*'list'/);
  assert.match(previewPage, /action:\s*'create'/);
  assert.match(roleUi, /새 탭/);
  assert.match(appSource, /getSession:\s*\(\)\s*=>\s*state\.session/);
  assert.match(roleUi, /TaejangCapabilityAccess\?\.refresh/);
  assert.match(roleUi, /X-QA-Context-Profile-ID/);
  assert.match(roleUi, /X-QA-Access-Profile-ID/);
  assert.match(roleUi, /X-QA-JWT-Subject/);
  assert.match(roleUi, /QA_IDENTITY_MISMATCH/);
  assert.match(roleUi, /역할만 바꾸며 실제 사용자 계정의 배정 데이터까지 바꾸지는 않습니다/);
});

test('QA preview page creates an isolated tab session and then loads the real app', () => {
  assert.match(previewPage, /taejang-staff-session-v1/);
  assert.match(previewPage, /sessionStorage\.setItem\(SESSION_KEY/);
  assert.doesNotMatch(previewPage, /localStorage/);
  assert.match(previewPage, /\/auth\/v1\/verify/);
  assert.match(previewPage, /token_hash/);
  assert.match(previewPage, /frame\.src = '\/app\/'/);
  assert.match(previewPage, /referrerpolicy="no-referrer"/);
  assert.match(previewPage, /sandbox="[^"]*allow-scripts/);
  assert.match(previewPage, /window\.addEventListener\('pagehide'/);
  assert.match(previewPage, /deploy-preview-/);
  assert.match(previewPage, /QA_STAGING_ONLY/);
  assert.match(previewPage, /Production에서는 사용하지 않습니다/);
});

test('mobile QA handoff finishes inside the newly opened preview tab without parent-tab create race', () => {
  assert.match(roleUi, /QA_HANDOFF_KEY/);
  assert.match(roleUi, /sessionStorage\.setItem\(QA_HANDOFF_KEY/);
  assert.match(roleUi, /qa-account-preview\.html#waiting=1/);
  assert.doesNotMatch(roleUi, /qaRequest\(\{\s*action:\s*'create'/);
  assert.match(previewPage, /QA_HANDOFF_KEY/);
  assert.match(previewPage, /sessionStorage\.getItem\(QA_HANDOFF_KEY/);
  assert.match(previewPage, /readOperatorSession/);
  assert.match(previewPage, /readSelectedTarget/);
  assert.match(previewPage, /createPreviewToken/);
  assert.match(previewPage, /action:\s*'create'/);
  assert.match(previewPage, /sessionStorage\.removeItem\(SESSION_KEY\)/);
  assert.match(previewPage, /showTargetSession/);
  assert.match(previewPage, /window\.opener = null/);
});

test('QA edge function is hard-locked to staging and requires the integrated top-authority account', () => {
  assert.match(edge, /qaEnvironment/);
  assert.match(edge, /QA_STAGING_ONLY/);
  assert.match(edge, /function isTopAuthority/);
  assert.match(edge, /codes\.has\('operations_manager'\)/);
  assert.match(edge, /codes\.has\('super_admin'\)/);
  assert.match(edge, /authorizeTopAuthority/);
  assert.match(edge, /admin\.auth\.getUser\(token\)/);
  assert.match(edge, /get_my_access_context_v2/);
  assert.match(edge, /accessContext\.actual_roles/);
  assert.match(edge, /generateLink/);
  assert.match(edge, /getUserById/);
  assert.match(edge, /type:\s*'magiclink'/);
  assert.doesNotMatch(edge, /password\s*:/i);
});

test('QA account listing reuses the capability-gated account management contract', () => {
  assert.match(edge, /get_operations_account_management/);
  assert.match(edge, /management\?\.profiles/);
  assert.match(edge, /management\?\.departments/);
  assert.match(edge, /management\?\.positions/);
  assert.match(edge, /management\?\.roles/);
  assert.doesNotMatch(edge, /admin\.auth\.admin\.listUsers/);
  assert.doesNotMatch(edge, /select\('id, display_name, account_status, department_id, position_id'\)/);
  assert.doesNotMatch(edge, /admin\s*\.from\('profiles'\)/);
  assert.doesNotMatch(edge, /role:roles!inner/);
  assert.doesNotMatch(edge, /department:departments/);
  assert.doesNotMatch(edge, /position:positions/);
});

test('QA edge function returns distinct safe authorization diagnostics', () => {
  for (const code of [
    'UNAUTHENTICATED',
    'QA_PROFILE_NOT_ACTIVE',
    'QA_TOP_AUTHORITY_REQUIRED',
    'QA_ROLE_LOOKUP_FAILED',
    'QA_ORIGIN_NOT_ALLOWED',
    'QA_STAGING_ONLY',
    'QA_IDENTITY_MISMATCH'
  ]) assert.match(edge, new RegExp(code));
  assert.doesNotMatch(edge, /QA_PREVIEW_FORBIDDEN/);
  assert.match(edge, /actor_profile_id/);
  assert.match(edge, /actual_role_codes/);
  assert.match(edge, /diagnostic_code:\s*safeDiagnosticCode/);
});

test('QA preview does not silently activate an unconfirmed login account', () => {
  assert.match(edge, /email_confirmed_at/);
  assert.match(edge, /TARGET_EMAIL_NOT_CONFIRMED/);
});

test('QA preview disables gateway JWT verification only because it performs explicit Auth verification inside the staging-only function', () => {
  assert.match(supabaseConfig, /\[functions\.qa-account-preview\][\s\S]*verify_jwt\s*=\s*false/);
  assert.match(edge, /admin\.auth\.getUser\(token\)/);
  assert.match(edge, /STAGING_ONLY/);
  assert.match(edge, /operations_manager/);
  assert.match(edge, /super_admin/);
});

test('QA function deployment is branch-locked to the fixed staging project after local Auth and RLS verification', () => {
  assert.match(stagingDeploy, /github\.head_ref == 'codex\/issue-167-support-radar-phase1-mvp'/);
  assert.match(stagingDeploy, /STAGING_PROJECT_REF: jgsxpdflgkqroecfjzxq/);
  assert.match(stagingDeploy, /node tests\/qa-account-preview-integration\.mjs/);
  assert.match(stagingDeploy, /functions deploy qa-account-preview/);
  assert.match(stagingDeploy, /--no-verify-jwt/);
  assert.doesNotMatch(stagingDeploy, /db push|migration up|seed|taejang-homepage\.netlify\.app/);
});
