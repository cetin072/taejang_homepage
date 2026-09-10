const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const note = fs.readFileSync(path.join(root, 'prototypes/payroll-backend/CAPABILITY_PROMOTION_NOTE.md'), 'utf8');

test('final payroll promotion must consolidate capability semantics and never widen audience', () => {
  assert.match(note, /do not promote the old role-string access prototype/i);
  assert.match(note, /Consolidate them with `payroll_capability_candidate\.sql`/i);
  assert.match(note, /`payroll\.manage`/i);
  assert.match(note, /no lower-role\/CEO\/super-admin grant/i);
  assert.match(note, /authorizes no migration or deployment/i);
});
