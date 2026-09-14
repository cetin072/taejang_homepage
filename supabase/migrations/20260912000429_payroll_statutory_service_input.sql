-- Issue #182: server-only statutory payroll input for trusted Edge calculation.
-- Sensitive statutory fields are deliberately excluded from browser-readable payroll RPCs.
begin;

create or replace function public.private_get_payroll_statutory_input(
  p_payroll_month date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  month_start date;
  month_end date;
  rates_json jsonb := '[]'::jsonb;
  profiles_json jsonb := '[]'::jsonb;
begin
  if p_payroll_month is null
     or date_trunc('month', p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;

  month_start := p_payroll_month;
  month_end := (p_payroll_month + interval '1 month - 1 day')::date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'rate_code', r.rate_code,
        'effective_from', r.effective_from,
        'effective_to', r.effective_to,
        'calculation_method', r.calculation_method,
        'employee_rate', r.employee_rate,
        'ratio_numerator', r.ratio_numerator,
        'ratio_denominator', r.ratio_denominator,
        'rounding_method', r.rounding_method
      ) order by r.rate_code, r.effective_from, r.id
    ), '[]'::jsonb
  ) into rates_json
  from public.payroll_statutory_rate_rules r
  where r.effective_from <= month_end
    and (r.effective_to is null or r.effective_to >= month_start);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'profile_id', p.id,
        'employee_uuid', p.employee_uuid,
        'effective_from', p.effective_from,
        'effective_to', p.effective_to,
        'national_pension_status', p.national_pension_status,
        'health_insurance_status', p.health_insurance_status,
        'employment_insurance_status', p.employment_insurance_status,
        'national_pension_acquired_on', p.national_pension_acquired_on,
        'national_pension_lost_on', p.national_pension_lost_on,
        'health_insurance_acquired_on', p.health_insurance_acquired_on,
        'health_insurance_lost_on', p.health_insurance_lost_on,
        'employment_insurance_acquired_on', p.employment_insurance_acquired_on,
        'employment_insurance_lost_on', p.employment_insurance_lost_on,
        'pension_standard_monthly_income', p.pension_standard_monthly_income,
        'health_monthly_remuneration', p.health_monthly_remuneration
      ) order by p.employee_uuid::text, p.effective_from, p.id
    ), '[]'::jsonb
  ) into profiles_json
  from public.payroll_statutory_profiles p
  join public.employees e on e.id = p.employee_uuid
  where p.effective_from <= month_end
    and (p.effective_to is null or p.effective_to >= month_start)
    and e.hired_on <= month_end
    and (e.departed_on is null or e.departed_on >= month_start);

  return jsonb_build_object(
    'payroll_month', month_start,
    'rate_rules', rates_json,
    'profiles', profiles_json
  );
end;
$$;

revoke all on function public.private_get_payroll_statutory_input(date) from public, anon, authenticated;
revoke all on function public.private_get_payroll_statutory_input(date) from service_role;
grant execute on function public.private_get_payroll_statutory_input(date) to service_role;

comment on function public.private_get_payroll_statutory_input(date) is
  'Server-only statutory payroll input for trusted Edge calculation. Not browser-readable. Returns no names, RRN, bank, disability detail, livelihood status, tax-dependent data, or source notes.';

commit;
