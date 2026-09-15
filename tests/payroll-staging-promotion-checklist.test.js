const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const checklist = fs.readFileSync(
  path.join(root, 'prototypes/payroll-backend/STAGING_PROMOTION_CHECKLIST.md'),
  'utf8'
);
const compatibility = fs.readFileSync(
  path.join(root, 'prototypes/payroll-backend/STAGING_COMPATIBILITY_SNAPSHOT_20260910.md'),
  'utf8'
);
const resyncPlan = fs.readFileSync(
  path.join(root, 'prototypes/payroll-backend/MAIN_RESYNC_PLAN.md'),
  'utf8'
);
const promotionReceipt = fs.readFileSync(
  path.join(root, 'prototypes/payroll-backend/STAGING_PAYROLL_PROMOTION_RECEIPT_20260911.md'),
  'utf8'
);

test('staging checklist is not self-authorizing while the approved promotion is separately receipted', () => {
  assert.match(checklist, /NOTHING IN THIS DOCUMENT AUTHORIZES DEPLOYMENT/i);
  assert.match(checklist, /separate user approval/i);
  assert.equal(
    fs.existsSync(path.join(root, 'supabase/functions/payroll-calculate/index.ts')),
    true,
    'user-approved Staging promotion must keep the deployed Edge source versioned'
  );
  assert.match(promotionReceipt, /STAGING PAYROLL FOUNDATION APPLIED \/ SYNTHETIC VERIFICATION PASSED/i);
  assert.match(promotionReceipt, /user-approved Staging-only payroll foundation work/i);
  assert.match(promotionReceipt, /does \*\*not\*\* authorize real August payroll data, Production, Ready\/merge, real month lock, payment/i);
});

test('staging promotion requires current main and staging migration baselines to be synchronized first', () => {
  assert.match(checklist, /current work-platform main schema/i);
  assert.match(checklist, /record current `main` SHA/i);
  assert.match(checklist, /record current staging migration head/i);
  assert.match(checklist, /staging has applied all platform migrations required by current `main`/i);
  assert.match(checklist, /re-sync\/rebase the payroll implementation against current `main`/i);
  assert.match(checklist, /do not apply payroll candidates onto a staging schema that is behind/i);
  assert.match(compatibility, /READ-ONLY OBSERVATION \/ NOT DEPLOYMENT AUTHORIZATION/i);
  assert.match(compatibility, /staging was \*\*behind the current main migration baseline\*\*/i);
  assert.match(promotionReceipt, /platform baseline had already been reconciled through Issue #151 before payroll promotion/i);
});

test('main resync plan registers payroll into the current manifest-based test runner', () => {
  assert.match(resyncPlan, /PLAN ONLY \/ NO REBASE OR MERGE PERFORMED/i);
  assert.match(resyncPlan, /scripts\/test-manifest\.mjs/i);
  assert.match(resyncPlan, /payrollRegression/i);
  assert.match(resyncPlan, /npm run test:payroll/i);
  assert.match(resyncPlan, /include payroll in default `npm test` once(?: the branch is)? integrated/i);
  assert.match(resyncPlan, /Issue #149 attendance integrity/i);
  assert.match(resyncPlan, /accepted vendor\/fingerprint Excel import batches remain the payroll calculation source of truth/i);
  assert.match(resyncPlan, /mobile attendance remains separate operational evidence/i);
});

test('staging checklist requires approved operator access and denies implicit super-admin payroll authority', () => {
  assert.match(checklist, /active `operations_manager`/i);
  assert.match(checklist, /inactive `operations_manager` is denied/i);
  assert.match(checklist, /`super_admin` without operations-manager role is denied/i);
  assert.match(checklist, /ordinary staff is denied/i);
  assert.match(promotionReceipt, /`payroll\.manage` exists as an active operational capability with `operations_manager_auto_grant=true`/i);
  assert.match(promotionReceipt, /no lower-role direct grant for `payroll\.manage` exists/i);
});

test('staging checklist requires direct payroll CRUD denial including service-role confinement', () => {
  assert.match(checklist, /payroll tables remain unavailable through direct browser CRUD/i);
  assert.match(checklist, /service client receives EXECUTE only on the trusted persistence RPC/i);
  assert.match(checklist, /`service_role` has direct payroll table CRUD revoked/i);
  assert.match(promotionReceipt, /`service_role` has no direct payroll table CRUD/i);
  assert.match(promotionReceipt, /`service_role` can execute `private_persist_payroll_calculation`/i);
});

test('staging checklist keeps vendor payroll attendance separate from mobile operational attendance', () => {
  assert.match(checklist, /Payroll source of truth:[\s\S]*accepted vendor\/fingerprint Excel import batch/i);
  assert.match(checklist, /Work-platform mobile attendance:[\s\S]*`attendance_events`[\s\S]*`attendance_corrections`/i);
  assert.match(checklist, /Do \*\*not\*\* automatically merge, overwrite, or sum these two sources/i);
  assert.match(checklist, /mobile attendance never silently overrides an accepted payroll import row/i);
  assert.match(compatibility, /accepted vendor\/fingerprint Excel import batch remains the payroll attendance source of truth/i);
});

test('staging checklist includes canonical attendance and partial-pay fail-closed rules', () => {
  assert.match(checklist, /one accepted payroll attendance batch is canonical for each payroll month/i);
  assert.match(checklist, /missing prior-boundary accepted payroll attendance is explicit/i);
  assert.match(checklist, /raw clock-in\/out values remain evidence only/i);
  assert.match(checklist, /employee gross is null whenever that employee has unresolved days, pending weekly-holiday weeks, or rate review/i);
});

test('staging checklist requires transaction, concurrency, privacy and performance tests', () => {
  assert.match(checklist, /two identical simultaneous calculations converge on one canonical run/i);
  assert.match(checklist, /canonical input fingerprint changes during calculation/i);
  assert.match(checklist, /persistence failure leaves no partial run/i);
  assert.match(checklist, /service credential is absent from responses and logs/i);
  assert.match(checklist, /general `\/app\/` does not load payroll/i);
});

test('staging approval remains synthetic-only and still blocks real data, Production and payment execution', () => {
  assert.match(checklist, /Synthetic\/anonymized employees and attendance/i);
  assert.match(checklist, /No payment, bank-transfer, tax filing, insurance filing, or retroactive payment/i);
  assert.match(checklist, /do not promote staging findings to Production automatically/i);
  assert.match(checklist, /using any real employee payroll\/attendance data for verification/i);
  assert.match(promotionReceipt, /no real August payroll or attendance import/i);
  assert.match(promotionReceipt, /no real month lock/i);
  assert.match(promotionReceipt, /no payment or retroactive payment/i);
  assert.match(promotionReceipt, /no Production migration or Edge deployment/i);
});
