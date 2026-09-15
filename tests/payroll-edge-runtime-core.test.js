const test = require('node:test');
const assert = require('node:assert/strict');

const coreApi = require('../prototypes/payroll-backend/edge-runtime/payroll-calculate-core.js');
const adapter = require('../app/assets/payroll-db-input-adapter.js');
const engine = require('../app/assets/payroll-engine.js');
const preflight = require('../app/assets/payroll-preflight.js');
const statutory = require('../app/assets/payroll-statutory-deductions.js');

const employeeUuid = '11111111-1111-4111-8111-111111111111';
const batchId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function cleanCanonical() {
  return {
    payroll_month: '2026-09-01',
    cutoff_date: '2026-09-30',
    input_basis_fingerprint: 'canonical-input-001',
    input_window: {
      boundary_start: '2026-08-31',
      prior_boundary_missing: true,
    },
    attendance_batches: { current_batch_id: batchId, prior_batch_id: null },
    employees: [
      {
        employee_uuid: employeeUuid,
        employee_id: 'TJ-EDGE-0001',
        hired_on: '2026-09-30',
        departed_on: null,
        employment_status: 'active',
      },
    ],
    terms: [
      {
        term_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        employee_uuid: employeeUuid,
        effective_from: '2026-09-30',
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
        attendance_row_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        source_key: 'edge-0930',
        employee_uuid: employeeUuid,
        work_date: '2026-09-30',
        match_status: 'matched',
        record_status: 'complete_actual',
        auto_decision: 'actual_scheduled',
        review_status: 'not_required',
        confirmed_hours: null,
      },
    ],
  };
}

function emptyStatutoryInput() {
  return { payroll_month: '2026-09-01', rate_rules: [], profiles: [] };
}

function completeStatutoryInput() {
  return {
    payroll_month: '2026-09-01',
    rate_rules: [
      { rate_code: 'national_pension', effective_from: '2026-01-01', effective_to: '2026-12-31', employee_rate: 0.0475, rounding_method: 'floor_to_10' },
      { rate_code: 'health_insurance', effective_from: '2026-01-01', effective_to: '2026-12-31', employee_rate: 0.03595, rounding_method: 'floor_to_10' },
      { rate_code: 'long_term_care', effective_from: '2026-01-01', effective_to: '2026-12-31', ratio_numerator: 0.009448, ratio_denominator: 0.0719, rounding_method: 'floor_to_10' },
      { rate_code: 'employment_insurance', effective_from: '2026-01-01', effective_to: '2026-12-31', employee_rate: 0.009, rounding_method: 'floor_to_10' },
    ],
    profiles: [
      {
        employee_uuid: employeeUuid,
        effective_from: '2026-01-01',
        effective_to: null,
        national_pension_status: 'enrolled',
        health_insurance_status: 'enrolled',
        employment_insurance_status: 'enrolled',
        pension_standard_monthly_income: 1000000,
        health_monthly_remuneration: 1000000,
      },
    ],
  };
}

function makeCore({
  canonical = cleanCanonical(),
  actorId = '22222222-2222-4222-8222-222222222222',
  statutoryInput = emptyStatutoryInput(),
} = {}) {
  const calls = { auth: 0, fetch: 0, statutoryFetch: 0, persist: 0, persistedPayload: null };
  const calculate = coreApi.createPayrollCalculateCore({
    authorizeRequest: async () => {
      calls.auth += 1;
      return { actorId };
    },
    fetchCanonicalInput: async (args) => {
      calls.fetch += 1;
      calls.fetchArgs = args;
      return canonical;
    },
    fetchStatutoryInput: async (args) => {
      calls.statutoryFetch += 1;
      calls.statutoryFetchArgs = args;
      return statutoryInput;
    },
    persistTrustedResult: async (payload) => {
      calls.persist += 1;
      calls.persistedPayload = payload;
      return { run_id: '33333333-3333-4333-8333-333333333333' };
    },
    adapter,
    engine,
    preflight,
    statutory,
    calculationVersion: 'payroll-engine-7day-test-v1',
    now: () => '2026-09-30T12:00:00.000Z',
  });
  return { calculate, calls };
}

