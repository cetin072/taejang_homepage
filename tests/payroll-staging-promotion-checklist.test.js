const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const checklist = fs.readFileSync(
  path.join(root, 'prototypes/payroll-backend/STAGING_PROMOTION_CHECKLIST.md'),
  'utf8'
);

test('staging checklist does not authorize deployment and keeps payroll function outside deployable tree', () => {
  assert.match(checklist, /NOTHING IN THIS DOCUMENT AUTHORIZES DEPLOYMENT/i);
  assert.match(checklist, /separate user approval/i);
  assert.equal(
    fs.existsSync(path.join(root, 'supabase/functions/payroll-calculate/index.ts')),
    false,
    'payroll Edge Function must still be outside deployable tree'
  );
});

test('staging checklist requires approved operator access and denies implicit super-admin payroll authority', () => {
  assert.match(checklist, /active `operations_manager`/i);
  assert.match(checklist, /inactive `operations_manager` is denied/i);
  assert.match(checklist, /`super_admin` without operations-manager role is denied/i);
  assert.match(checklist, /ordinary staff is denied/i);
});

test('staging checklist requires direct payroll CRUD denial including service-role confinement', () => {
  assert.match(checklist, /payroll tables remain unavailable through direct browser CRUD/i);
  assert.match(checklist, /service client receives EXECUTE only on the trusted persistence RPC/i);
  assert.match(checklist, /`service_role` has direct payroll table CRUD revoked/i);
});

test('staging checklist includes canonical attendance and partial-pay fail-closed rules', () => {
  assert.match(checklist, /one accepted attendance batch per payroll month/i);
  assert.match(checklist, /missing prior-boundary accepted attendance is explicit/i);
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

test('staging checklist explicitly blocks real data, Production and payment execution', () => {
  assert.match(checklist, /Synthetic\/anonymized employees and attendance/i);
  assert.match(checklist, /No payment, bank-transfer, tax filing, insurance filing, or retroactive payment/i);
  assert.match(checklist, /do not promote staging findings to Production automatically/i);
  assert.match(checklist, /using any real employee payroll\/attendance data for verification/i);
});
