(function initTaejangPayrollStatutoryDeductions(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaejangPayrollStatutoryDeductions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollStatutoryDeductionsFactory() {
  'use strict';

  function asDate(value) {
    if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0);
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new Error(`Invalid ISO date: ${value}`);
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  }

  function dateKey(value) {
    const date = asDate(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function monthBounds(payrollMonth) {
    const start = asDate(payrollMonth);
    if (start.getDate() !== 1) throw new Error('payrollMonth must be first day of month');
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 12, 0, 0, 0);
    return { start, end };
  }

  function compareDate(a, b) {
    return dateKey(a).localeCompare(dateKey(b));
  }

  function isInsideMonth(value, bounds) {
    if (!value) return false;
    return compareDate(value, bounds.start) >= 0 && compareDate(value, bounds.end) <= 0;
  }

  function selectRateRule(rateCode, payrollMonth, rateRules) {
    const target = dateKey(payrollMonth);
    return (rateRules || [])
      .filter((rule) => rule.rateCode === rateCode || rule.rate_code === rateCode)
      .filter((rule) => dateKey(rule.effectiveFrom || rule.effective_from) <= target)
      .filter((rule) => !rule.effectiveTo && !rule.effective_to
        ? true
        : dateKey(rule.effectiveTo || rule.effective_to) >= target)
      .sort((a, b) => dateKey(b.effectiveFrom || b.effective_from).localeCompare(dateKey(a.effectiveFrom || a.effective_from)))[0] || null;
  }

  function applyRounding(value, method) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return null;
    const unit = method && method.endsWith('_to_10') ? 10 : 1;
    if (method && method.startsWith('floor_')) return Math.floor(amount / unit) * unit;
    if (method && method.startsWith('round_')) return Math.round(amount / unit) * unit;
    if (method && method.startsWith('ceil_')) return Math.ceil(amount / unit) * unit;
    return null;
  }

  function statusRow(code, extra) {
    return Object.assign({ code, amount: null, rawAmount: null, status: 'review_required', reasons: [] }, extra || {});
  }

  function coverageBoundaryRequiresReview(profile, bounds, prefix) {
    const acquired = profile[`${prefix}AcquiredOn`] || profile[`${prefix}_acquired_on`];
    const lost = profile[`${prefix}LostOn`] || profile[`${prefix}_lost_on`];
    return isInsideMonth(acquired, bounds) || isInsideMonth(lost, bounds);
  }

  function finalizeRateAmount({ code, rawAmount, rule, reasons = [] }) {
    const roundingMethod = rule && (rule.roundingMethod || rule.rounding_method);
    if (!roundingMethod) {
      return statusRow(code, { rawAmount, reasons: [...reasons, 'rounding_policy_missing'] });
    }
    return {
      code,
      rawAmount,
      amount: applyRounding(rawAmount, roundingMethod),
      status: 'complete',
      reasons,
      roundingMethod,
    };
  }

  function calculateRateBased({ code, enrollmentStatus, nonApplicableStatuses, base, rule, boundaryReview }) {
    if (nonApplicableStatuses.includes(enrollmentStatus)) {
      return { code, rawAmount: 0, amount: 0, status: 'complete', reasons: ['not_applicable'] };
    }
    if (enrollmentStatus !== 'enrolled') {
      return statusRow(code, { reasons: ['eligibility_pending_review'] });
    }
    if (boundaryReview) {
      return statusRow(code, { reasons: ['mid_month_coverage_boundary'] });
    }
    if (!rule) {
      return statusRow(code, { reasons: ['rate_rule_missing'] });
    }
    const numericBase = Number(base);
    const rate = Number(rule.employeeRate ?? rule.employee_rate);
    if (!Number.isFinite(numericBase) || numericBase < 0) {
      return statusRow(code, { reasons: ['calculation_basis_missing'] });
    }
    if (!Number.isFinite(rate) || rate < 0) {
      return statusRow(code, { reasons: ['employee_rate_missing'] });
    }
    return finalizeRateAmount({ code, rawAmount: numericBase * rate, rule });
  }

  function calculateStatutoryDeductions(input) {
    const payrollMonth = input && input.payrollMonth;
    const profile = (input && input.profile) || {};
    const rateRules = (input && input.rateRules) || [];
    const taxableRemuneration = input && input.taxableRemuneration;
    const bounds = monthBounds(payrollMonth);

    const npsRule = selectRateRule('national_pension', payrollMonth, rateRules);
    const healthRule = selectRateRule('health_insurance', payrollMonth, rateRules);
    const ltcRule = selectRateRule('long_term_care', payrollMonth, rateRules);
    const employmentRule = selectRateRule('employment_insurance', payrollMonth, rateRules);

    const nationalPension = calculateRateBased({
      code: 'national_pension',
      enrollmentStatus: profile.nationalPensionStatus || profile.national_pension_status,
      nonApplicableStatuses: ['excluded_by_request', 'not_applicable'],
      base: profile.pensionStandardMonthlyIncome ?? profile.pension_standard_monthly_income,
      rule: npsRule,
      boundaryReview: coverageBoundaryRequiresReview(profile, bounds, 'nationalPension') ||
        coverageBoundaryRequiresReview(profile, bounds, 'national_pension'),
    });

    const healthInsurance = calculateRateBased({
      code: 'health_insurance',
      enrollmentStatus: profile.healthInsuranceStatus || profile.health_insurance_status,
      nonApplicableStatuses: ['not_applicable'],
      base: profile.healthMonthlyRemuneration ?? profile.health_monthly_remuneration,
      rule: healthRule,
      boundaryReview: coverageBoundaryRequiresReview(profile, bounds, 'healthInsurance') ||
        coverageBoundaryRequiresReview(profile, bounds, 'health_insurance'),
    });

    let longTermCare;
    const healthStatus = profile.healthInsuranceStatus || profile.health_insurance_status;
    if (healthStatus === 'not_applicable') {
      longTermCare = { code: 'long_term_care', rawAmount: 0, amount: 0, status: 'complete', reasons: ['not_applicable'] };
    } else if (healthInsurance.status !== 'complete') {
      longTermCare = statusRow('long_term_care', { reasons: ['health_insurance_unresolved'] });
    } else if (!ltcRule) {
      longTermCare = statusRow('long_term_care', { reasons: ['rate_rule_missing'] });
    } else {
      const numerator = Number(ltcRule.ratioNumerator ?? ltcRule.ratio_numerator);
      const denominator = Number(ltcRule.ratioDenominator ?? ltcRule.ratio_denominator);
      if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
        longTermCare = statusRow('long_term_care', { reasons: ['ratio_rule_invalid'] });
      } else {
        longTermCare = finalizeRateAmount({
          code: 'long_term_care',
          rawAmount: Number(healthInsurance.amount) * numerator / denominator,
          rule: ltcRule,
        });
      }
    }

    const employmentInsurance = calculateRateBased({
      code: 'employment_insurance',
      enrollmentStatus: profile.employmentInsuranceStatus || profile.employment_insurance_status,
      nonApplicableStatuses: ['not_applicable'],
      base: taxableRemuneration,
      rule: employmentRule,
      boundaryReview: coverageBoundaryRequiresReview(profile, bounds, 'employmentInsurance') ||
        coverageBoundaryRequiresReview(profile, bounds, 'employment_insurance'),
    });

    const rows = [nationalPension, healthInsurance, longTermCare, employmentInsurance];
    const complete = rows.every((row) => row.status === 'complete');
    return {
      status: complete ? 'complete' : 'review_required',
      rows,
      totalEmployeeDeduction: complete
        ? rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
        : null,
      unresolvedReasons: [...new Set(rows.flatMap((row) => row.status === 'complete' ? [] : row.reasons || []))],
    };
  }

  return {
    applyRounding,
    selectRateRule,
    calculateStatutoryDeductions,
  };
});
