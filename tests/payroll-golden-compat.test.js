const test = require('node:test');
const assert = require('node:assert/strict');

const compat = require('../app/assets/payroll-golden-compat.js');

const AUGUST_GOLDEN = [
  {
    caseId: 'normal-3h',
    workHours: 63,
    weeklyHolidayHours: 12,
    hourlyRate: 10320,
    expectedGrossPay: 774000,
  },
  {
    caseId: '3h-to-4h-late-month',
    workHours: 69,
    weeklyHolidayHours: 13,
    hourlyRate: 10320,
    expectedGrossPay: 846240,
  },
  {
    caseId: '3h-to-4h-early-month',
    workHours: 79,
    weeklyHolidayHours: 15,
    hourlyRate: 10320,
    expectedGrossPay: 970080,
  },
  {
    caseId: 'three-unpaid-absence-days',
    workHours: 54,
    weeklyHolidayHours: 9,
    hourlyRate: 10320,
    expectedGrossPay: 650160,
  },
  {
    caseId: 'confirmed-manual-two-hour-day',
    workHours: 62,
    weeklyHolidayHours: 12,
    hourlyRate: 10320,
    expectedGrossPay: 763680,
  },
  {
    caseId: 'new-hire-with-one-absence',
    workHours: 45,
    weeklyHolidayHours: 6,
    hourlyRate: 10320,
    expectedGrossPay: 526320,
  },
];

test('anonymous August historical Golden cases reproduce exact already-paid gross amounts', () => {
  for (const fixture of AUGUST_GOLDEN) {
    const result = compat.compareHistoricalGolden(fixture);
    assert.equal(result.matched, true, fixture.caseId);
    assert.equal(result.difference, 0, fixture.caseId);
    assert.equal(result.calculationMode, 'historical_golden_reproduction');
  }
});

test('historical compatibility does not redefine the new weekly-holiday engine', () => {
  const result = compat.reproduceHistoricalHourlyPayroll({
    workHours: 63,
    weeklyHolidayHours: 12,
    hourlyRate: 10320,
  });

  assert.equal(result.payableHours, 75);
  assert.equal(result.grossPay, 774000);
  assert.equal(result.calculationMode, 'historical_golden_reproduction');
});

test('retroactive differences are review-only and never automatic payments', () => {
  const candidate = compat.buildRetroactiveReviewCandidate({
    employeeId: 'TJ-TEST-0001',
    month: '2026-08',
    historicalWeeklyHolidayHours: 12,
    recalculatedWeeklyHolidayHours: 15,
    hourlyRate: 10320,
  });

  assert.equal(candidate.differenceHours, 3);
  assert.equal(candidate.estimatedDifferenceAmount, 30960);
  assert.equal(candidate.status, 'review_only');
  assert.equal(candidate.automaticPaymentAllowed, false);
});

test('no historical difference remains explicitly non-actionable', () => {
  const candidate = compat.buildRetroactiveReviewCandidate({
    employeeId: 'TJ-TEST-0001',
    month: '2026-08',
    historicalWeeklyHolidayHours: 12,
    recalculatedWeeklyHolidayHours: 12,
    hourlyRate: 10320,
  });

  assert.equal(candidate.differenceHours, 0);
  assert.equal(candidate.status, 'no_difference');
  assert.equal(candidate.automaticPaymentAllowed, false);
});
