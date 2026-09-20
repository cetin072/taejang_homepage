const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const wrapperPath = path.join(root, 'prototypes/payroll-backend/edge-runtime/payroll-calculate/index.ts');
const depsPath = path.join(root, 'prototypes/payroll-backend/edge-runtime/payroll-calculate/runtime-deps.ts');
const deployedWrapperPath = path.join(root, 'supabase/functions/payroll-calculate/index.ts');
const deployedDepsPath = path.join(root, 'supabase/functions/payroll-calculate/runtime-deps.ts');
const receiptPath = path.join(root, 'prototypes/payroll-backend/STAGING_PAYROLL_PROMOTION_RECEIPT_20260911.md');
const wrapper = fs.readFileSync(wrapperPath, 'utf8');
const deps = fs.readFileSync(depsPath, 'utf8');
const deployedWrapper = fs.readFileSync(deployedWrapperPath, 'utf8');
const deployedDeps = fs.readFileSync(deployedDepsPath, 'utf8');

test('approved Staging promotion keeps the design candidate and records the deployable wrapper explicitly', () => {
  assert.match(wrapper, /DESIGN CANDIDATE ONLY \/ NOT DEPLOYED/i);
  assert.equal(
    fs.existsSync(deployedWrapperPath),
    true,
    'approved Staging promotion must keep its deployable Edge wrapper versioned in the repository'
  );
  assert.equal(
    fs.existsSync(receiptPath),
    true,
    'approved Staging deployment must have an explicit promotion receipt'
  );
  const receipt = fs.readFileSync(receiptPath, 'utf8');
  assert.match(receipt, /user-approved Staging-only payroll foundation work/i);
  assert.match(receipt, /does \*\*not\*\* authorize real August payroll data, Production, Ready\/merge, real month lock, payment/i);
});

test('runtime loader reuses existing tested payroll modules rather than copying payroll algorithms', () => {
  assert.match(deps, /app\/assets\/payroll-term-validator\.js/);
  assert.match(deps, /app\/assets\/payroll-preflight\.js/);
  assert.match(deps, /app\/assets\/payroll-engine\.js/);
  assert.match(deps, /app\/assets\/payroll-db-input-adapter\.js/);
  assert.match(deps, /payroll-calculate-core\.js/);
  assert.equal(deps.includes('../../../../../app/'), false, 'runtime loader must not walk above repository root');
  assert.doesNotMatch(wrapper, /function\s+calculateWeeklyHoliday|function\s+calculateProvisionalMonth/);
});

