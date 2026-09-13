const test = require('node:test');
const assert = require('node:assert/strict');
const payrollStatutory = require('../app/assets/payroll-statutory-deductions.js');

function rules(overrides = {}) {
  // Synthetic engine configuration used to test supported rounding mechanics.
  // Production/Staging policy remains DB-driven and may stay null until officially verified.
  const base = [
    { rateCode: 'national_pension', effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', employeeRate: 0.0475, roundingMethod: 'floor_to_10' },
    { rateCode: 'health_insurance', effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', employeeRate: 0.03595, roundingMethod: 'floor_to_10' },
    { rateCode: 'long_term_care', effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', ratioNumerator: 0.009448, ratioDenominator: 0.0719, roundingMethod: 'floor_to_10' },
    { rateCode: 'employment_insurance', effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', employeeRate: 0.009, roundingMethod: 'floor_to_1' },
  ];
  return base.map((rule) => Object.assign({}, rule, overrides[rule.rateCode] || {}));
}

function enrolledProfile() {
  return {
    nationalPensionStatus: 'enrolled',
    healthInsuranceStatus: 'enrolled',
    employmentInsuranceStatus: 'enrolled',
    pensionStandardMonthlyIncome: 2636000,
    healthMonthlyRemuneration: 2500000,
  };
}

test('uses statutory bases instead of gross pay for pension and health', () => {
  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-09-01',
    taxableRemuneration: 1800000,
    profile: enrolledProfile(),
    rateRules: rules(),
  });

  const pension = result.rows.find((row) => row.code === 'national_pension');
  const health = result.rows.find((row) => row.code === 'health_insurance');
  assert.equal(pension.rawAmount, 125210);
  assert.equal(pension.amount, 125210);
  assert.equal(health.rawAmount, 89875);
  assert.equal(health.amount, 89870);
});

test('normalizes floating point drift before applying configured rounding policy', () => {
  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-09-01',
    taxableRemuneration: 835920,
    profile: enrolledProfile(),
    rateRules: rules(),
  });
  const employment = result.rows.find((row) => row.code === 'employment_insurance');
  assert.equal(employment.rawAmount, 7523.28);
  assert.equal(employment.amount, 7523);
  assert.equal(payrollStatutory.applyRounding(89875, 'floor_to_10'), 89870);
});

test('fails closed when an official rounding policy is missing', () => {
  const rateRules = rules({ health_insurance: { roundingMethod: null } });
  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-09-01',
    taxableRemuneration: 1800000,
    profile: enrolledProfile(),
    rateRules,
  });
  const health = result.rows.find((row) => row.code === 'health_insurance');
  assert.equal(health.status, 'review_required');
  assert.ok(health.reasons.includes('rounding_policy_missing'));
  assert.equal(result.totalEmployeeDeduction, null);
});

test('pending insurance eligibility blocks final deduction rather than guessing', () => {
  const profile = enrolledProfile();
  profile.nationalPensionStatus = 'pending_review';
  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-09-01',
    taxableRemuneration: 1800000,
    profile,
    rateRules: rules(),
  });
  const pension = result.rows.find((row) => row.code === 'national_pension');
  assert.equal(pension.status, 'review_required');
  assert.ok(pension.reasons.includes('eligibility_pending_review'));
});

test('mid-month insurance acquisition or loss requires review', () => {
  const profile = enrolledProfile();
  profile.healthInsuranceAcquiredOn = '2026-09-12';
  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-09-01',
    taxableRemuneration: 1800000,
    profile,
    rateRules: rules(),
  });
  const health = result.rows.find((row) => row.code === 'health_insurance');
  assert.equal(health.status, 'review_required');
  assert.ok(health.reasons.includes('mid_month_coverage_boundary'));
});

test('not-applicable insurance produces zero without changing other statutory rates', () => {
  const profile = enrolledProfile();
  profile.nationalPensionStatus = 'not_applicable';
  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-09-01',
    taxableRemuneration: 1800000,
    profile,
    rateRules: rules(),
  });
  const pension = result.rows.find((row) => row.code === 'national_pension');
  assert.equal(pension.status, 'complete');
  assert.equal(pension.amount, 0);
});
