'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, 'payroll-hosted-e2e.mjs'), 'utf8');

test('hosted payroll E2E is staging-locked, reuses QA sessions, and performs cheap API checks before Chromium', () => {
  assert.match(source, /STAGING_REF = 'jgsxpdflgkqroecfjzxq'/);
  assert.match(source, /STAGING_CONFIRM !== 'STAGING'/);
  assert.match(source, /web-auth-handoff/);
  assert.match(source, /PAYROLL_HOSTED_HANDOFF_CODE/);
  assert.match(source, /token_hash/);
  assert.match(source, /await apiSmoke\(config, smokeSession\);[\s\S]*await browserE2E/);
  assert.match(source, /unpaid_absence/);
  assert.match(source, /absence_day_count/);
  assert.match(source, /calculation\?\.persisted/);
  assert.match(source, /calculation\?\.runId/);
  assert.match(source, /waitForEvent\('download'\)/);
  assert.match(source, /payslip-content/);
  assert.doesNotMatch(source, /video:|trace:/);
  assert.doesNotMatch(source, /PAYROLL_HOSTED_OPERATOR_SESSION_FILE/);
});
