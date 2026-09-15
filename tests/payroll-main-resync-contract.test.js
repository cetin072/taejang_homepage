const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const plan = fs.readFileSync(path.join(root, 'prototypes/payroll-backend/MAIN_RESYNC_PLAN.md'), 'utf8');

test('resync plan preserves stacked draft branches and requires base-first reconciliation', () => {
  assert.match(plan, /PR #112 and PR #143 remain Draft/i);
  assert.match(plan, /resync `codex\/issue-111-payroll-accuracy-mvp` \(#112\) with current `origin\/main`/i);
  assert.match(plan, /update `codex\/goal-142-payroll-operator-mvp` \(#143\) from the now-resynced #112 base/i);
  assert.match(plan, /No force-push/i);
});

test('resync plan requires current capability and attendance contracts rather than preserving stale assumptions', () => {
  assert.match(plan, /Issue #148 now makes server-owned capabilities the feature-authorization source of truth/i);
  assert.match(plan, /`payroll\.manage`/i);
  assert.match(plan, /do not grant payroll access to CEO or technical `super_admin`/i);
  assert.match(plan, /Issue #149 uses mobile operational attendance/i);
  assert.match(plan, /accepted vendor\/fingerprint Excel import batches remain the payroll calculation source of truth/i);
});

test('resync plan requires payroll registration in main test runner and combined regression', () => {
  assert.match(plan, /add `payrollRegression`/i);
  assert.match(plan, /add `npm run test:payroll`/i);
  assert.match(plan, /`npm test`/i);
  assert.match(plan, /Phase 1A Supabase integration/i);
  assert.match(plan, /employee\/account\/capability authorization DB tests/i);
  assert.match(plan, /Issue #149 attendance integrity DB tests/i);
});

test('resync plan keeps AI optional and blocks deployment side effects', () => {
  assert.match(plan, /latest `cetin072\/ai-development-system` Issue #21/i);
  assert.match(plan, /realtime AI is not required for the payroll MVP/i);
  assert.match(plan, /staging payroll migration application/i);
  assert.match(plan, /PR Ready\/merge/i);
  assert.match(plan, /real payroll month lock\/payment/i);
});
