-- Issue #303 follow-up: verified employment-insurance end-digit handling.
--
-- Evidence:
-- - Ministry of Employment and Labor: employee unemployment-insurance share is 0.9%.
-- - Korea Workers' Compensation & Welfare Service payroll/settlement guidance:
--   monthly settlement insurance premium is calculated with won-unit truncation.
--
-- Taejang engine mapping: won-unit truncation = floor_to_1.
-- This migration changes only the 2026 employment-insurance rounding rule.
begin;

update public.payroll_statutory_rate_rules
set
  rounding_method = 'floor_to_1',
  note = coalesce(note || '; ', '') ||
    '2026 근로자 실업급여 부담 0.9%; 근로복지공단 보수총액 신고 안내의 월별 정산보험료 원단위 절사 기준 적용'
where rate_code = 'employment_insurance'
  and effective_from = date '2026-01-01'
  and effective_to = date '2026-12-31'
  and employee_rate = 0.009
  and rounding_method is null;

commit;
