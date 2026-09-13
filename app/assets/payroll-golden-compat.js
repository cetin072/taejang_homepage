(function initPayrollGoldenCompat(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TaejangPayrollGoldenCompat = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollGoldenCompatFactory() {
  'use strict';

  function requiredNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${label} must be numeric.`);
    return number;
  }

  function reproduceHistoricalHourlyPayroll({ workHours, weeklyHolidayHours, hourlyRate }) {
    const work = requiredNumber(workHours, 'workHours');
    const weekly = requiredNumber(weeklyHolidayHours, 'weeklyHolidayHours');
    const rate = requiredNumber(hourlyRate, 'hourlyRate');
    const payableHours = work + weekly;
    return {
      workHours: work,
      weeklyHolidayHours: weekly,
      payableHours,
      hourlyRate: rate,
      grossPay: Math.round(payableHours * rate),
      calculationMode: 'historical_golden_reproduction',
    };
  }

  function compareHistoricalGolden({ expectedGrossPay, ...inputs }) {
    const reproduced = reproduceHistoricalHourlyPayroll(inputs);
    const expected = requiredNumber(expectedGrossPay, 'expectedGrossPay');
    return {
      ...reproduced,
      expectedGrossPay: expected,
      difference: reproduced.grossPay - expected,
      matched: reproduced.grossPay === expected,
    };
  }

  function buildRetroactiveReviewCandidate({
    employeeId,
    month,
    historicalWeeklyHolidayHours,
    recalculatedWeeklyHolidayHours,
    hourlyRate,
  }) {
    const before = requiredNumber(historicalWeeklyHolidayHours, 'historicalWeeklyHolidayHours');
    const after = requiredNumber(recalculatedWeeklyHolidayHours, 'recalculatedWeeklyHolidayHours');
    const rate = requiredNumber(hourlyRate, 'hourlyRate');
    const differenceHours = after - before;

    return {
      employeeId,
      month,
      historicalWeeklyHolidayHours: before,
      recalculatedWeeklyHolidayHours: after,
      differenceHours,
      estimatedDifferenceAmount: Math.round(differenceHours * rate),
      status: differenceHours === 0 ? 'no_difference' : 'review_only',
      automaticPaymentAllowed: false,
    };
  }

  return Object.freeze({
    reproduceHistoricalHourlyPayroll,
    compareHistoricalGolden,
    buildRetroactiveReviewCandidate,
  });
});
