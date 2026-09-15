const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const contract = fs.readFileSync(
  path.join(root, 'prototypes/payroll-backend/TRUSTED_CALCULATION_RUNTIME_CONTRACT.md'),
  'utf8'
);

test('trusted runtime contract is design-only and selects authenticated Edge Function candidate', () => {
  assert.match(contract, /DESIGN CANDIDATE ONLY \/ NOT DEPLOYED/i);
  assert.match(contract, /Supabase Edge Function/i);
  assert.match(contract, /`payroll-calculate`/i);
  assert.match(contract, /verify_jwt = true/i);
  assert.match(contract, /Deployment remains a separate approval gate/i);
});

test('browser cannot authoritatively submit payroll results or totals', () => {
  assert.match(contract, /browser must \*\*not\*\* be allowed to submit authoritative calculation results/i);
  assert.match(contract, /employee payroll result rows/i);
  assert.match(contract, /gross payroll totals/i);
  assert.match(contract, /weekly-holiday totals/i);
  assert.match(contract, /final lock state/i);
});

test('runtime preserves active operations-manager-only authorization', () => {
  assert.match(contract, /active profile AND operations_manager/i);
  assert.match(contract, /reject if the caller is inactive or lacks `operations_manager`/i);
  assert.match(contract, /never authorize payroll from `super_admin`, `ceo`, or UI visibility alone/i);
});

test('server calculation uses canonical DB facts and accepted attendance only', () => {
  assert.match(contract, /must fetch payroll facts from the database after authorization/i);
  assert.match(contract, /must not calculate from a browser-supplied employee\/attendance\/rate array/i);
  assert.match(contract, /exactly one `accepted` attendance batch may exist per payroll month/i);
  assert.match(contract, /missing prior-boundary accepted batch must leave the affected weekly-holiday period unresolved/i);
  assert.match(contract, /clock-in\/out span must never become paid hours automatically/i);
});

test('internal persistence boundary is not callable with arbitrary browser result JSON', () => {
  assert.match(contract, /browser must not directly call a payroll result persistence RPC/i);
  assert.match(contract, /browser roles do not receive EXECUTE on that internal persistence RPC/i);
  assert.match(contract, /must not perform direct table writes/i);
  assert.match(contract, /service-role usage is \*\*not approved for deployment/i);
});

test('calculation persistence is idempotent and atomic', () => {
  assert.match(contract, /\(payroll_month_id, calculation_version, input_fingerprint, cutoff_date\)/i);
  assert.match(contract, /Two identical requests must converge on one canonical run/i);
  assert.match(contract, /persist employee results and latest-run pointer atomically/i);
  assert.match(contract, /never leave `latest_run_id` pointing at a partially persisted run/i);
});

test('runtime logs exclude employee-sensitive payroll payloads', () => {
  assert.match(contract, /Do not log:/i);
  assert.match(contract, /employee names/i);
  assert.match(contract, /gross\/net employee pay/i);
  assert.match(contract, /raw attendance clocks/i);
  assert.match(contract, /bank data/i);
  assert.match(contract, /full request\/result payloads/i);
});

test('runtime is isolated from normal platform page loads', () => {
  assert.match(contract, /runs only on explicit payroll actions/i);
  assert.match(contract, /Normal `\/app\/` loads[\s\S]*must read persisted results/i);
  assert.match(contract, /must not be imported by general platform routes/i);
});

test('staging runtime test plan includes auth, tamper, boundary, concurrency and privacy cases', () => {
  assert.match(contract, /unauthenticated request denied/i);
  assert.match(contract, /inactive operations manager denied/i);
  assert.match(contract, /browser-supplied fake gross\/result payload ignored or rejected/i);
  assert.match(contract, /missing prior-boundary attendance produces pending weekly holiday/i);
  assert.match(contract, /identical concurrent calculations converge on one run/i);
  assert.match(contract, /no sensitive payroll values appear in logs/i);
});
