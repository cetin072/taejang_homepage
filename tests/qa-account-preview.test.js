const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const roleUi = fs.readFileSync(path.join(root, 'app', 'assets', 'phase-c-role-simulation.js'), 'utf8');
const refinementsCss = fs.readFileSync(path.join(root, 'app', 'assets', 'phase-c-ui-refinements.css'), 'utf8');
const previewPage = fs.readFileSync(path.join(root, 'app', 'qa-account-preview.html'), 'utf8');
const capabilityAccess = fs.readFileSync(path.join(root, 'app', 'assets', 'capability-access.js'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase', 'functions', 'qa-account-preview', 'index.ts'), 'utf8');
const supabaseConfig = fs.readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app', 'assets', 'app.js'), 'utf8');
const stagingDeploy = fs.readFileSync(path.join(root, '.github', 'workflows', 'qa-account-preview-staging-deploy.yml'), 'utf8');

test('employee screen experience unifies real accounts and role presets behind one launcher', () => {
  assert.match(roleUi, /직원 화면 체험/);
  assert.match(roleUi, /👤 내 계정 ▾/);
  assert.match(roleUi, /으로 보는 중 ▾/);
  assert.match(roleUi, /체험 가능한 직원/);
  assert.match(roleUi, /역할 미리보기/);
  assert.match(roleUi, /실제 로그인 가능한 직원은 그 직원이 실제로 보는 화면/);
  assert.match(roleUi, /data\.personaLauncher/);
  assert.match(roleUi, /data\.personaKind/);
  assert.doesNotMatch(roleUi, /홍보직원 보기|운영팀장 보기|운영총괄 복귀|실제 계정 검수|권한 체험 중/);
});

test('effective persona route follows effective roles while preserving the actual login route', () => {
  assert.match(capabilityAccess, /app\.getActualRoute/);
  assert.match(capabilityAccess, /app\.getEffectiveRoles/);
  assert.match(capabilityAccess, /TaejangAuthRouting\?\.resolveRoleRoute/);
  assert.match(capabilityAccess, /app\.getEffectiveRoute\s*=\s*\(\)\s*=>\s*effectiveRoute\(app\)/);
  assert.match(capabilityAccess, /app\.getRoute\s*=\s*\(\)\s*=>\s*effectiveRoute\(app\)/);
  assert.match(capabilityAccess, /app\.getPersona/);
  assert.match(capabilityAccess, /kind:\s*accessContext\?\.role_simulation\?\.active\s*\?\s*'role_preset'\s*:\s*'account'/);
  assert.match(appSource, /getRoute:\s*\(\)\s*=>\s*state\.route\?\.code/);
});

test('actual employee account is preferred and role preset is only fallback when that role has no account', () => {
  assert.match(roleUi, /const PRESET_ROLES = \['promotion_staff', 'promotion_lead'\]/);
  assert.match(roleUi, /actualRoleCodes\s*=\s*new Set/);
  assert.match(roleUi, /PRESET_ROLES\.filter\(roleCode => !actualRoleCodes\.has\(roleCode\)\)/);
  assert.match(roleUi, /employeeGroup\.label = '체험 가능한 직원'/);
  assert.match(roleUi, /presetGroup\.label = '역할 미리보기'/);
});

test('role preset banner is plain-language and offers a direct return to my account', () => {
  assert.match(roleUi, /역할 미리보기 중/);
  assert.match(roleUi, /실제 직원 계정이 아닌 테스트용 역할 화면입니다/);
  assert.match(roleUi, /내 계정으로 돌아가기/);
  assert.match(roleUi, /data\.personaReturn/);
});

test('mobile employee screen experience stays visible with one large touch target', () => {
  assert.match(refinementsCss, /@media \(max-width: 900px\)[\s\S]*\.role-simulation-switcher/);
  assert.match(refinementsCss, /\.role-simulation-switcher \.button[\s\S]*min-height:\s*56px\s*!important/);
  assert.match(refinementsCss, /safe-area-inset-bottom/);
  assert.match(refinementsCss, /background:\s*#236d4b\s*!important/);
  assert.match(refinementsCss, /\.qa-account-dialog__actions[\s\S]*grid-template-columns:\s*1fr\s*!important/);
  assert.match(refinementsCss, /\[data-persona-open\]\s*\{\s*order:\s*-1;/);
  assert.doesNotMatch(refinementsCss, /content:\s*'계정 전환'/);
});

test('employee experience tab keeps return controls in the persistent top bar without developer jargon', () => {
  assert.match(previewPage, /직원 화면 체험 준비 중/);
  assert.match(previewPage, /내 계정으로 돌아가기/);
  assert.match(previewPage, /선택한 직원이 실제로 보는 화면과 권한 범위로 동작합니다/);
  assert.match(previewPage, /@media \(max-width: 720px\)[\s\S]*\.qa-actions\s*\{[\s\S]*width:\s*100%/);
  assert.match(previewPage, /\.qa-actions button\s*\{[\s\S]*min-height:\s*52px/);
  assert.match(previewPage, /#qa-close\s*\{[\s\S]*background:\s*#174f38/);
  assert.doesNotMatch(previewPage, /실제 계정 검수|운영총괄로 돌아가기|실제 Auth 세션|실제 RLS/);
});

test('employee preview page creates an isolated tab session and then loads the real app', () => {
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
});

test('successful employee preview always removes the loading overlay on mobile', () => {
  assert.match(previewPage, /\.qa-state\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(previewPage, /state\.hidden\s*=\s*true;/);
  assert.match(previewPage, /state\.style\.display\s*=\s*'none';/);
  assert.match(previewPage, /state\.hidden\s*=\s*false;/);
  assert.match(previewPage, /state\.style\.display\s*=\s*'grid';/);
});

test('employee preview handoff remains isolated and does not replace the operator browser session', () => {
  assert.match(roleUi, /QA_HANDOFF_KEY/);
  assert.match(roleUi, /sessionStorage\.setItem\(QA_HANDOFF_KEY/);
  assert.match(roleUi, /window\.open\('about:blank', '_blank'\)/);
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

test('switching from a role preset to a real employee clears the preset before target session creation', () => {
  const handoff = roleUi.indexOf('sessionStorage.setItem(QA_HANDOFF_KEY');
  const blankTab = roleUi.indexOf("window.open('about:blank', '_blank')");
  const clearPreset = roleUi.indexOf("app().rpc('set_role_simulation_mode', { p_role_code: null })", blankTab);
  const navigate = roleUi.indexOf("previewTab.location.replace('/app/qa-account-preview.html#waiting=1')", clearPreset);
  assert.ok(handoff >= 0 && blankTab > handoff);
  assert.ok(clearPreset > blankTab);
  assert.ok(navigate > clearPreset);
  assert.match(roleUi, /TaejangCapabilityAccess\?\.refresh/);
});

test('actual account list is cached briefly so switching among personas stays usable after preset reload', () => {
  assert.match(roleUi, /QA_ACCOUNT_CACHE_KEY/);
  assert.match(roleUi, /QA_ACCOUNT_CACHE_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(roleUi, /sessionStorage\.setItem\(QA_ACCOUNT_CACHE_KEY/);
  assert.match(roleUi, /preloadQaAccounts/);
  assert.match(roleUi, /if \(!currentSimulation\.active\) preloadQaAccounts\(\)/);
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
