-- Issue #182: enable only statutory contribution rounding rules with current legal/public support.
-- Keep long-term care and employment insurance fail-closed until their exact per-employee rounding policy is verified.
begin;

update public.payroll_statutory_rate_rules
set
  rounding_method = 'floor_to_10',
  note = case
    when rate_code = 'national_pension'
      then '2026 사업장가입자 총 9.5%, 근로자/사용자 각 4.75%; 연금보험료 계산의 10원 미만 끝수는 국고금관리법 제47조 준용'
    when rate_code = 'health_insurance'
      then '2026 직장가입자 총 7.19%, 근로자/사용자 각 50%; 보험료 계산의 10원 미만 끝수는 국민건강보험법 제107조 및 국고금관리법 제47조에 따라 계산하지 않음'
    else note
  end
where rate_code in ('national_pension', 'health_insurance')
  and effective_from = date '2026-01-01'
  and effective_to = date '2026-12-31'
  and rounding_method is null;

commit;
