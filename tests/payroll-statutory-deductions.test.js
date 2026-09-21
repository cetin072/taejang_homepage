const test = require('node:test');
const assert = require('node:assert/strict');
const payrollStatutory = require('../app/assets/payroll-statutory-deductions.js');

function rules(overrides = {}) {
  // Synthetic engine configuration used to test supported rounding mechanics.
  // Production/Staging policy remains DB-driven and may stay null until officially verified.
  const base = [
    { rateCode: 'national_pension', effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30', employeeRate: 0.0475, minimumBasis: 400000, maximumBasis: 6370000, roundingMethod: 'floor_to_10' },
    { rateCode: 'national_pension', effectiveFrom: '2026-07-01', effectiveTo: '2026-12-31', employeeRate: 0.0475, minimumBasis: 410000, maximumBasis: 6590000, roundingMethod: 'floor_to_10' },
    { rateCode: 'health_insurance', effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', employeeRate: 0.03595, minimumEmployeeContribution: 10080, maximumEmployeeContribution: 4591740, roundingMethod: 'floor_to_10' },
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

test('mid-month pension and health acquisition normally starts charging next month', () => {
  const profile = enrolledProfile();
  profile.nationalPensionAcquiredOn = '2026-07-08';
  profile.healthInsuranceAcquiredOn = '2026-07-08';
  profile.employmentInsuranceAcquiredOn = '2026-07-08';
  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-07-01',
    taxableRemuneration: 700000,
    profile,
    rateRules: rules(),
  });
  const pension = result.rows.find((row) => row.code === 'national_pension');
  const health = result.rows.find((row) => row.code === 'health_insurance');
  const longTermCare = result.rows.find((row) => row.code === 'long_term_care');
  const employment = result.rows.find((row) => row.code === 'employment_insurance');
  assert.equal(pension.amount, 0);
  assert.ok(pension.reasons.includes('acquisition_month_not_charged'));
  assert.equal(health.amount, 0);
  assert.equal(longTermCare.amount, 0);
  assert.equal(employment.amount, 6300);
});

test('pension acquisition-month opt-in charges from a non-first-day acquisition', () => {
  const profile = enrolledProfile();
  profile.nationalPensionAcquiredOn = '2026-07-08';
  profile.nationalPensionAcquisitionMonthOptIn = true;
  profile.pensionStandardMonthlyIncome = 300000;
  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-07-01',
    taxableRemuneration: 700000,
    profile,
    rateRules: rules(),
  });
  const pension = result.rows.find((row) => row.code === 'national_pension');
  assert.equal(pension.amount, 19470);
});

test('July 2026 pension basis uses the official 410,000 floor', () => {
  const profile = enrolledProfile();
  profile.pensionStandardMonthlyIncome = 300000;
  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-07-01',
    taxableRemuneration: 700000,
    profile,
    rateRules: rules(),
  });
  const pension = result.rows.find((row) => row.code === 'national_pension');
  assert.equal(pension.amount, 19470);
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

test('2026 employment insurance uses verified won-unit truncation', () => {
  const profile = enrolledProfile();
  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-07-01',
    taxableRemuneration: 1614254,
    profile,
    rateRules: rules(),
  });
  const employment = result.rows.find((row) => row.code === 'employment_insurance');
  assert.equal(employment.status, 'complete');
  assert.equal(employment.amount, 14528);
  assert.equal(employment.roundingMethod, 'floor_to_1');
});