test('HTTP boundary requires exact configured origin, POST and bearer authorization', () => {
  assert.match(wrapper, /PAYROLL_ALLOWED_ORIGIN/);
  assert.match(wrapper, /origin === configuredOrigin/);
  assert.doesNotMatch(wrapper, /access-control-allow-origin['"]?\s*[:,]\s*['"]\*['"]/i);
  assert.match(wrapper, /req\.method !== 'POST'/);
  assert.match(wrapper, /authorization\.match\(\/\^Bearer\\s\+\(\.\+\)\$\/i\)/);
  assert.match(wrapper, /PAYROLL_AUTH_REQUIRED/);
  assert.match(wrapper, /MAX_REQUEST_BYTES = 32 \* 1024/);
  assert.match(deployedWrapper, /access-control-allow-headers': 'authorization, x-client-info, apikey, content-type'/);
  assert.match(deployedWrapper, /OFFICIAL_ALLOWED_ORIGINS/);
  assert.match(deployedWrapper, /https:\/\/taejang\.co\.kr/);
  assert.match(deployedWrapper, /https:\/\/www\.taejang\.co\.kr/);
  assert.match(deployedWrapper, /https:\/\/taejang-homepage\.netlify\.app/);
  assert.match(deployedWrapper, /https:\/\/main--taejang-homepage\.netlify\.app/);
  assert.match(deployedWrapper, /origin === configuredOrigin \|\| OFFICIAL_ALLOWED_ORIGINS\.has\(origin\)/);
});

test('user JWT validates identity and canonical input through guarded public RPC', () => {
  assert.match(wrapper, /userClient\.auth\.getUser\(token\)/);
  assert.match(wrapper, /userClient\.rpc\('get_payroll_calculation_input'/);
  assert.match(wrapper, /p_expected_batch_id: acceptedBatchId/);
  assert.doesNotMatch(wrapper, /actor[_-]?id\s*:\s*requestBody/i);
});

test('design internal client is limited to trusted persistence RPC and never performs payroll table CRUD', () => {
  assert.match(wrapper, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(wrapper, /internalClient\.rpc\('private_persist_payroll_calculation'/);
  assert.doesNotMatch(wrapper, /internalClient\.from\(/);
  assert.doesNotMatch(wrapper, /userClient\.from\(/);
  assert.doesNotMatch(wrapper, /\.insert\(|\.update\(|\.delete\(/);
});

test('deployed staging wrapper adds statutory input through one server-only RPC without table CRUD or browser input', () => {
  assert.match(deployedWrapper, /internalClient\.rpc\('private_get_payroll_statutory_input'/);
  assert.match(deployedWrapper, /internalClient\.rpc\('private_persist_payroll_calculation'/);
  assert.doesNotMatch(deployedWrapper, /internalClient\.from\(/);
  assert.doesNotMatch(deployedWrapper, /userClient\.from\(/);
  assert.match(deployedDeps, /runtime\/payroll-statutory-deductions\.js/);
  assert.match(deployedDeps, /PAYROLL_RUNTIME_SOURCE_COMMIT\s*=\s*'[0-9a-f]{40}'/);
  assert.doesNotMatch(deployedDeps, /https?:\/\//);
});

test('deployed staging runtime provenance includes the confirmed actual_worked adapter contract', () => {
  const pinned = deployedDeps.match(/PAYROLL_RUNTIME_SOURCE_COMMIT\s*=\s*'([0-9a-f]{40})'/)?.[1];
  assert.equal(pinned, '78f11ec235d3a4165f9558934305392d63a8aef6');
  const adapterPath = path.join(root, 'supabase/functions/payroll-calculate/runtime/payroll-db-input-adapter.js');
  assert.equal(fs.existsSync(adapterPath), true);
  const adapter = fs.readFileSync(adapterPath, 'utf8');
  assert.match(adapter, /case 'actual_worked':[\s\S]*case 'confirmed_correction':[\s\S]*return 'confirmed_correction'/);
});

test('deployed Edge runtime dependencies are fully bundled and require no startup network fetch', () => {
  const runtimeDir = path.join(root, 'supabase/functions/payroll-calculate/runtime');
  const required = [
    'payroll-term-validator.js',
    'payroll-preflight.js',
    'payroll-engine.js',
    'payroll-weekly-holiday-policy.js',
    'payroll-db-input-adapter.js',
    'payroll-statutory-deductions.js',
    'payroll-calculate-core.js',
  ];
  for (const filename of required) {
    assert.equal(fs.existsSync(path.join(runtimeDir, filename)), true, `${filename} must be bundled`);
  }
  assert.doesNotMatch(deployedDeps, /raw\.githubusercontent\.com|https?:\/\//);
});

test('service credential never enters response or operational log payload', () => {
  const responseLines = wrapper
    .split('\n')
    .filter((line) => line.includes('responseJson(') && !line.includes('function responseJson'));
  const logCalls = [...wrapper.matchAll(/safeOperationalLog\('[^']+'[\s\S]*?\n\s*\}\);/g)].map((m) => m[0]);
  assert.equal(logCalls.length, 2, 'only completed/failed operational log calls should be inspected');
  for (const text of [...responseLines, ...logCalls]) {
    assert.doesNotMatch(text, /internalServiceKey|SUPABASE_SERVICE_ROLE_KEY|publishableKey|Bearer \$\{token\}/);
  }
  assert.doesNotMatch(wrapper, /console\.(?:log|info|error)\([^\n]*(?:internalServiceKey|token|requestBody|employeeResults)/);
});

test('operational logs contain only safe run/count facts and no payroll amounts or employee payloads', () => {
  const completedStart = wrapper.indexOf("safeOperationalLog('payroll_calculate_completed'");
  const completedEnd = wrapper.indexOf('});', completedStart) + 3;
  const block = wrapper.slice(completedStart, completedEnd);
  assert.match(block, /correlation_id/);
  assert.match(block, /run_id/);
  assert.match(block, /employee_count/);
  assert.match(block, /unresolved_item_count/);
  assert.doesNotMatch(block, /gross|hourly|employeeResults|name|clock|bank/i);
});

test('safe error mapping prefers payroll business message over opaque PostgreSQL code', () => {
  const start = wrapper.indexOf('function safeErrorCode');
  const end = wrapper.indexOf('function statusForCode', start);
  const block = wrapper.slice(start, end);
  assert.ok(block.indexOf('SAFE_CODE.test(message)') < block.indexOf('SAFE_CODE.test(code)'));
  assert.match(wrapper, /FORBIDDEN\|ACCESS\|ACTOR_FORBIDDEN/);
  assert.match(wrapper, /STALE\|LOCKED\|IDEMPOTENCY_CONFLICT/);
});

test('wrapper explicitly documents missing internal EXECUTE grant as deployment blocker', () => {
  assert.match(wrapper, /service_role EXECUTE grant is intentionally absent/i);
  assert.match(wrapper, /separate staging approval\/review gate/i);
});
