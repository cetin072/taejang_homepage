-- Taejang Payroll Backend Contract Prototype
-- Goal: #142
-- Status: PROTOTYPE ONLY. NOT A MIGRATION. DO NOT APPLY TO PRODUCTION/STAGING WITHOUT APPROVAL.
--
-- Principles:
-- 1) Reuse public.employees as the employee source of truth.
-- 2) Payroll calculation data is separate from Sensitive HR identifiers.
-- 3) Heavy calculations are explicit commands; normal screens read persisted snapshots.
-- 4) RLS starts fail-closed. This prototype intentionally defines no end-user policies.
-- 5) Month lock, retroactive payment execution, and shared auth/RLS changes are approval gates.
-- 6) A payroll month may only point to calculation/accounting/carryover-application runs that belong to that same month.
-- 7) Prior-month adjustments remain immutable source facts; target-month application is a separate audited record.
-- 8) Confirmed accounting must bind to the exact adjusted-payroll basis, not only the calculation run.

begin;

create table if not exists public.payroll_employment_terms (
  id uuid primary key default gen_random_uuid(),
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  effective_from date not null,
  effective_to date,
  pay_type text not null check (pay_type in ('hourly','monthly')),
  daily_scheduled_hours numeric(6,2),
  hourly_rate numeric(12,2),
  monthly_salary numeric(14,2),
  source_kind text not null default 'manual' check (source_kind in ('manual','sheet_bridge','approved_migration')),
  source_ref text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict,
  check (effective_to is null or effective_to >= effective_from),
  check (
    (pay_type='hourly' and daily_scheduled_hours is not null and daily_scheduled_hours >= 0 and hourly_rate is not null and hourly_rate > 0)
    or
    (pay_type='monthly' and monthly_salary is not null and monthly_salary >= 0)
  )
);

create unique index if not exists payroll_employment_terms_employee_start_uq
  on public.payroll_employment_terms(employee_uuid, effective_from);

create table if not exists public.payroll_holidays (
  holiday_date date primary key,
  holiday_name text not null check (char_length(btrim(holiday_name)) between 1 and 120),
  paid boolean not null default true,
  source_kind text not null default 'approved_calendar' check (source_kind in ('approved_calendar','manual_override')),
  created_at timestamptz not null default now()
);

create table if not exists public.payroll_months (
  id uuid primary key default gen_random_uuid(),
  payroll_month date not null unique check (date_trunc('month',payroll_month)::date=payroll_month),
  status text not null default 'draft' check (status in ('draft','imported','exceptions','provisional','accounting','ready','locked')),
  cutoff_date date,
  latest_run_id uuid,
  unresolved_important_exceptions integer not null default 0 check (unresolved_important_exceptions >= 0),
  locked_at timestamptz,
  locked_by uuid references public.profiles(id) on delete restrict,
  approval_note text check (char_length(coalesce(approval_note,'')) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status='locked' and locked_at is not null and locked_by is not null) or status<>'locked')
);

create table if not exists public.payroll_calculation_runs (
  id uuid primary key default gen_random_uuid(),
  payroll_month_id uuid not null references public.payroll_months(id) on delete restrict,
  run_key text not null unique,
  calculation_version text not null,
  input_fingerprint text not null,
  cutoff_date date not null,
  generated_at timestamptz not null,
  source_state text not null default 'provisional' check (source_state in ('provisional','final_reconciliation')),
  employee_count integer not null default 0 check (employee_count >= 0),
  unresolved_item_count integer not null default 0 check (unresolved_item_count >= 0),
  rate_review_count integer not null default 0 check (rate_review_count >= 0),
  gross_pay_preview numeric(16,2),
  gross_pay_preview_status text not null check (gross_pay_preview_status in ('complete','review_required')),
  payable_hours_preview numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (id, payroll_month_id),
  unique (payroll_month_id, calculation_version, input_fingerprint, cutoff_date)
);

-- Composite FK prevents a month from accidentally pointing at another month's run.
do $$
begin
  alter table public.payroll_months
    add constraint payroll_months_latest_run_same_month_fk
    foreign key (latest_run_id, id)
    references public.payroll_calculation_runs(id, payroll_month_id)
    on delete restrict;
exception
  when duplicate_object then null;
end $$;

create table if not exists public.payroll_employee_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_calculation_runs(id) on delete cascade,
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  actual_work_hours numeric(10,2) not null default 0,
  expected_work_hours numeric(10,2) not null default 0,
  paid_holiday_hours numeric(10,2) not null default 0,
  weekly_holiday_actual_hours numeric(10,2) not null default 0,
  weekly_holiday_expected_hours numeric(10,2) not null default 0,
  weekly_holiday_pending_weeks integer not null default 0,
  unresolved_count integer not null default 0,
  payable_hours_preview numeric(10,2) not null default 0,
  hourly_rate numeric(12,2),
  gross_pay_preview numeric(14,2),
  rate_status text not null check (rate_status in ('single_rate','missing_rate_review_required','multiple_rates_review_required')),
  calculation_detail jsonb not null default '{}'::jsonb check (jsonb_typeof(calculation_detail)='object'),
  unique (run_id, employee_uuid)
);