test('browser cannot submit authoritative payroll totals or result fields', async () => {
  const { calculate, calls } = makeCore();
  await assert.rejects(
    () => calculate({
      payroll_month: '2026-09-01',
      cutoff_date: '2026-09-30',
      accepted_import_batch_id: batchId,
      gross_pay_preview: 999999999,
    }),
    (error) => error && error.code === 'unsupported_payroll_request_field'
  );
  assert.equal(calls.auth, 0);
  assert.equal(calls.fetch, 0);
  assert.equal(calls.statutoryFetch, 0);
  assert.equal(calls.persist, 0);
});

test('authenticated actor identity comes from authorization boundary, not request payload', async () => {
  const actorId = '22222222-2222-4222-8222-222222222222';
  const { calculate, calls } = makeCore({ actorId });
  await calculate({
    payroll_month: '2026-09-01',
    cutoff_date: '2026-09-30',
    accepted_import_batch_id: batchId,
  });
  assert.equal(calls.fetchArgs.actorId, actorId);
  assert.equal(calls.statutoryFetchArgs.actorId, actorId);
  assert.equal(calls.persistedPayload.actorId, actorId);
});

test('missing authorized actor fails before canonical payroll is read or persisted', async () => {
  const { calculate, calls } = makeCore({ actorId: '' });
  await assert.rejects(
    () => calculate({
      payroll_month: '2026-09-01',
      cutoff_date: '2026-09-30',
      accepted_import_batch_id: batchId,
    }),
    (error) => error && error.code === 'payroll_actor_required'
  );
  assert.equal(calls.fetch, 0);
  assert.equal(calls.statutoryFetch, 0);
  assert.equal(calls.persist, 0);
});

test('clean canonical input keeps gross ready while missing statutory profile is review-only', async () => {
  const { calculate, calls } = makeCore();
  const result = await calculate({
    payroll_month: '2026-09-01',
    cutoff_date: '2026-09-30',
    accepted_import_batch_id: batchId,
  });

  assert.equal(result.ok, true);
  assert.equal(result.persisted, true);
  assert.equal(result.runId, '33333333-3333-4333-8333-333333333333');
  assert.equal(result.employeeCount, 1);
  assert.equal(result.unresolvedItemCount, 0);
  assert.equal(result.rateReviewCount, 0);
  assert.equal(result.statutoryReviewCount, 1);
  assert.equal(result.grossPayPreviewStatus, 'complete');
  assert.equal(result.grossPayPreview, 30960);
  assert.equal(calls.persist, 1);

  const payload = calls.persistedPayload;
  assert.equal(payload.expectedInputBasisFingerprint, 'canonical-input-001');
  assert.equal(payload.expectedBatchId, batchId);
  assert.equal(payload.calculationVersion, 'payroll-engine-7day-test-v1');
  assert.equal(payload.employeeResults.length, 1);
  assert.equal(payload.employeeResults[0].employee_uuid, employeeUuid);
  assert.equal(payload.employeeResults[0].gross_pay_preview, 30960);
  assert.equal(payload.employeeResults[0].calculation_detail.statutory.status, 'review_required');
  assert.deepEqual(payload.employeeResults[0].calculation_detail.statutory.reasons, ['statutory_profile_missing']);
});

test('complete statutory input is persisted only as compact deduction amounts and net preview', async () => {
  const { calculate, calls } = makeCore({ statutoryInput: completeStatutoryInput() });
  const result = await calculate({
    payroll_month: '2026-09-01',
    cutoff_date: '2026-09-30',
    accepted_import_batch_id: batchId,
  });

  assert.equal(result.statutoryReviewCount, 0);
  const summary = calls.persistedPayload.employeeResults[0].calculation_detail.statutory;
  assert.equal(summary.status, 'complete');
  assert.equal(summary.nps, 47500);
  assert.equal(summary.nhi, 35950);
  assert.equal(summary.ei, 270);
  assert.equal(summary.total, summary.nps + summary.nhi + summary.ltc + summary.ei);
  assert.equal(summary.net, 30960 - summary.total);
  assert.deepEqual(summary.reasons, []);
});

