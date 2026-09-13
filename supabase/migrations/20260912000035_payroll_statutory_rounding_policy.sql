-- Issue #182: explicit statutory contribution rounding policy.
-- NULL rounding_method means the engine must fail closed rather than guess final won amounts.
begin;

alter table public.payroll_statutory_rate_rules
  add column if not exists rounding_method text;

alter table public.payroll_statutory_rate_rules
  drop constraint if exists payroll_statutory_rate_rules_rounding_method_check;

alter table public.payroll_statutory_rate_rules
  add constraint payroll_statutory_rate_rules_rounding_method_check
  check (
    rounding_method is null
    or rounding_method in ('floor_to_10','round_to_10','ceil_to_10','floor_to_1','round_to_1','ceil_to_1')
  );

comment on column public.payroll_statutory_rate_rules.rounding_method is
  'Officially verified contribution amount rounding/end-digit rule. NULL means calculation must remain review_required rather than guess a final won amount.';

commit;
