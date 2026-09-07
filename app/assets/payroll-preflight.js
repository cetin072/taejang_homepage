(function initPayrollPreflight(root, factory) {
  let termValidator = root && root.TaejangPayrollTermValidator;
  if (typeof module !== 'undefined' && module.exports) {
    termValidator = require('./payroll-term-validator.js');
    module.exports = factory(termValidator);
    return;
  }
  if (root) {
    root.TaejangPayrollPreflight = factory(termValidator);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollPreflightFactory(termValidator) {
  'use strict';

  if (!termValidator) throw new Error('TaejangPayrollTermValidator is required.');

  function makeIssue(code, severity, detail = {}) {
    return { code, severity, ...detail };
  }

  function validIsoDate(value) {
    return termValidator.validDate(value);
  }

  function validateEmployees(employees) {
    const issues = [];
    const seen = new Set();

    (employees || []).forEach((employee, index) => {
      const employeeId = String(employee && employee.employeeId || '').trim();
      if (!employeeId) {
        issues.push(makeIssue('employee_id_missing', 'critical', { rowIndex: index }));
        return;
      }
      if (seen.has(employeeId)) {
        issues.push(makeIssue('employee_id_duplicate', 'critical', { employeeId }));
      }
      seen.add(employeeId);

      const hiredAt = employee.hiredAt || employee.hireDate;
      const terminatedAt = employee.terminatedAt || employee.terminationDate || null;
      if (!validIsoDate(hiredAt)) {
        issues.push(makeIssue('employee_hire_date_invalid', 'critical', { employeeId, hiredAt: hiredAt || null }));
      }
      if (terminatedAt && !validIsoDate(terminatedAt)) {
        issues.push(makeIssue('employee_termination_date_invalid', 'critical', { employeeId, terminatedAt }));
      }
      if (validIsoDate(hiredAt) && terminatedAt && validIsoDate(terminatedAt) && terminatedAt < hiredAt) {
        issues.push(makeIssue('employee_period_invalid', 'critical', { employeeId, hiredAt, terminatedAt }));
      }
    });

    return { issues, employeeIds: seen };
  }

  function validateAttendance(attendanceRecords, employeeIds) {
    const issues = [];
    const dayKeys = new Set();
    const sourceKeys = new Set();

    (attendanceRecords || []).forEach((record, index) => {
      const employeeId = String(record && record.employeeId || '').trim();
      const date = String(record && record.date || '').trim();
      const sourceKey = String(record && record.sourceKey || '').trim();

      if (!employeeId || !employeeIds.has(employeeId)) {
        issues.push(makeIssue('attendance_employee_unmatched', 'critical', {
          employeeId: employeeId || null,
          date: date || null,
          rowIndex: index,
        }));
      }
      if (!validIsoDate(date)) {
        issues.push(makeIssue('attendance_date_invalid', 'critical', {
          employeeId: employeeId || null,
          date: date || null,
          rowIndex: index,
        }));
      }

      if (employeeId && validIsoDate(date)) {
        const dayKey = `${employeeId}|${date}`;
        if (dayKeys.has(dayKey)) {
          issues.push(makeIssue('attendance_day_duplicate', 'critical', { employeeId, date }));
        }
        dayKeys.add(dayKey);
      }

      if (sourceKey) {
        if (sourceKeys.has(sourceKey)) {
          issues.push(makeIssue('attendance_source_key_duplicate', 'critical', { sourceKey }));
        }
        sourceKeys.add(sourceKey);
      }

      if (record && record.reviewStatus === 'confirmed') {
        const confirmed = Number(record.confirmedHours);
        if (record.confirmedHours === null || record.confirmedHours === '' || !Number.isFinite(confirmed) || confirmed < 0) {
          issues.push(makeIssue('confirmed_hours_invalid', 'critical', { employeeId, date }));
        }
      }
    });

    return issues;
  }

  function validateTermReferences(terms, employeeIds) {
    return (terms || [])
      .filter((term) => {
        const employeeId = String(term && term.employeeId || '').trim();
        return employeeId && !employeeIds.has(employeeId);
      })
      .map((term) => makeIssue('employment_term_employee_unmatched', 'critical', {
        employeeId: String(term.employeeId).trim(),
      }));
  }

  function validatePayrollInput({ employees, terms, attendanceRecords } = {}) {
    const employeeValidation = validateEmployees(employees || []);
    const termValidation = termValidator.validateEmploymentTerms(terms || []);
    const termIssues = termValidation.issues.map((item) => ({
      ...item,
      severity: item.severity || 'high',
    }));
    const referenceIssues = validateTermReferences(terms || [], employeeValidation.employeeIds);
    const attendanceIssues = validateAttendance(attendanceRecords || [], employeeValidation.employeeIds);

    const issues = [
      ...employeeValidation.issues,
      ...termIssues,
      ...referenceIssues,
      ...attendanceIssues,
    ];
    const criticalCount = issues.filter((item) => item.severity === 'critical').length;
    const highCount = issues.filter((item) => item.severity === 'high').length;

    return {
      ok: issues.length === 0,
      calculationAllowed: criticalCount === 0,
      issueCount: issues.length,
      criticalCount,
      highCount,
      issues,
    };
  }

  function operatorExceptionItems(validation) {
    const labels = {
      employee_id_missing: '직원번호 확인',
      employee_id_duplicate: '중복 직원번호 확인',
      employee_hire_date_invalid: '입사일 확인',
      employee_termination_date_invalid: '퇴사일 확인',
      employee_period_invalid: '입·퇴사일 확인',
      employment_term_overlap: '근로조건 적용기간 겹침 확인',
      employment_term_range_invalid: '근로조건 적용기간 확인',
      employment_term_hours_invalid: '소정근로시간 확인',
      employment_term_rate_missing: '시급 확인',
      employment_term_employee_unmatched: '근로조건 직원 연결 확인',
      attendance_employee_unmatched: '출퇴근 직원 연결 확인',
      attendance_date_invalid: '출퇴근 날짜 확인',
      attendance_day_duplicate: '같은 날 출퇴근 중복 확인',
      attendance_source_key_duplicate: '출퇴근 원본 중복 확인',
      confirmed_hours_invalid: '확정 근로시간 확인',
    };

    return (validation && validation.issues || []).map((item, index) => ({
      id: `preflight-${index + 1}`,
      type: item.code,
      severity: item.severity || 'high',
      employeeId: item.employeeId || null,
      date: item.date || null,
      operatorLabel: labels[item.code] || '급여 기초정보 확인',
      resolved: false,
      detail: item,
    }));
  }

  return Object.freeze({
    validateEmployees,
    validateAttendance,
    validatePayrollInput,
    operatorExceptionItems,
  });
});
