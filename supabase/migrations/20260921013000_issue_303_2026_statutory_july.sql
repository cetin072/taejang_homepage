begin;

-- Issue #303: 2026 statutory deduction basis and historical profile coverage.
-- This migration does not invent unresolved insurance eligibility. It only
-- carries forward already-reconciled statuses/bases to the employee's actual
-- relationship period and applies official 2026 rate boundaries.

alter table public.payroll_statutory_rate_rules
  add column if not exists minimum_basis numeric(14,2),
  add column if not exists maximum_basis numeric(14,2),
  add column if not exists minimum_employee_contribution numeric(14,2),
  add column if not exists maximum_employee_contribution numeric(14,2);

alter table public.payroll_statutory_profiles
  add column if not exists national_pension_acquisition_month_opt_in boolean not null default false;

-- 2026 국민연금: 9.5% total / employee 4.75%.
-- Standard monthly income boundaries change every July.
update public.payroll_statutory_rate_rules
set effective_to = date '2026-06-30',
    minimum_basis = 400000,
    maximum_basis = 6370000,
    minimum_employee_contribution = null,
    maximum_employee_contribution = null,
    note = '2026.1~6 사업장가입자 총 9.5%, 근로자/사용자 각 4.75%; 기준소득월액 40만원~637만원'
where rate_code = 'national_pension'
  and effective_from = date '2026-01-01';

insert into public.payroll_statutory_rate_rules(
  rate_code,effective_from,effective_to,calculation_method,
  employee_rate,employer_rate,ratio_numerator,ratio_denominator,
  source_ref,note,rounding_method,
  minimum_basis,maximum_basis,minimum_employee_contribution,maximum_employee_contribution
)
values(
  'national_pension',date '2026-07-01',date '2026-12-31',
  'standard_monthly_income_rate',
  0.0475,0.0475,null,null,
  'https://www.nps.or.kr/pnsinfo/ntpsklg/getOHAF0038M0.do',
  '2026.7~12 사업장가입자 총 9.5%, 근로자/사용자 각 4.75%; 기준소득월액 41만원~659만원',
  'floor_to_10',
  410000,6590000,null,null
)
on conflict (rate_code,effective_from) do update
set effective_to=excluded.effective_to,
    calculation_method=excluded.calculation_method,
    employee_rate=excluded.employee_rate,
    employer_rate=excluded.employer_rate,
    source_ref=excluded.source_ref,
    note=excluded.note,
    rounding_method=excluded.rounding_method,
    minimum_basis=excluded.minimum_basis,
    maximum_basis=excluded.maximum_basis;

-- 2026 직장 건강보험 total 7.19%, employee 3.595%.
-- The official 2026 monthly workplace contribution floor/ceiling are total
-- 20,160 / 9,183,480, therefore the employee half is 10,080 / 4,591,740.
update public.payroll_statutory_rate_rules
set minimum_employee_contribution = 10080,
    maximum_employee_contribution = 4591740
where rate_code='health_insurance'
  and effective_from=date '2026-01-01';

-- Existing profiles were created from the confirmed 2026-08 reconciliation
-- but were intentionally made prospective from September. For historical
-- draft calculation, create a separate effective row covering the real
-- employment period through August. Pending statuses stay pending; enrolled
-- statuses keep only the already-reconciled bases and use hire date as the
-- normal qualification acquisition date.
insert into public.payroll_statutory_profiles(
  employee_uuid,effective_from,effective_to,
  national_pension_status,health_insurance_status,employment_insurance_status,
  livelihood_recipient_status,disability_tax_deduction_status,
  national_pension_acquired_on,national_pension_lost_on,
  health_insurance_acquired_on,health_insurance_lost_on,
  employment_insurance_acquired_on,employment_insurance_lost_on,
  pension_standard_monthly_income,health_monthly_remuneration,
  tax_dependent_count,withholding_rate_percent,
  source_kind,source_ref,review_note,reviewed_at,reviewed_by,
  national_pension_acquisition_month_opt_in
)
select
  p.employee_uuid,
  e.hired_on,
  least(coalesce(e.departed_on,date '2026-08-31'),date '2026-08-31'),
  p.national_pension_status,
  p.health_insurance_status,
  p.employment_insurance_status,
  p.livelihood_recipient_status,
  p.disability_tax_deduction_status,
  case when p.national_pension_status='enrolled' then e.hired_on else null end,
  case when p.national_pension_status='enrolled' and e.departed_on is not null then e.departed_on + 1 else null end,
  case when p.health_insurance_status='enrolled' then e.hired_on else null end,
  case when p.health_insurance_status='enrolled' and e.departed_on is not null then e.departed_on + 1 else null end,
  case when p.employment_insurance_status='enrolled' then e.hired_on else null end,
  case when p.employment_insurance_status='enrolled' and e.departed_on is not null then e.departed_on + 1 else null end,
  p.pension_standard_monthly_income,
  p.health_monthly_remuneration,
  p.tax_dependent_count,
  p.withholding_rate_percent,
  'historical_payroll_reconciliation',
  'historical-backfill:' || coalesce(p.source_ref,p.id::text),
  '2026-08 confirmed reconciliation facts backfilled only for historical draft calculation; pending statuses remain unresolved',
  p.reviewed_at,
  p.reviewed_by,
  false
