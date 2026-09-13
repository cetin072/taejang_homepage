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

  function monthEndKey(payrollMonth) {
    const year = Number(payrollMonth.slice(0, 4));
    const month = Number(payrollMonth.slice(5, 7));
    const end = new Date(year, month, 0, 12, 0, 0, 0);
    return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  }

  function monthlyReviewResult(employee, year, month, reason, monthlySalary = null) {
    return {
      employeeId: employee.employeeId,
      year,
      month,
      actualWorkHours: 0,
      expectedWorkHours: 0,
      paidHolidayHours: 0,
      weeklyHolidayActualHours: 0,
      weeklyHolidayExpectedHours: 0,
      weeklyHolidayPendingWeeks: 0,
      unresolvedCount: 1,
      unresolved: [{ date: null, reason }],
      payableHoursPreview: 0,
      hourlyRate: null,
      monthlySalary,
      grossPayPreview: null,
      rateStatus: 'monthly_salary_review_required',
      payType: 'monthly',
      dayRows: [],
      weeklyHoliday: {
        employeeId: employee.employeeId,
        year,
        month,
        weeks: [],
        actualHours: 0,
        expectedHours: 0,
        pendingWeeks: 0,
      },
    };
  }

  function calculateMonthlySalaryResult({ employee, year, month, terms, attendanceRecords }) {
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = monthEndKey(monthStart);
    const employeeTerms = (Array.isArray(terms) ? terms : [])
      .filter((term) => String(term.employeeId || '') === String(employee.employeeId))
      .filter((term) => String(term.effectiveFrom || '') <= monthEnd)
      .filter((term) => !term.effectiveTo || String(term.effectiveTo) >= monthStart);
    const monthlyTerms = employeeTerms.filter((term) => String(term.payType || '').trim().toLowerCase() === 'monthly');

    if (monthlyTerms.length === 0) return null;

    const hiredAt = String(employee.hiredAt || employee.hireDate || '');
    const terminatedAt = employee.terminatedAt || employee.terminationDate;
    if (!hiredAt || hiredAt > monthStart || (terminatedAt && String(terminatedAt) < monthEnd)) {
      return monthlyReviewResult(employee, year, month, 'monthly_salary_partial_relationship_review_required');
    }

    if (employeeTerms.length !== 1 || monthlyTerms.length !== 1) {
      return monthlyReviewResult(employee, year, month, 'monthly_salary_term_change_review_required');
    }

    const term = monthlyTerms[0];
    if (String(term.effectiveFrom || '') > monthStart || (term.effectiveTo && String(term.effectiveTo) < monthEnd)) {
      return monthlyReviewResult(employee, year, month, 'monthly_salary_partial_term_review_required');
    }

    const monthlySalary = Number(term.monthlySalary);
    if (!Number.isFinite(monthlySalary) || monthlySalary <= 0) {
      return monthlyReviewResult(employee, year, month, 'monthly_salary_missing_review_required');
    }

    const salaryImpactAttendance = (Array.isArray(attendanceRecords) ? attendanceRecords : [])
      .filter((record) => record && String(record.employeeId || '') === String(employee.employeeId))
      .filter((record) => record.date && String(record.date) >= monthStart && String(record.date) <= monthEnd)
      .find((record) => {
        const decision = String(record.autoDecision || '').trim();
        return decision === 'review_required'
          || decision === 'confirmed_correction'
          || decision === '원본_무급결근'
          || /결근/.test(decision);
      });

    if (salaryImpactAttendance) {
      return monthlyReviewResult(
        employee,
        year,
        month,
        'monthly_salary_attendance_adjustment_review_required',
        monthlySalary
      );
    }

    return {
      employeeId: employee.employeeId,
      year,
      month,
      actualWorkHours: 0,
      expectedWorkHours: 0,
      paidHolidayHours: 0,
      weeklyHolidayActualHours: 0,
      weeklyHolidayExpectedHours: 0,
      weeklyHolidayPendingWeeks: 0,
      unresolvedCount: 0,
      unresolved: [],
      payableHoursPreview: 0,
      hourlyRate: null,
      monthlySalary,
      grossPayPreview: monthlySalary,
      rateStatus: 'monthly_salary',
      payType: 'monthly',
      dayRows: [],
      weeklyHoliday: {
        employeeId: employee.employeeId,
        year,
        month,
        weeks: [],
        actualHours: 0,
        expectedHours: 0,
        pendingWeeks: 0,
      },
    };
  }

  function selectFullMonthProfile(statutoryInput, employeeUuid, payrollMonth) {
    const monthEnd = monthEndKey(payrollMonth);
    const rows = (Array.isArray(statutoryInput && statutoryInput.profiles) ? statutoryInput.profiles : [])
      .filter((row) => String(row.employee_uuid || row.employeeUuid || '') === String(employeeUuid));
    if (rows.length !== 1) {
      return { profile: null, reason: rows.length === 0 ? 'statutory_profile_missing' : 'statutory_profile_overlap_review_required' };
    }
    const row = rows[0];
    const effectiveFrom = String(row.effective_from || row.effectiveFrom || '');
    const effectiveTo = row.effective_to || row.effectiveTo;
    if (!effectiveFrom || effectiveFrom > payrollMonth || (effectiveTo && String(effectiveTo) < monthEnd)) {
      return { profile: null, reason: 'statutory_profile_partial_month_review_required' };
    }
    return { profile: row, reason: null };
  }

  function summarizeStatutory(result, grossPayPreview) {
    if (!result || result.status !== 'complete') {
      return {
        status: 'review_required',
        nps: null,
        nhi: null,
        ltc: null,
        ei: null,
        total: null,
        net: null,
        reasons: result && Array.isArray(result.unresolvedReasons) ? result.unresolvedReasons : ['statutory_review_required'],
      };
    }
    const amountByCode = new Map((result.rows || []).map((row) => [row.code, Number(row.amount || 0)]));
    const total = Number(result.totalEmployeeDeduction || 0);
    return {
      status: 'complete',
      nps: amountByCode.get('national_pension') || 0,
      nhi: amountByCode.get('health_insurance') || 0,
      ltc: amountByCode.get('long_term_care') || 0,
      ei: amountByCode.get('employment_insurance') || 0,
      total,
      net: Number(grossPayPreview) - total,
      reasons: [],
    };
  }

  function makeEngineResultRow(employee, result, statutorySummary) {
    const unresolvedCount = Number(result.unresolvedCount || 0);
    const weeklyHolidayPendingWeeks = Number(result.weeklyHolidayPendingWeeks || 0);
    const rateStatus = result.rateStatus;
    const employeeGrossReady = unresolvedCount === 0
      && weeklyHolidayPendingWeeks === 0
      && (rateStatus === 'single_rate' || rateStatus === 'monthly_salary');
    const payType = result.payType === 'monthly' ? 'monthly' : 'hourly';

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
        pay_type: payType,
        monthly_salary: payType === 'monthly' && result.monthlySalary != null
          ? Number(result.monthlySalary)
          : null,
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
        statutory: statutorySummary,
      },
    };
  }

  function createPayrollCalculateCore({
    authorizeRequest,
    fetchCanonicalInput,
    fetchStatutoryInput = async () => ({ rate_rules: [], profiles: [] }),
    persistTrustedResult,
    adapter,
    engine,
    preflight,
    statutory = null,
    calculationVersion = 'payroll-engine-7day-monthly-v1',
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

      const statutoryInput = await fetchStatutoryInput({
        actorId,
        payrollMonth: request.payrollMonth,
      });
      const statutoryRateRules = Array.isArray(statutoryInput && statutoryInput.rate_rules)
        ? statutoryInput.rate_rules
        : [];

      const canonicalEmployeesById = new Map(
        (Array.isArray(canonical.employees) ? canonical.employees : []).map((row) => [
          String(row.employee_id),
          { employeeUuid: String(row.employee_uuid), employeeId: String(row.employee_id) },
        ])
      );

      const employeeResults = [];
      let unresolvedItemCount = 0;
      let rateReviewCount = 0;
      let statutoryReviewCount = 0;
      let payableHoursPreview = 0;
      let grossPayPreview = 0;

      for (const employee of mapped.employees) {
        const monthlyResult = calculateMonthlySalaryResult({
          employee,
          year: mapped.year,
          month: mapped.month,
          terms: mapped.terms,
          attendanceRecords: mapped.attendanceRecords,
        });
        const result = monthlyResult || engine.calculateProvisionalMonth({
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
        if (result.rateStatus !== 'single_rate' && result.rateStatus !== 'monthly_salary') rateReviewCount += 1;
        payableHoursPreview += Number(result.payableHoursPreview || 0);

        const baseRow = makeEngineResultRow(canonicalEmployee, result, null);
        let statutorySummary;
        if (baseRow.gross_pay_preview == null) {
          statutorySummary = {
            status: 'review_required', nps: null, nhi: null, ltc: null, ei: null,
            total: null, net: null, reasons: ['gross_not_ready'],
          };
        } else {
          const selected = selectFullMonthProfile(statutoryInput, canonicalEmployee.employeeUuid, request.payrollMonth);
          if (!selected.profile) {
            statutorySummary = {
              status: 'review_required', nps: null, nhi: null, ltc: null, ei: null,
              total: null, net: null, reasons: [selected.reason],
            };
          } else if (!statutory || typeof statutory.calculateStatutoryDeductions !== 'function') {
            statutorySummary = {
              status: 'review_required', nps: null, nhi: null, ltc: null, ei: null,
              total: null, net: null, reasons: ['statutory_engine_unavailable'],
            };
          } else {
            const statutoryResult = statutory.calculateStatutoryDeductions({
              payrollMonth: request.payrollMonth,
              taxableRemuneration: baseRow.gross_pay_preview,
              profile: selected.profile,
              rateRules: statutoryRateRules,
            });
            statutorySummary = summarizeStatutory(statutoryResult, baseRow.gross_pay_preview);
          }
        }
        if (statutorySummary.status !== 'complete') statutoryReviewCount += 1;

        const persistedEmployeeResult = makeEngineResultRow(canonicalEmployee, result, statutorySummary);
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
        statutoryReviewCount,
        grossPayPreviewStatus,
        grossPayPreview: companyGrossPayPreview,
      });
    };
  }

  return Object.freeze({
    ALLOWED_REQUEST_KEYS,
    validateRequest,
    calculateMonthlySalaryResult,
    createPayrollCalculateCore,
  });
});
