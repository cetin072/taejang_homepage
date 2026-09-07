const test = require('node:test');
const assert = require('node:assert/strict');

const validator = require('../app/assets/payroll-term-validator.js');

function term(overrides = {}) {
  return {
    employeeId: 'TJ-TEST-0001',
    effectiveFrom: '2026-06-09',
    effectiveTo: null,
    dailyScheduledHours: 3,
    hourlyRate: 10320,
    ...overrides,
  };
}

test('approved adjacent effective-dated periods do not overlap', () => {
  const result = validator.validateEmploymentTerms([
    term({ effectiveFrom: '2026-06-09', effectiveTo: '2026-08-23', dailyScheduledHours: 3 }),
    term({ effectiveFrom: '2026-08-24', effectiveTo: null, dailyScheduledHours: 4 }),
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.issueCount, 0);
});

test('same-day old-end and new-start is rejected as an inclusive-date overlap', () => {
  const result = validator.validateEmploymentTerms([
    term({ effectiveFrom: '2026-06-09', effectiveTo: '2026-08-24', dailyScheduledHours: 3 }),
    term({ effectiveFrom: '2026-08-24', effectiveTo: null, dailyScheduledHours: 4 }),
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.counts.employment_term_overlap, 1);
  assert.equal(result.issues.find((item) => item.code === 'employment_term_overlap').severity, 'critical');
});

test('open-ended old term cannot silently coexist with a later term', () => {
  const result = validator.validateEmploymentTerms([
    term({ effectiveFrom: '2026-06-09', effectiveTo: null }),
    term({ effectiveFrom: '2026-08-24', effectiveTo: null, dailyScheduledHours: 4 }),
  ]);

  assert.equal(result.counts.employment_term_overlap, 1);
});

test('invalid date range is caught before payroll calculation', () => {
  const result = validator.validateEmploymentTerms([
    term({ effectiveFrom: '2026-08-24', effectiveTo: '2026-08-23' }),
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.counts.employment_term_range_invalid, 1);
});

test('missing hourly rate is an explicit preflight issue', () => {
  const result = validator.validateEmploymentTerms([
    term({ hourlyRate: null }),
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.counts.employment_term_rate_missing, 1);
});

test('validator output uses employee_id and dates only and does not need employee names', () => {
  const result = validator.validateEmploymentTerms([
    term({ effectiveTo: '2026-08-24', displayName: 'SECRET-NAME' }),
    term({ effectiveFrom: '2026-08-24', displayName: 'SECRET-NAME' }),
  ]);
  const serialized = JSON.stringify(result);

  assert.match(serialized, /TJ-TEST-0001/);
  assert.doesNotMatch(serialized, /SECRET-NAME/);
});
