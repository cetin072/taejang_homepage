const test = require('node:test');
const assert = require('node:assert/strict');

const termValidator = require('../app/assets/payroll-term-validator.js');
const core = require('../prototypes/payroll-backend/edge-runtime/payroll-calculate-core.js');

function monthlyTerm(overrides = {}) {
  return {
    employeeId: 'E1',
    effectiveFrom: '2026-06-09',
    effectiveTo: null,
    payType: 'monthly',
    dailyScheduledHours: null,
    hourlyRate: null,
    monthlySalary: 3900000,
    ...overrides,
  };
}

function employee(overrides = {}) {
  return {
    employeeId: 'E1',
    hiredAt: '2026-06-09',
    terminatedAt: null,
    ...overrides,
  };
}

test('monthly terms require monthly salary but do not require hourly fields', () => {
  const valid = termValidator.validateEmploymentTerms([monthlyTerm()]);
  assert.equal(valid.ok, true);
  assert.equal(valid.issueCount, 0);

  const missingSalary = termValidator.validateEmploymentTerms([monthlyTerm({ monthlySalary: null })]);
  assert.equal(missingSalary.ok, false);
  assert.equal(missingSalary.counts.employment_term_monthly_salary_missing, 1);
  assert.equal(missingSalary.counts.employment_term_rate_missing || 0, 0);
  assert.equal(missingSalary.counts.employment_term_hours_invalid || 0, 0);
});

test('full-month monthly salary reproduces the contractual amount without attendance arithmetic', () => {
  const result = core.calculateMonthlySalaryResult({
    employee: employee(),
    year: 2026,
    month: 9,
    terms: [monthlyTerm()],
    attendanceRecords: [],
  });

  assert.equal(result.payType, 'monthly');
  assert.equal(result.rateStatus, 'monthly_salary');
  assert.equal(result.monthlySalary, 3900000);
  assert.equal(result.grossPayPreview, 3900000);
  assert.equal(result.hourlyRate, null);
  assert.equal(result.payableHoursPreview, 0);
  assert.equal(result.weeklyHolidayActualHours, 0);
  assert.equal(result.unresolvedCount, 0);
});

test('partial relationship and midmonth term change stay review-required', () => {
  const partial = core.calculateMonthlySalaryResult({
    employee: employee({ hiredAt: '2026-09-02' }),
    year: 2026,
    month: 9,
    terms: [monthlyTerm({ effectiveFrom: '2026-09-02' })],
    attendanceRecords: [],
  });
  assert.equal(partial.rateStatus, 'monthly_salary_review_required');
  assert.equal(partial.grossPayPreview, null);
  assert.equal(partial.unresolved[0].reason, 'monthly_salary_partial_relationship_review_required');

  const changed = core.calculateMonthlySalaryResult({
    employee: employee(),
    year: 2026,
    month: 9,
    terms: [
      monthlyTerm({ effectiveTo: '2026-09-15' }),
      monthlyTerm({ effectiveFrom: '2026-09-16', monthlySalary: 4100000 }),
    ],
    attendanceRecords: [],
  });
  assert.equal(changed.rateStatus, 'monthly_salary_review_required');
  assert.equal(changed.grossPayPreview, null);
  assert.equal(changed.unresolved[0].reason, 'monthly_salary_term_change_review_required');
});

test('unpaid absence or correction evidence does not silently reduce a monthly salary', () => {
  const result = core.calculateMonthlySalaryResult({
    employee: employee(),
    year: 2026,
    month: 9,
    terms: [monthlyTerm()],
    attendanceRecords: [{
      employeeId: 'E1',
      date: '2026-09-10',
      autoDecision: '원본_무급결근',
    }],
  });

  assert.equal(result.rateStatus, 'monthly_salary_review_required');
  assert.equal(result.monthlySalary, 3900000);
  assert.equal(result.grossPayPreview, null);
  assert.equal(result.unresolved[0].reason, 'monthly_salary_attendance_adjustment_review_required');
});

test('trusted calculation runtime persists monthly pay type without calling the hourly engine', async () => {
  let persisted = null;
  const calculate = core.createPayrollCalculateCore({
    authorizeRequest: async () => ({ actorId: 'actor-1' }),
    fetchCanonicalInput: async () => ({
      payroll_month: '2026-09-01',
      cutoff_date: '2026-09-25',
      input_basis_fingerprint: 'fingerprint-1',
      attendance_batches: { current_batch_id: 'batch-1' },
      employees: [{ employee_uuid: 'uuid-1', employee_id: 'E1' }],
      terms: [],
      holidays: [],
      attendance: [],
    }),
    fetchStatutoryInput: async () => ({
      rate_rules: [],
      profiles: [{ employee_uuid: 'uuid-1', effective_from: '2026-01-01', effective_to: null }],
    }),
    persistTrustedResult: async (payload) => {
      persisted = payload;
      return { run_id: 'run-1' };
    },
    adapter: {
      toEnginePayrollInputs: () => ({
        payrollMonth: '2026-09-01',
        year: 2026,
        month: 9,
        cutoffDate: '2026-09-25',
        acceptedBatchId: 'batch-1',
        inputBasisFingerprint: 'fingerprint-1',
        inputBlockers: [],
        employees: [employee()],
        terms: [monthlyTerm()],
        holidays: [],
        attendanceRecords: [],
      }),
    },
    engine: {
      calculateProvisionalMonth: () => {
        throw new Error('hourly engine must not run for full-month monthly salary');
      },
    },
    preflight: {
      validatePayrollInput: () => ({ calculationAllowed: true, criticalCount: 0, issues: [] }),
    },
    statutory: {
      calculateStatutoryDeductions: () => ({ status: 'complete', rows: [], totalEmployeeDeduction: 0 }),
    },
  });

  const result = await calculate({
    payroll_month: '2026-09-01',
    cutoff_date: '2026-09-25',
    accepted_import_batch_id: 'batch-1',
  });

  assert.equal(result.status, 'provisional_ready');
  assert.equal(result.grossPayPreview, 3900000);
  assert.equal(persisted.employeeResults.length, 1);
  assert.equal(persisted.employeeResults[0].hourly_rate, null);
  assert.equal(persisted.employeeResults[0].rate_status, 'monthly_salary');
  assert.equal(persisted.employeeResults[0].gross_pay_preview, 3900000);
  assert.equal(persisted.employeeResults[0].calculation_detail.pay_type, 'monthly');
  assert.equal(persisted.employeeResults[0].calculation_detail.monthly_salary, 3900000);
});
