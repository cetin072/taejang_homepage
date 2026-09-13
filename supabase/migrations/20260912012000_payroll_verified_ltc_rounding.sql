-- Issue #182: enable long-term care rounding after current-law verification.
-- Legal chain: Long-Term Care Insurance Act Article 64 applies National Health Insurance Act Article 107
-- to long-term-care premiums; Article 107 applies the National Treasury Funds Management Act Article 47
-- end-digit rule, which does not calculate amounts below 10 won.
-- Employment insurance remains fail-closed until its exact per-employee rounding rule is authoritatively verified.
begin;

update public.payroll_statutory_rate_rules
set
  rounding_method = 'floor_to_10',
  note = '장기요양보험법 제64조가 국민건강보험법 제107조의 단수처리를 장기요양보험료에 준용하며, 국고금관리법 제47조에 따라 10원 미만 끝수는 계산하지 않음'
where rate_code = 'long_term_care'
  and effective_from = date '2026-01-01'
  and effective_to = date '2026-12-31'
  and rounding_method is null;

commit;