from public.payroll_statutory_profiles p
join public.employees e on e.id=p.employee_uuid
where p.effective_from=date '2026-09-01'
  and e.hired_on <= date '2026-08-31'
  and least(coalesce(e.departed_on,date '2026-08-31'),date '2026-08-31') >= e.hired_on
on conflict (employee_uuid,effective_from) do nothing;

-- Server-only input now includes any employee/profile overlap with the payroll
-- month. Per-insurance acquisition/loss rules are handled by the deterministic
-- statutory engine rather than excluding every partial-month relationship.
create or replace function public.private_get_payroll_statutory_input(
  p_payroll_month date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  month_start date;
  month_end date;
  rates_json jsonb := '[]'::jsonb;
  profiles_json jsonb := '[]'::jsonb;
begin
  if p_payroll_month is null
     or date_trunc('month',p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023',message='INVALID_PAYROLL_MONTH';
  end if;

  month_start:=p_payroll_month;
  month_end:=(p_payroll_month + interval '1 month - 1 day')::date;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,
    'rate_code',r.rate_code,
    'effective_from',r.effective_from,
    'effective_to',r.effective_to,
    'calculation_method',r.calculation_method,
    'employee_rate',r.employee_rate,
    'ratio_numerator',r.ratio_numerator,
    'ratio_denominator',r.ratio_denominator,
    'rounding_method',r.rounding_method,
    'minimum_basis',r.minimum_basis,
    'maximum_basis',r.maximum_basis,
    'minimum_employee_contribution',r.minimum_employee_contribution,
    'maximum_employee_contribution',r.maximum_employee_contribution
  ) order by r.rate_code,r.effective_from,r.id),'[]'::jsonb)
  into rates_json
  from public.payroll_statutory_rate_rules r
  where r.effective_from<=month_end
    and (r.effective_to is null or r.effective_to>=month_start);

  select coalesce(jsonb_agg(jsonb_build_object(
    'profile_id',p.id,
    'employee_uuid',p.employee_uuid,
    'effective_from',p.effective_from,
    'effective_to',p.effective_to,
    'national_pension_status',p.national_pension_status,
    'health_insurance_status',p.health_insurance_status,
    'employment_insurance_status',p.employment_insurance_status,
    'national_pension_acquired_on',p.national_pension_acquired_on,
    'national_pension_lost_on',p.national_pension_lost_on,
    'health_insurance_acquired_on',p.health_insurance_acquired_on,
    'health_insurance_lost_on',p.health_insurance_lost_on,
    'employment_insurance_acquired_on',p.employment_insurance_acquired_on,
    'employment_insurance_lost_on',p.employment_insurance_lost_on,
    'national_pension_acquisition_month_opt_in',p.national_pension_acquisition_month_opt_in,
    'pension_standard_monthly_income',p.pension_standard_monthly_income,
    'health_monthly_remuneration',p.health_monthly_remuneration
  ) order by p.employee_uuid::text,p.effective_from,p.id),'[]'::jsonb)
  into profiles_json
  from public.payroll_statutory_profiles p
  join public.employees e on e.id=p.employee_uuid
  where p.effective_from<=month_end
    and (p.effective_to is null or p.effective_to>=month_start)
    and e.hired_on<=month_end
    and (e.departed_on is null or e.departed_on>=month_start);

  return jsonb_build_object(
    'payroll_month',month_start,
    'rate_rules',rates_json,
    'profiles',profiles_json
  );
end;
$$;

revoke all on function public.private_get_payroll_statutory_input(date)
from public,anon,authenticated;
revoke all on function public.private_get_payroll_statutory_input(date)
from service_role;
grant execute on function public.private_get_payroll_statutory_input(date)
to service_role;

comment on function public.private_get_payroll_statutory_input(date) is
  'Server-only 2026 statutory payroll input. Includes month-overlapping profiles and rate boundaries; no protected identity fields are returned.';

commit;
