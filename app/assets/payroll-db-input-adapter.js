(function initTaejangPayrollDbInputAdapter(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TaejangPayrollDbInputAdapter = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollDbInputAdapterFactory() {
  'use strict';

  function requiredString(value, code) {
    const normalized = String(value == null ? '' : value).trim();
    if (!normalized) {
      const error = new Error(code);
      error.code = code;
      throw error;
    }
    return normalized;
  }

  function nullableDate(value) {
    if (value == null || value === '') return null;
    return requiredString(value, 'invalid_date_value');
  }

  function numberOrNull(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function mapDecision(row) {
    const decision = String(row.auto_decision || '').trim();
    switch (decision) {
      case 'actual_scheduled':
        return '기록완전';
      case 'paid_leave':
        return '원본_유급월차';
      case 'unpaid_absence':
        return '원본_무급결근';
      case 'paid_holiday':
        return '원본_유급휴일';
      case 'termination':
      case 'out_of_scope':
        return '대상아님';
      case 'confirmed_correction':
        return 'confirmed_correction';
      case 'expected_scheduled':
        return 'expected_scheduled';
      case 'unpaid_holiday':
        return 'unpaid_holiday';
      case 'review_required':
      default:
        return 'review_required';
    }
  }

  function shouldOmitAsProjectedFuture(row, cutoffDate) {
    if (String(row.auto_decision || '') !== 'expected_scheduled') return false;
    if (!cutoffDate || !row.work_date) return false;
    return String(row.work_date) > String(cutoffDate);
  }

  function toEnginePayrollInputs(canonical) {
    if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical)) {
      const error = new Error('invalid_canonical_payroll_input');
      error.code = 'invalid_canonical_payroll_input';
      throw error;
    }

    const payrollMonth = requiredString(canonical.payroll_month, 'payroll_month_required');
    const cutoffDate = requiredString(canonical.cutoff_date, 'cutoff_date_required');
    const monthMatch = payrollMonth.match(/^(\d{4})-(\d{2})-01$/);
    if (!monthMatch) {
      const error = new Error('invalid_payroll_month');
      error.code = 'invalid_payroll_month';
      throw error;
    }

    const employeesSource = Array.isArray(canonical.employees) ? canonical.employees : [];
    const termsSource = Array.isArray(canonical.terms) ? canonical.terms : [];
    const holidaysSource = Array.isArray(canonical.holidays) ? canonical.holidays : [];
    const attendanceSource = Array.isArray(canonical.attendance) ? canonical.attendance : [];
    const uuidToEmployeeId = new Map();
    const seenEmployeeIds = new Set();

    const employees = employeesSource.map((row) => {
      const employeeUuid = requiredString(row.employee_uuid, 'employee_uuid_required');
      const employeeId = requiredString(row.employee_id, 'employee_id_required');
      if (uuidToEmployeeId.has(employeeUuid) || seenEmployeeIds.has(employeeId)) {
        const error = new Error('duplicate_canonical_employee');
        error.code = 'duplicate_canonical_employee';
        throw error;
      }
      uuidToEmployeeId.set(employeeUuid, employeeId);
      seenEmployeeIds.add(employeeId);
      return {
        employeeId,
        hiredAt: nullableDate(row.hired_on),
        terminatedAt: nullableDate(row.departed_on),
      };
    });

    const terms = termsSource.map((row) => {
      const employeeUuid = requiredString(row.employee_uuid, 'term_employee_uuid_required');
      const employeeId = uuidToEmployeeId.get(employeeUuid);
      if (!employeeId) {
        const error = new Error('term_employee_not_canonical');
        error.code = 'term_employee_not_canonical';
        throw error;
      }
      return {
        termId: row.term_id == null ? null : String(row.term_id),
        employeeId,
        effectiveFrom: requiredString(row.effective_from, 'term_effective_from_required'),
        effectiveTo: nullableDate(row.effective_to),
        payType: row.pay_type == null ? null : String(row.pay_type),
        dailyScheduledHours: numberOrNull(row.daily_scheduled_hours),
        hourlyRate: numberOrNull(row.hourly_rate),
        monthlySalary: numberOrNull(row.monthly_salary),
      };
    });

    const holidays = holidaysSource.map((row) => ({
      date: requiredString(row.date, 'holiday_date_required'),
      name: row.name == null ? '' : String(row.name),
      paid: row.paid !== false,
    }));

    const attendanceRecords = [];
    for (const row of attendanceSource) {
      if (shouldOmitAsProjectedFuture(row, cutoffDate)) continue;
      const employeeUuid = row.employee_uuid == null ? null : String(row.employee_uuid);
      const employeeId = employeeUuid ? uuidToEmployeeId.get(employeeUuid) : null;

      if (!employeeId) {
        // Unmatched/ambiguous rows must never be silently assigned. They remain a
        // preflight blocker outside per-employee engine calculation.
        if (String(row.match_status || '') !== 'matched') continue;
        const error = new Error('attendance_employee_not_canonical');
        error.code = 'attendance_employee_not_canonical';
        throw error;
      }

      const record = {
        sourceKey: row.source_key == null ? null : String(row.source_key),
        attendanceRowId: row.attendance_row_id == null ? null : String(row.attendance_row_id),
        employeeId,
        date: requiredString(row.work_date, 'attendance_work_date_required'),
        autoDecision: mapDecision(row),
        reviewStatus: row.review_status == null ? null : String(row.review_status),
        confirmedHours: numberOrNull(row.confirmed_hours),
        matchStatus: row.match_status == null ? null : String(row.match_status),
        recordStatus: row.record_status == null ? null : String(row.record_status),
        exceptionType: row.exception_type == null ? null : String(row.exception_type),
      };

      if (record.autoDecision === 'confirmed_correction') {
        record.reviewStatus = 'confirmed';
      }
      attendanceRecords.push(record);
    }

    return Object.freeze({
      payrollMonth,
      year: Number(monthMatch[1]),
      month: Number(monthMatch[2]),
      cutoffDate,
      acceptedBatchId: canonical.attendance_batches && canonical.attendance_batches.current_batch_id
        ? String(canonical.attendance_batches.current_batch_id)
        : null,
      inputBasisFingerprint: requiredString(
        canonical.input_basis_fingerprint,
        'input_basis_fingerprint_required'
      ),
      priorBoundaryMissing: Boolean(
        canonical.input_window && canonical.input_window.prior_boundary_missing
      ),
      employees,
      terms,
      holidays,
      attendanceRecords,
    });
  }

  return Object.freeze({
    mapDecision,
    shouldOmitAsProjectedFuture,
    toEnginePayrollInputs,
  });
});