test('unmatched canonical attendance becomes review work and is never persisted as a payroll run', async () => {
  const canonical = cleanCanonical();
  canonical.attendance.push({
    attendance_row_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    source_key: 'edge-ambiguous',
    employee_uuid: null,
    work_date: '2026-09-29',
    match_status: 'ambiguous',
    record_status: 'review_required',
    auto_decision: 'review_required',
    review_status: 'pending',
    confirmed_hours: null,
    exception_type: '동명이인',
  });

  const { calculate, calls } = makeCore({ canonical });
  const result = await calculate({
    payroll_month: '2026-09-01',
    cutoff_date: '2026-09-30',
    accepted_import_batch_id: batchId,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'review_required');
  assert.equal(result.persisted, false);
  assert.equal(result.blockers.some((item) => item.code === 'attendance_employee_match_required'), true);
  assert.equal(calls.statutoryFetch, 0);
  assert.equal(calls.persist, 0);
});

test('missing prior boundary makes weekly holiday pending and company gross is withheld', async () => {
  const canonical = {
    payroll_month: '2026-09-01',
    cutoff_date: '2026-09-01',
    input_basis_fingerprint: 'canonical-input-boundary',
    input_window: { boundary_start: '2026-08-31', prior_boundary_missing: true },
    attendance_batches: { current_batch_id: batchId, prior_batch_id: null },
    employees: [
      {
        employee_uuid: employeeUuid,
        employee_id: 'TJ-EDGE-0001',
        hired_on: '2026-06-09',
        departed_on: null,
        employment_status: 'active',
      },
    ],
    terms: [
      {
        term_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        employee_uuid: employeeUuid,
        effective_from: '2026-06-09',
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
        attendance_row_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        source_key: 'edge-0901',
        employee_uuid: employeeUuid,
        work_date: '2026-09-01',
        match_status: 'matched',
        record_status: 'complete_actual',
        auto_decision: 'actual_scheduled',
        review_status: 'not_required',
        confirmed_hours: null,
      },
    ],
  };

  const { calculate, calls } = makeCore({ canonical });
  const result = await calculate({
    payroll_month: '2026-09-01',
    cutoff_date: '2026-09-01',
    accepted_import_batch_id: batchId,
  });

  assert.equal(result.ok, true);
  assert.equal(result.persisted, true);
  assert.ok(result.unresolvedItemCount >= 1);
  assert.equal(result.grossPayPreviewStatus, 'review_required');
  assert.equal(result.grossPayPreview, null);
  assert.equal(calls.persistedPayload.grossPayPreview, null);
  assert.equal(calls.persistedPayload.grossPayPreviewStatus, 'review_required');
});

test('accepted batch mismatch fails closed before calculation persistence', async () => {
  const canonical = cleanCanonical();
  canonical.attendance_batches.current_batch_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const { calculate, calls } = makeCore({ canonical });
  await assert.rejects(
    () => calculate({
      payroll_month: '2026-09-01',
      cutoff_date: '2026-09-30',
      accepted_import_batch_id: batchId,
    }),
    (error) => error && error.code === 'payroll_attendance_batch_stale'
  );
  assert.equal(calls.statutoryFetch, 0);
  assert.equal(calls.persist, 0);
});

test('persistence payload contains no employee names, raw clocks or protected identity fields', async () => {
  const { calculate, calls } = makeCore();
  await calculate({
    payroll_month: '2026-09-01',
    cutoff_date: '2026-09-30',
    accepted_import_batch_id: batchId,
  });
  const serialized = JSON.stringify(calls.persistedPayload);
  assert.doesNotMatch(serialized, /display_name|full_name|resident|registration|disability|consultation|bank_account|clock_in|clock_out/i);
});