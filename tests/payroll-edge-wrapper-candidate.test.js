const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const wrapperPath = path.join(root, 'prototypes/payroll-backend/edge-runtime/payroll-calculate/index.ts');
const depsPath = path.join(root, 'prototypes/payroll-backend/edge-runtime/payroll-calculate/runtime-deps.ts');
const deployedWrapperPath = path.join(root, 'supabase/functions/payroll-calculate/index.ts');
const receiptPath = path.join(root, 'prototypes/payroll-backend/STAGING_PAYROLL_PROMOTION_RECEIPT_20260911.md');
const wrapper = fs.readFileSync(wrapperPath, 'utf8');
const deps = fs.readFileSync(depsPath, 'utf8');

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
});

test('user JWT validates identity and canonical input through guarded public RPC', () => {
  assert.match(wrapper, /userClient\.auth\.getUser\(token\)/);
  assert.match(wrapper, /userClient\.rpc\('get_payroll_calculation_input'/);
  assert.match(wrapper, /p_expected_batch_id: acceptedBatchId/);
  assert.doesNotMatch(wrapper, /actor[_-]?id\s*:\s*requestBody/i);
});

test('internal client is limited to trusted persistence RPC and never performs payroll table CRUD', () => {
  assert.match(wrapper, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(wrapper, /internalClient\.rpc\('private_persist_payroll_calculation'/);
  assert.doesNotMatch(wrapper, /internalClient\.from\(/);
  assert.doesNotMatch(wrapper, /userClient\.from\(/);
  assert.doesNotMatch(wrapper, /\.insert\(|\.update\(|\.delete\(/);
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
