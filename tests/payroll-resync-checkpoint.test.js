const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const checkpoint = fs.readFileSync(path.join(root, 'prototypes/payroll-backend/RESYNC_EXECUTION_CHECKPOINT.md'), 'utf8');

test('resync checkpoint requires base-first non-destructive sync and current capability integration', () => {
  assert.match(checkpoint, /resync #112 branch first/i);
  assert.match(checkpoint, /without force-push/i);
  assert.match(checkpoint, /update #143 from the resynced #112 base/i);
  assert.match(checkpoint, /`payroll\.manage`/i);
  assert.match(checkpoint, /vendor Excel payroll attendance separate from Issue #149 mobile attendance/i);
  assert.match(checkpoint, /`npm run test:payroll`/i);
});

test('resync checkpoint does not authorize staging, production, ready, merge or payment', () => {
  assert.match(checkpoint, /no staging payroll migration/i);
  assert.match(checkpoint, /no Edge deployment/i);
  assert.match(checkpoint, /no Production/i);
  assert.match(checkpoint, /no Ready\/main merge/i);
  assert.match(checkpoint, /no real payroll lock\/payment/i);
});