create table if not exists public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  adjustment_key text not null unique,
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  source_month date not null check (date_trunc('month',source_month)::date=source_month),
  target_month date not null check (date_trunc('month',target_month)::date=target_month),
  source_date date not null,
  category text not null check (category in ('work_hours','weekly_holiday','paid_holiday','other_approved')),
  before_hours numeric(10,2),
  after_hours numeric(10,2),
  difference_hours numeric(10,2),
  source_hourly_rate numeric(12,2),
  difference_amount numeric(14,2),
  amount_status text not null default 'review_required' check (amount_status in ('ready','review_required')),
  status text not null default 'pending_next_month' check (status in ('pending_next_month','reviewed','applied','cancelled')),
  reason text check (char_length(coalesce(reason,'')) <= 1000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  check (
    amount_status='review_required'
    or (source_hourly_rate is not null and source_hourly_rate > 0 and difference_amount is not null)
  )
);

-- Applying a reviewed source adjustment to a later payroll run is a new immutable audit fact.
-- It does not rewrite the source adjustment and it does not become target-month work hours.
create table if not exists public.payroll_carryover_applications (
  id uuid primary key default gen_random_uuid(),
  application_key text not null unique,
  adjustment_id uuid not null references public.payroll_adjustments(id) on delete restrict,
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  target_payroll_month_id uuid not null references public.payroll_months(id) on delete restrict,
  applied_run_id uuid not null,
  source_month date not null check (date_trunc('month',source_month)::date=source_month),
  source_date date not null,
  category text not null check (category in ('work_hours','weekly_holiday','paid_holiday','other_approved')),
  difference_hours numeric(10,2),
  source_hourly_rate numeric(12,2) not null check (source_hourly_rate > 0),
  difference_amount numeric(14,2) not null,
  status text not null default 'applied' check (status='applied'),
  applied_at timestamptz not null,
  approved_by uuid references public.profiles(id) on delete restrict,
  approval_note text check (char_length(coalesce(approval_note,'')) <= 1000),
  created_at timestamptz not null default now(),
  unique (adjustment_id, applied_run_id),
  foreign key (applied_run_id, target_payroll_month_id)
    references public.payroll_calculation_runs(id, payroll_month_id)
    on delete restrict
);

create table if not exists public.payroll_accounting_comparisons (
  id uuid primary key default gen_random_uuid(),
  payroll_month_id uuid not null unique references public.payroll_months(id) on delete cascade,
  run_id uuid not null,
  payroll_basis_fingerprint text,
  adjusted_gross_basis numeric(16,2),
  confirmed boolean not null default false,
  stale boolean not null default false,
  stale_reason text,
  difference_count integer not null default 0 check (difference_count >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete restrict,
  check (payroll_basis_fingerprint is null or char_length(btrim(payroll_basis_fingerprint)) between 1 and 128),
  check (not (confirmed and stale)),
  check (not confirmed or (payroll_basis_fingerprint is not null and adjusted_gross_basis is not null)),
  foreign key (run_id, payroll_month_id)
    references public.payroll_calculation_runs(id, payroll_month_id)
    on delete restrict
);

create table if not exists public.payroll_accounting_difference_rows (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.payroll_accounting_comparisons(id) on delete cascade,
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  field_code text not null check (char_length(btrim(field_code)) between 1 and 80),
  provisional_value numeric(16,2),
  confirmed_value numeric(16,2),
  difference_value numeric(16,2),
  status text not null default 'review' check (status in ('review','accepted','resolved')),
  unique (comparison_id, employee_uuid, field_code)
);

-- Fail closed by default. End-user payroll policies are deliberately NOT decided here.
alter table public.payroll_employment_terms enable row level security;
alter table public.payroll_holidays enable row level security;
alter table public.payroll_months enable row level security;
alter table public.payroll_calculation_runs enable row level security;
alter table public.payroll_employee_results enable row level security;
alter table public.payroll_adjustments enable row level security;
alter table public.payroll_carryover_applications enable row level security;
alter table public.payroll_accounting_comparisons enable row level security;
alter table public.payroll_accounting_difference_rows enable row level security;

revoke all on
  public.payroll_employment_terms,
  public.payroll_holidays,
  public.payroll_months,
  public.payroll_calculation_runs,
  public.payroll_employee_results,
  public.payroll_adjustments,
  public.payroll_carryover_applications,
  public.payroll_accounting_comparisons,
  public.payroll_accounting_difference_rows
from public, anon, authenticated;

-- Migration-promotion checks still required before this prototype can become executable SQL:
-- - add transaction-safe DB enforcement preventing overlapping employment-term date ranges
-- - ensure adapters persist gross-pay previews as null while unresolved/rate-review items remain
-- - independently review payroll read/write role mapping and all RLS policies
-- - enforce source payroll month locked before carryover application at the transaction boundary
-- - transactionally verify the persisted payroll_basis_fingerprint against the exact adjusted-payroll basis at accounting confirmation and month lock
-- - verify all cross-month carryover rules against approved business/payroll policy
--
-- Intentionally absent until separately reviewed/approved:
-- - authenticated SELECT/INSERT/UPDATE/DELETE policies
-- - RPC mutation functions
-- - payroll operator role mapping
-- - service-role execution path
-- - real month lock RPC
-- - retroactive payment execution RPC
-- - Sensitive HR joins

rollback;