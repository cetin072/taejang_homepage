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


test('national pension becomes age-based not applicable after compulsory coverage loss when no continuation exception exists', () => {
  const profile = enrolledProfile();
  profile.nationalPensionStatus = 'pending_review';
  profile.nationalPensionAgeLostOn = '2026-08-15';
  profile.nationalPensionOver60Exception = 'none';
  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-09-01',
    taxableRemuneration: 1800000,
    profile,
    rateRules: rules(),
  });
  const pension = result.rows.find((row) => row.code === 'national_pension');
  assert.equal(pension.status, 'complete');
  assert.equal(pension.amount, 0);
  assert.ok(pension.reasons.includes('not_applicable'));
});

test('national pension voluntary continuation keeps a confirmed enrolled profile active after age 60', () => {
  const profile = enrolledProfile();
  profile.nationalPensionAgeLostOn = '2026-08-15';
  profile.nationalPensionOver60Exception = 'voluntary_continuation_confirmed';
  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-09-01',
    taxableRemuneration: 1800000,
    profile,
    rateRules: rules(),
  });
  const pension = result.rows.find((row) => row.code === 'national_pension');
  assert.equal(pension.status, 'complete');
  assert.ok(pension.amount > 0);
});

test('employment insurance age 65 requires continuity review when employment began after age 65', () => {
  const profile = enrolledProfile();
  profile.employeeHiredOn = '2026-07-10';
  profile.employmentInsuranceAge65On = '2026-07-01';
  profile.employmentInsuranceOver65Status = 'unknown';
  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-07-01',
    taxableRemuneration: 1800000,
    profile,
    rateRules: rules(),
  });
  const employment = result.rows.find((row) => row.code === 'employment_insurance');
  assert.equal(employment.status, 'review_required');
  assert.ok(employment.reasons.includes('employment_insurance_age_continuity_review_required'));
});

test('employment insurance age 65 explicit new-employment exclusion produces zero employee deduction', () => {
  const profile = enrolledProfile();
  profile.employeeHiredOn = '2026-07-10';
  profile.employmentInsuranceAge65On = '2026-07-01';
  profile.employmentInsuranceOver65Status = 'employed_after_65_excluded';
  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-07-01',
    taxableRemuneration: 1800000,
    profile,
    rateRules: rules(),
  });
  const employment = result.rows.find((row) => row.code === 'employment_insurance');
  assert.equal(employment.status, 'complete');
  assert.equal(employment.amount, 0);
});

test('employment insurance age 65 confirmed continuity keeps ordinary contribution calculation', () => {
  const profile = enrolledProfile();
  profile.employeeHiredOn = '2026-07-10';
  profile.employmentInsuranceAge65On = '2026-07-01';
  profile.employmentInsuranceOver65Status = 'continuous_before_65_confirmed';
  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-07-01',
    taxableRemuneration: 1800000,
    profile,
    rateRules: rules(),
  });
  const employment = result.rows.find((row) => row.code === 'employment_insurance');
  assert.equal(employment.status, 'complete');
  assert.equal(employment.amount, 16200);
});


test('explicit payroll deduction OFF switches force zero without age or eligibility review', () => {
  const profile = enrolledProfile();
  profile.nationalPensionStatus = 'pending_review';
  profile.healthInsuranceStatus = 'pending_review';
  profile.employmentInsuranceStatus = 'pending_review';
  profile.nationalPensionDeductionOverride = false;
  profile.healthInsuranceDeductionOverride = false;
  profile.employmentInsuranceDeductionOverride = false;
  profile.nationalPensionAgeLostOn = '2026-01-01';
  profile.employmentInsuranceAge65On = '2026-01-01';

  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-09-01',
    taxableRemuneration: 1800000,
    profile,
    rateRules: rules(),
  });

  assert.equal(result.status, 'complete');
  for (const row of result.rows) {
    assert.equal(row.status, 'complete');
    assert.equal(row.amount, 0);
  }
});

test('explicit payroll deduction ON switches use annual rates and current pay when a statutory basis is absent', () => {
  const profile = {
    nationalPensionStatus: 'pending_review',
    healthInsuranceStatus: 'pending_review',
    employmentInsuranceStatus: 'pending_review',
    nationalPensionDeductionOverride: true,
    healthInsuranceDeductionOverride: true,
    employmentInsuranceDeductionOverride: true,
    nationalPensionAgeLostOn: '2026-01-01',
    employmentInsuranceAge65On: '2026-01-01',
    employmentInsuranceOver65Status: 'unknown',
  };

  const result = payrollStatutory.calculateStatutoryDeductions({
    payrollMonth: '2026-09-01',
    taxableRemuneration: 700000,
    profile,
    rateRules: rules(),
  });

  const pension = result.rows.find((row) => row.code === 'national_pension');
  const health = result.rows.find((row) => row.code === 'health_insurance');
  const longTermCare = result.rows.find((row) => row.code === 'long_term_care');
  const employment = result.rows.find((row) => row.code === 'employment_insurance');

  assert.equal(result.status, 'complete');
  assert.equal(pension.amount, 33250);
  assert.equal(health.amount, 25160);
  assert.equal(longTermCare.amount, 3300);
  assert.equal(employment.amount, 6300);
});
