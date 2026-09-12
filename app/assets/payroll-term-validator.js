(function initPayrollTermValidator(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TaejangPayrollTermValidator = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollTermValidatorFactory() {
  'use strict';

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const CRITICAL_CODES = new Set([
    'employment_term_employee_missing',
    'employment_term_start_invalid',
    'employment_term_end_invalid',
    'employment_term_range_invalid',
    'employment_term_overlap',
    'employment_term_hours_invalid',
    'employment_term_rate_missing',
    'employment_term_monthly_salary_missing',
  ]);

  function validDate(value) {
    if (!ISO_DATE.test(String(value || ''))) return false;
    const [year, month, day] = String(value).split('-').map(Number);
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function normalizeEmployeeId(value) {
    return String(value || '').trim();
  }

  function issue(code, employeeId, detail = {}) {
    return {
      code,
      employeeId: employeeId || null,
      severity: CRITICAL_CODES.has(code) ? 'critical' : 'high',
      ...detail,
    };
  }

  function validateRow(term, index) {
    const employeeId = normalizeEmployeeId(term && term.employeeId);
    const issues = [];
    if (!employeeId) {
      issues.push(issue('employment_term_employee_missing', null, { rowIndex: index }));
      return issues;
    }

    if (!validDate(term.effectiveFrom)) {
      issues.push(issue('employment_term_start_invalid', employeeId, {
        rowIndex: index,
        effectiveFrom: term.effectiveFrom || null,
      }));
    }

    if (term.effectiveTo && !validDate(term.effectiveTo)) {
      issues.push(issue('employment_term_end_invalid', employeeId, {
        rowIndex: index,
        effectiveTo: term.effectiveTo,
      }));
    }

    if (
      validDate(term.effectiveFrom)
      && term.effectiveTo
      && validDate(term.effectiveTo)
      && term.effectiveTo < term.effectiveFrom
    ) {
      issues.push(issue('employment_term_range_invalid', employeeId, {
        rowIndex: index,
        effectiveFrom: term.effectiveFrom,
        effectiveTo: term.effectiveTo,
      }));
    }

    const payType = String(term && term.payType || '').trim().toLowerCase();
    if (payType === 'monthly') {
      const monthlySalary = Number(term.monthlySalary);
      if (term.monthlySalary === null || term.monthlySalary === '' || !Number.isFinite(monthlySalary) || monthlySalary <= 0) {
        issues.push(issue('employment_term_monthly_salary_missing', employeeId, { rowIndex: index }));
      }
      return issues;
    }

    const hours = Number(term.dailyScheduledHours);
    if (term.dailyScheduledHours === null || term.dailyScheduledHours === '' || !Number.isFinite(hours) || hours < 0) {
      issues.push(issue('employment_term_hours_invalid', employeeId, { rowIndex: index }));
    }

    const rate = Number(term.hourlyRate);
    if (term.hourlyRate === null || term.hourlyRate === '' || !Number.isFinite(rate) || rate <= 0) {
      issues.push(issue('employment_term_rate_missing', employeeId, { rowIndex: index }));
    }

    return issues;
  }

  function rangesOverlap(left, right) {
    if (!validDate(left.effectiveFrom) || !validDate(right.effectiveFrom)) return false;
    if (left.effectiveTo && !validDate(left.effectiveTo)) return false;
    if (right.effectiveTo && !validDate(right.effectiveTo)) return false;

    const leftEnd = left.effectiveTo || '9999-12-31';
    const rightEnd = right.effectiveTo || '9999-12-31';
    return left.effectiveFrom <= rightEnd && right.effectiveFrom <= leftEnd;
  }

  function validateEmploymentTerms(terms) {
    const rows = Array.isArray(terms) ? terms : [];
    const issues = rows.flatMap((term, index) => validateRow(term || {}, index));
    const byEmployee = new Map();

    rows.forEach((term, index) => {
      const employeeId = normalizeEmployeeId(term && term.employeeId);
      if (!employeeId) return;
      const current = byEmployee.get(employeeId) || [];
      current.push({ ...term, rowIndex: index });
      byEmployee.set(employeeId, current);
    });

    for (const [employeeId, employeeTerms] of byEmployee.entries()) {
      const sorted = employeeTerms
        .filter((term) => validDate(term.effectiveFrom))
        .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

      for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
          const left = sorted[leftIndex];
          const right = sorted[rightIndex];
          if (!rangesOverlap(left, right)) continue;
          issues.push(issue('employment_term_overlap', employeeId, {
            leftRowIndex: left.rowIndex,
            rightRowIndex: right.rowIndex,
            leftFrom: left.effectiveFrom,
            leftTo: left.effectiveTo || null,
            rightFrom: right.effectiveFrom,
            rightTo: right.effectiveTo || null,
          }));
        }
      }
    }

    const counts = issues.reduce((result, item) => {
      result[item.code] = (result[item.code] || 0) + 1;
      return result;
    }, {});

    return {
      ok: issues.length === 0,
      issueCount: issues.length,
      issues,
      counts,
    };
  }

  function issuesForEmployee(validation, employeeId) {
    return (validation && validation.issues || []).filter((item) => item.employeeId === employeeId);
  }

  return Object.freeze({
    validDate,
    rangesOverlap,
    validateEmploymentTerms,
    issuesForEmployee,
  });
});
