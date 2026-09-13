(function initPayrollLedgerValidator(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaejangPayrollLedgerValidator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollLedgerValidatorFactory() {
  'use strict';

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function roundedWon(value) {
    const number = finite(value);
    return number === null ? null : Math.round(number);
  }

  function issue(code, employee, severity = 'error') {
    return Object.freeze({
      code,
      severity,
      employeeId: employee?.employee_id || null,
      employeeUuid: employee?.employee_uuid || null,
    });
  }

  function validatePayrollLedgerContext(context) {
    const employees = Array.isArray(context?.employees) ? context.employees : [];
    const errors = [];
    const warnings = [];
    const ids = new Set();
    const uuids = new Set();

    const runEmployeeCount = Number(context?.latest_run?.employee_count);
    if (Number.isFinite(runEmployeeCount) && runEmployeeCount !== employees.length) {
      errors.push(Object.freeze({ code: 'employee_count_mismatch', severity: 'error', expected: runEmployeeCount, actual: employees.length }));
    }

    for (const employee of employees) {
      const employeeId = String(employee?.employee_id || '').trim();
      const employeeUuid = String(employee?.employee_uuid || '').trim();
      if (!employeeId) errors.push(issue('employee_id_missing', employee));
      else if (ids.has(employeeId)) errors.push(issue('employee_id_duplicate', employee));
      else ids.add(employeeId);

      if (employeeUuid) {
        if (uuids.has(employeeUuid)) errors.push(issue('employee_uuid_duplicate', employee));
        else uuids.add(employeeUuid);
      }

      const gross = roundedWon(employee?.gross_pay_preview);
      const deduction = roundedWon(employee?.statutory_deduction_preview);
      const net = roundedWon(employee?.net_pay_preview);
      if (gross !== null && deduction !== null && net !== null && gross - deduction !== net) {
        errors.push(issue('net_pay_arithmetic_mismatch', employee));
      }

      const readyRate = employee?.rate_status === 'single_rate' || employee?.rate_status === 'monthly_salary';
      if (!readyRate && Number(employee?.unresolved_count || 0) === 0) {
        warnings.push(issue('pay_rate_review_required', employee, 'warning'));
      }

      if (employee?.rate_status === 'single_rate') {
        const attendanceDays = employee?.attendance_days && typeof employee.attendance_days === 'object'
          ? Object.keys(employee.attendance_days).length
          : 0;
        if (attendanceDays === 0 && Number(employee?.actual_work_hours || 0) > 0) {
          warnings.push(issue('attendance_detail_missing_for_hourly_employee', employee, 'warning'));
        }
      }

      if (gross !== null && deduction === null && employee?.deduction_source !== 'historical_as_paid') {
        warnings.push(issue('deduction_not_ready', employee, 'warning'));
      }
    }

    const status = errors.length > 0 ? 'error' : warnings.length > 0 ? 'review' : 'ok';
    return Object.freeze({
      status,
      employeeCount: employees.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      issues: Object.freeze([...errors, ...warnings]),
    });
  }

  function summaryText(result) {
    if (!result) return '급여대장 검증 전';
    if (result.status === 'ok') return `급여대장 검증 정상 · ${result.employeeCount}명`;
    if (result.status === 'error') return `급여대장 오류 ${result.errorCount}건 · 확인 필요`;
    return `급여대장 주의 ${result.warningCount}건 · 확인 필요`;
  }

  return Object.freeze({ validatePayrollLedgerContext, summaryText });
});
