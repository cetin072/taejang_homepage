const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'prototypes/payroll-backend/README.md'), 'utf8');

test('prototype index keeps resync, capability, attendance and deployment gates explicit', () => {
  assert.match(index, /current-main resync/i);
  assert.match(index, /vendor\/fingerprint Excel accepted import/i);
  assert.match(index, /`payroll\.manage`/i);
  assert.match(index, /operations-manager only/i);
  assert.match(index, /separate approval before any staging payroll migration or Edge deployment/i);
  assert.match(index, /ai-development-system` Issue #21/i);
  assert.match(index, /realtime AI is not required/i);
});
