const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const coreApi = require('../prototypes/payroll-backend/edge-runtime/payroll-calculate-core.js');
const adapter = require('../app/assets/payroll-db-input-adapter.js');
const engine = require('../app/assets/payroll-engine.js');
const preflight = require('../app/assets/payroll-preflight.js');

const root = path.join(__dirname, '..');
const integritySql = fs.readFileSync(
  path.join(root, 'prototypes/payroll-backend/employee_result_integrity_candidate.sql'),
  'utf8'
);

function canonicalWithMissingPriorBoundary() {
  return {
    payroll_month: '2026-09-01',
    cutoff_date: '2026-09-01',
    input_basis_fingerprint: 'canonical-fingerprint-1',
    input_window: {
      boundary_start: '2026-08-31',
      month_start: '2026-09-01',
      month_end: '2026-09-30',
      prior_boundary_required: true,
      prior_boundary_missing: true,
    },
    attendance_batches: {
      current_batch_id: 'batch-2026-09',
      current_source_fingerprint: 'source-fingerprint-1',
      prior_batch_id: null,
      prior_source_fingerprint: null,
    },
    employees: [
      {
        employee_uuid: 'employee-uuid-1',
        employee_id: 'TJ-TEST-0001',
        hired_on: '2026-06-01',
        departed_on: null,
        employment_status: 'active',
      },
    ],
    terms: [
      {
        term_id: 'term-1',
        employee_uuid: 'employee-uuid-1',
        effective_from: '2026-06-01',
        effective_to: null,
        pay_type: 'hourly',
        daily_scheduled_hours: 3,
        hourly_rate: 10320,
        monthly_salary: null,
      },
    ],
    holidays: [],
    attendance: [
      {
        attendance_row_id: 'attendance-1',
        source_key: 'source-1',
        employee_uuid: 'employee-uuid-1',
        work_date: '2026-09-01',
        scheduled_hours: 3,
        match_status: 'matched',
        record_status: 'complete',
        auto_decision: 'actual_scheduled',
        exception_type: null,
        review_status: null,
        confirmed_hours: null,
        correction_id: null,
      },
    ],
  };
}

test('trusted runtime withholds employee gross when a weekly-holiday week is still pending', async () => {
  let persistedPayload = null;
  const calculate = coreApi.createPayrollCalculateCore({
    authorizeRequest: async () => ({ actorId: 'actor-1' }),
    fetchCanonicalInput: async () => canonicalWithMissingPriorBoundary(),
    persistTrustedResult: async (payload) => {
      persistedPayload = payload;
      return { run_id: 'run-1' };
    },
    adapter,
    engine,
    preflight,
    now: () => '2026-09-10T00:00:00.000Z',
  });

  const result = await calculate({
    payroll_month: '2026-09-01',
    cutoff_date: '2026-09-01',
    accepted_import_batch_id: 'batch-2026-09',
  });

  assert.equal(result.ok, true);
  assert.equal(result.grossPayPreviewStatus, 'review_required');
  assert.ok(persistedPayload);
  assert.equal(persistedPayload.employeeResults.length, 1);
  assert.equal(persistedPayload.employeeResults[0].weekly_holiday_pending_weeks > 0, true);
  assert.equal(persistedPayload.employeeResults[0].gross_pay_preview, null);
});

test('database candidate forbids non-null employee gross while employee review blockers remain', () => {
  assert.match(integritySql, /Status: CANDIDATE ONLY\. ROLLBACK-ONLY/i);
  assert.match(integritySql.trim(), /rollback;$/i);
  assert.match(integritySql, /payroll_employee_results_partial_gross_withheld_ck/i);
  assert.match(integritySql, /gross_pay_preview is null/i);
  assert.match(integritySql, /rate_status = 'single_rate'/i);
  assert.match(integritySql, /unresolved_count = 0/i);
  assert.match(integritySql, /weekly_holiday_pending_weeks = 0/i);
});
