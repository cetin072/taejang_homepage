-- Issue #182: statutory deduction profile/history foundation for Staging payroll MVP.
-- Sensitive eligibility fields are server-side only. Raw resident registration numbers are NOT stored here.
-- They remain in the protected HR source until an encrypted secret-handling path is implemented.
begin;

create table if not exists public.payroll_statutory_rate_rules (
  id uuid primary key default gen_random_uuid(),
  rate_code text not null check (rate_code in ('national_pension','health_insurance','long_term_care','employment_insurance')),
  effective_from date not null,
  effective_to date,
  calculation_method text not null check (calculation_method in (
    'standard_monthly_income_rate',
    'monthly_remuneration_rate',
    'health_contribution_ratio',
    'taxable_remuneration_rate'
  )),
  employee_rate numeric(12,8),
  employer_rate numeric(12,8),
  ratio_numerator numeric(12,8),
  ratio_denominator numeric(12,8),
  source_ref text not null check (char_length(btrim(source_ref)) between 1 and 1000),
  note text check (char_length(coalesce(note,'')) <= 1000),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (
    (calculation_method <> 'health_contribution_ratio' and employee_rate is not null and employer_rate is not null)
    or
    (calculation_method = 'health_contribution_ratio' and ratio_numerator is not null and ratio_denominator is not null and ratio_denominator > 0)
  ),
  unique (rate_code, effective_from)
);

insert into public.payroll_statutory_rate_rules(
  rate_code, effective_from, effective_to, calculation_method,
  employee_rate, employer_rate, ratio_numerator, ratio_denominator,
  source_ref, note
)
values
  (
    'national_pension', date '2026-01-01', date '2026-12-31',
    'standard_monthly_income_rate', 0.0475, 0.0475, null, null,
    'https://www.nps.or.kr/pnsinfo/ntpsklg/getOHAF0097M0.do',
    '2026 사업장가입자 총 9.5%, 근로자/사용자 각 4.75%'
  ),
  (
    'health_insurance', date '2026-01-01', date '2026-12-31',
    'monthly_remuneration_rate', 0.03595, 0.03595, null, null,
    'https://www.nhis.or.kr/english/wbheaa02500m01.do',
    '2026 직장가입자 총 7.19%, 근로자/사용자 각 50%'
  ),
  (
    'long_term_care', date '2026-01-01', date '2026-12-31',
    'health_contribution_ratio', null, null, 0.009448, 0.0719,
    'https://edi.nhis.or.kr/portal/images/popup/20251204_pop01longdesc.html',
    '장기요양보험료 = 건강보험료 × 0.9448% / 7.19%; 건강보험 부담주체별 보험료를 기준으로 계산'
  ),
  (
    'employment_insurance', date '2026-01-01', date '2026-12-31',
    'taxable_remuneration_rate', 0.009, 0.009, null, null,
    'https://edrm.ei.go.kr/ei/eih/eg/ei/eiEminsr/retrieveEi0301Info.do',
    '실업급여 근로자 0.9%, 사용자 0.9%; 사용자 고용안정/직능개발 부담은 별도'
  )
on conflict (rate_code, effective_from) do update
set effective_to = excluded.effective_to,
    calculation_method = excluded.calculation_method,
    employee_rate = excluded.employee_rate,
    employer_rate = excluded.employer_rate,
    ratio_numerator = excluded.ratio_numerator,
    ratio_denominator = excluded.ratio_denominator,
    source_ref = excluded.source_ref,
    note = excluded.note;

create table if not exists public.payroll_statutory_profiles (
  id uuid primary key default gen_random_uuid(),
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  effective_from date not null,
  effective_to date,
  national_pension_status text not null default 'pending_review'
    check (national_pension_status in ('enrolled','excluded_by_request','not_applicable','pending_review')),
  health_insurance_status text not null default 'pending_review'
    check (health_insurance_status in ('enrolled','not_applicable','pending_review')),
  employment_insurance_status text not null default 'pending_review'
    check (employment_insurance_status in ('enrolled','not_applicable','pending_review')),
  livelihood_recipient_status text not null default 'unknown'
    check (livelihood_recipient_status in ('unknown','recipient','not_recipient')),
  disability_tax_deduction_status text not null default 'unknown'
    check (disability_tax_deduction_status in ('unknown','eligible','not_eligible','review_required')),
  national_pension_acquired_on date,
  national_pension_lost_on date,
  health_insurance_acquired_on date,
  health_insurance_lost_on date,
  employment_insurance_acquired_on date,
  employment_insurance_lost_on date,
  pension_standard_monthly_income numeric(14,2),
  health_monthly_remuneration numeric(14,2),
  tax_dependent_count integer check (tax_dependent_count is null or tax_dependent_count >= 0),
  withholding_rate_percent integer not null default 100 check (withholding_rate_percent in (80,100,120)),
  source_kind text not null default 'manual_review'
    check (source_kind in ('manual_review','tax_office_confirmed','official_insurance_record','historical_payroll_reconciliation')),
  source_ref text,
  review_note text check (char_length(coalesce(review_note,'')) <= 2000),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (national_pension_lost_on is null or national_pension_acquired_on is null or national_pension_lost_on >= national_pension_acquired_on),
  check (health_insurance_lost_on is null or health_insurance_acquired_on is null or health_insurance_lost_on >= health_insurance_acquired_on),
  check (employment_insurance_lost_on is null or employment_insurance_acquired_on is null or employment_insurance_lost_on >= employment_insurance_acquired_on),
  unique (employee_uuid, effective_from)
);

create table if not exists public.payroll_confirmed_deduction_history (
  id uuid primary key default gen_random_uuid(),
  payroll_month date not null check (date_trunc('month', payroll_month)::date = payroll_month),
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  gross_pay numeric(14,2),
  national_pension_employee numeric(14,2),
  health_insurance_employee numeric(14,2),
  long_term_care_employee numeric(14,2),
  employment_insurance_employee numeric(14,2),
  income_tax numeric(14,2),
  local_income_tax numeric(14,2),
  total_deduction numeric(14,2),
  net_pay numeric(14,2),
  source_kind text not null check (source_kind in ('tax_office_confirmed','payroll_ledger_confirmed')),
  source_ref text,
  source_fingerprint text check (source_fingerprint is null or char_length(source_fingerprint) between 16 and 128),
  confirmed_at timestamptz,
  imported_at timestamptz not null default now(),
  imported_by uuid references public.profiles(id) on delete restrict,
  unique (payroll_month, employee_uuid, source_kind)
);

create index if not exists payroll_statutory_profiles_employee_period_idx
  on public.payroll_statutory_profiles(employee_uuid, effective_from, effective_to);
create index if not exists payroll_confirmed_deduction_history_employee_month_idx
  on public.payroll_confirmed_deduction_history(employee_uuid, payroll_month);

alter table public.payroll_statutory_rate_rules enable row level security;
alter table public.payroll_statutory_profiles enable row level security;
alter table public.payroll_confirmed_deduction_history enable row level security;

revoke all on
  public.payroll_statutory_rate_rules,
  public.payroll_statutory_profiles,
  public.payroll_confirmed_deduction_history
from public, anon, authenticated;

comment on table public.payroll_statutory_profiles is
  'Restricted effective-dated payroll statutory profile. No browser-direct access. Contains sensitive eligibility/status fields.';
comment on table public.payroll_confirmed_deduction_history is
  'Restricted monthly Golden history imported from confirmed tax-office/payroll records for reverse reconciliation.';

commit;
