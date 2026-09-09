(function initPayrollCalculateCore(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) root.TaejangPayrollCalculateCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollCalculateCoreFactory() {
  'use strict';

  const ALLOWED_REQUEST_KEYS = new Set([
    'payroll_month',
    'cutoff_date',
    'accepted_import_batch_id',
    'request_id',
  ]);

  function fail(code, detail = null) {
    const error = new Error(code);
    error.code = code;
    if (detail) error.detail = detail;
    throw error;
  }

  function validateRequest(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      fail('invalid_payroll_calculation_request');
    }
    for (const key of Object.keys(input)) {
      if (!ALLOWED_REQUEST_KEYS.has(key)) {
        fail('unsupported_payroll_request_field', { field: key });
      }
    }
    const payrollMonth = String(input.payroll_month || '').trim();
    const cutoffDate = String(input.cutoff_date || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(payrollMonth)) fail('invalid_payroll_month');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)) fail('invalid_payroll_cutoff_date');
    if (!cutoffDate.startsWith(payrollMonth.slice(0, 8))) fail('payroll_cutoff_outside_month');
    const acceptedBatchId = String(input.accepted_import_batch_id || '').trim();
    if (!acceptedBatchId) fail('accepted_import_batch_id_required');
    const requestId = input.request_id == null ? null : String(input.request_id).trim();
    if (requestId && requestId.length > 160) fail('invalid_payroll_request_id');
    return Object.freeze({ payrollMonth, cutoffDate, acceptedBatchId, requestId });
  }

  function makeEngineResultRow(employee, result) {
    const unresolvedCount = Number(result.unresolvedCount || 0);
    const weeklyHolidayPendingWeeks = Number(result.weeklyHolidayPendingWeeks || 0);
    const rateStatus = result.rateStatus;
    const employeeGrossReady = unresolvedCount === 0
      && weeklyHolidayPendingWeeks === 0
      && rateStatus === 'single_rate';

    return {
      employee_uuid: employee.employeeUuid,
      actual_work_hours: Number(result.actualWorkHours || 0),
      expected_work_hours: Number(result.expectedWorkHours || 0),
      paid_holiday_hours: Number(result.paidHolidayHours || 0),
      weekly_holiday_actual_hours: Number(result.weeklyHolidayActualHours || 0),
      weekly_holiday_expected_hours: Number(result.weeklyHolidayExpectedHours || 0),
      weekly_holiday_pending_weeks: weeklyHolidayPendingWeeks,
      unresolved_count: unresolvedCount,
      payable_hours_preview: Number(result.payableHoursPreview || 0),
      hourly_rate: result.hourlyRate == null ? null : Number(result.hourlyRate),
      gross_pay_preview: employeeGrossReady && result.grossPayPreview != null
        ? Number(result.grossPayPreview)
        : null,
      rate_status: rateStatus,
      calculation_detail: {
        weekly_holiday_statuses: Array.isArray(result.weeklyHoliday && result.weeklyHoliday.weeks)
          ? result.weeklyHoliday.weeks.map((week) => ({
              week_start: week.weekStart || null,
              status: week.status || null,
              payable_hours: week.payableHours == null ? null : Number(week.payableHours),
            }))
          : [],
        unresolved_reasons: Array.isArray(result.unresolved)
          ? result.unresolved.map((item) => ({ date: item.date || null, reason: item.reason || null }))
          : [],
      },
    };
  }

  function createPayrollCalculateCore({
    authorizeRequest,
    fetchCanonicalInput,
    persistTrustedResult,
    adapter,
    engine,
    preflight,
    calculationVersion = 'payroll-engine-7day-v1',
    now = () => new Date().toISOString(),
  } = {}) {
    if (typeof authorizeRequest !== 'function') fail('authorize_request_dependency_required');
    if (typeof fetchCanonicalInput !== 'function') fail('fetch_canonical_input_dependency_required');
    if (typeof persistTrustedResult !== 'function') fail('persist_trusted_result_dependency_required');
    if (!adapter || typeof adapter.toEnginePayrollInputs !== 'function') fail('payroll_db_adapter_required');
    if (!engine || typeof engine.calculateProvisionalMonth !== 'function') fail('payroll_engine_required');
    if (!preflight || typeof preflight.validatePayrollInput !== 'function') fail('payroll_preflight_required');

    return async function calculate(requestInput, authContext = {}) {
      const request = validateRequest(requestInput);
      const auth = await authorizeRequest(authContext);
      const actorId = auth && auth.actorId ? String(auth.actorId) : '';
      if (!actorId) fail('payroll_actor_required');

      const canonical = await fetchCanonicalInput({
        actorId,
        payrollMonth: request.payrollMonth,
        cutoffDate: request.cutoffDate,
        acceptedBatchId: request.acceptedBatchId,
      });

      const mapped = adapter.toEnginePayrollInputs(canonical);
      if (mapped.acceptedBatchId !== request.acceptedBatchId) {
        fail('payroll_attendance_batch_stale');
      }

      const preflightResult = preflight.validatePayrollInput({
        month: mapped.payrollMonth.slice(0, 7),
        employees: mapped.employees,
        terms: mapped.terms,
        attendanceRecords: mapped.attendanceRecords,
        cutoffDate: mapped.cutoffDate,
        holidays: mapped.holidays,
      });

      const adapterBlockers = Array.isArray(mapped.inputBlockers) ? mapped.inputBlockers : [];
      if (!preflightResult.calculationAllowed || adapterBlockers.length > 0) {
        return Object.freeze({
          ok: false,
          status: 'review_required',
          persisted: false,
          criticalCount: Number(preflightResult.criticalCount || 0) + adapterBlockers.length,
          blockers: Object.freeze([
            ...adapterBlockers.map((item) => ({ code: item.code, date: item.date || null })),
            ...preflightResult.issues
              .filter((item) => item.severity === 'critical')
              .map((item) => ({ code: item.code, date: item.date || null })),
          ]),
        });
      }

      const canonicalEmployeesById = new Map(
        (Array.isArray(canonical.employees) ? canonical.employees : []).map((row) => [
          String(row.employee_id),
          { employeeUuid: String(row.employee_uuid), employeeId: String(row.employee_id) },
        ])
      );

      const employeeResults = [];
      let unresolvedItemCount = 0;
      let rateReviewCount = 0;
      let payableHoursPreview = 0;
      let grossPayPreview = 0;

      for (const employee of mapped.employees) {
        const result = engine.calculateProvisionalMonth({
          employee,
          year: mapped.year,
          month: mapped.month,
          cutoffDate: mapped.cutoffDate,
          terms: mapped.terms,
          holidays: mapped.holidays,
          attendanceRecords: mapped.attendanceRecords,
        });
        const canonicalEmployee = canonicalEmployeesById.get(employee.employeeId);
        if (!canonicalEmployee) fail('payroll_result_employee_mapping_missing');

        unresolvedItemCount += Number(result.unresolvedCount || 0);
        unresolvedItemCount += Number(result.weeklyHolidayPendingWeeks || 0);
        if (result.rateStatus !== 'single_rate') rateReviewCount += 1;
        payableHoursPreview += Number(result.payableHoursPreview || 0);

        const persistedEmployeeResult = makeEngineResultRow(canonicalEmployee, result);
        if (persistedEmployeeResult.gross_pay_preview != null) {
          grossPayPreview += Number(persistedEmployeeResult.gross_pay_preview);
        }
        employeeResults.push(persistedEmployeeResult);
      }

      const grossPayPreviewStatus = unresolvedItemCount === 0 && rateReviewCount === 0
        ? 'complete'
        : 'review_required';
      const companyGrossPayPreview = grossPayPreviewStatus === 'complete' ? grossPayPreview : null;

      const persistenceResult = await persistTrustedResult({
        actorId,
        payrollMonth: mapped.payrollMonth,
        cutoffDate: mapped.cutoffDate,
        expectedBatchId: mapped.acceptedBatchId,
        expectedInputBasisFingerprint: mapped.inputBasisFingerprint,
        calculationVersion,
        generatedAt: now(),
        employeeCount: employeeResults.length,
        unresolvedItemCount,
        rateReviewCount,
        grossPayPreview: companyGrossPayPreview,
        grossPayPreviewStatus,
        payableHoursPreview,
        employeeResults,
      });

      return Object.freeze({
        ok: true,
        status: grossPayPreviewStatus === 'complete' ? 'provisional_ready' : 'review_required',
        persisted: true,
        runId: persistenceResult && persistenceResult.run_id ? persistenceResult.run_id : null,
        employeeCount: employeeResults.length,
        unresolvedItemCount,
        rateReviewCount,
        grossPayPreviewStatus,
        grossPayPreview: companyGrossPayPreview,
      });
    };
  }

  return Object.freeze({
    ALLOWED_REQUEST_KEYS,
    validateRequest,
    createPayrollCalculateCore,
  });
});