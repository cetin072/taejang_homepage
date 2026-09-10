const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const body = fs.readFileSync(path.join(root, 'prototypes/payroll-backend/RESYNC_ISSUE_BODY.md'), 'utf8');

test('resync execution contract is base-first and non-destructive', () => {
  assert.match(body, /Resync `codex\/issue-111-payroll-accuracy-mvp` \(#112\) first/i);
  assert.match(body, /No force-push/i);
  assert.match(body, /Update `codex\/goal-142-payroll-operator-mvp` \(#143\)/i);
});

test('resync execution contract adopts current capability and keeps attendance sources separate', () => {
  assert.match(body, /Issue #148 capability model/i);
  assert.match(body, /`payroll\.manage`/i);
  assert.match(body, /Issue #149 mobile operational attendance separate/i);
  assert.match(body, /never derive paid hours from clock span/i);
});

test('resync execution contract preserves Issue 21 AI boundary and deployment gates', () => {
  assert.match(body, /ai-development-system` Issue #21/i);
  assert.match(body, /realtime AI is not required/i);
  assert.match(body, /no staging\/Production payroll migration or Edge deployment occurs/i);
  assert.match(body, /real payroll lock\/payment\/retroactive payment/i);
});
