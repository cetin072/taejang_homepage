const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const contract = fs.readFileSync(
  path.join(root, 'prototypes/payroll-backend/MONTHLY_SALARY_SUPPORT_CONTRACT.md'),
  'utf8'
);

test('monthly-salary contract permits only the narrow full-month fixed-salary automatic case', () => {
  assert.match(contract, /exactly one `monthly` employment\/pay term covers the entire payroll month/i);
  assert.match(contract, /`monthly_salary` is present and greater than zero/i);
  assert.match(contract, /employee relationship covers the entire payroll month/i);
  assert.match(contract, /gross preview = contractual `monthly_salary`/i);
});

test('monthly salary never reuses clock duration or hourly weekly-holiday arithmetic', () => {
  assert.match(contract, /do not derive gross from clock-in\/out duration/i);
  assert.match(contract, /do not add hourly weekly-holiday hours on top of the fixed monthly salary automatically/i);
  assert.match(contract, /Do not overload `hourly_rate` or work-hour totals to represent monthly salary/i);
});

test('partial month and midmonth monthly-pay changes remain review-required until an approved rule exists', () => {
  assert.match(contract, /hire after the first calendar day/i);
  assert.match(contract, /termination before the last calendar day/i);
  assert.match(contract, /monthly-salary change within the month/i);
  assert.match(contract, /hourly ↔ monthly pay-type change/i);
  assert.match(contract, /withhold the employee gross preview/i);
});

test('monthly-salary contract requires anonymized Golden validation before production automation', () => {
  assert.match(contract, /anonymized historical monthly-salary rows as Golden references/i);
  assert.match(contract, /do not infer those rules from a single payroll amount/i);
  assert.match(contract, /does not authorize real payroll changes/i);
});
