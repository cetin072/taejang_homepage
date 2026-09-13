-- Taejang Payroll Attendance Persistence Candidate
-- Goal: #142 / PR #143
-- Status: CANDIDATE ONLY. ROLLBACK-ONLY. DO NOT APPLY TO STAGING/PRODUCTION WITHOUT A SEPARATE APPROVAL.
--
-- Purpose:
-- - give a trusted payroll calculation runtime a versioned DB source for imported attendance;
-- - preserve source/evidence references without turning clock-span arithmetic into paid hours;
-- - keep normal payroll UI data separate from Sensitive HR identity data;
-- - preserve corrections as append-only audited facts.

begin;

create table if not exists public.payroll_attendance_import_batches (
  id uuid primary key default gen_random_uuid(),
  payroll_month date not null check (date_trunc('month',payroll_month)::date=payroll_month),
  source_file_id text not null check (char_length(btrim(source_file_id)) between 1 and 300),
  source_fingerprint text not null check (char_length(btrim(source_fingerprint)) between 8 and 256),
  source_modified_at timestamptz,
  source_row_count integer not null default 0 check (source_row_count >= 0),
  status text not null default 'imported'
    check (status in ('imported','normalized','review_required','accepted','voided')),
  imported_at timestamptz not null default now(),
  imported_by uuid not null references public.profiles(id) on delete restrict,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (source_fingerprint),
  check (
    (status='accepted' and accepted_at is not null and accepted_by is not null)
    or status<>'accepted'
  )
);

-- Exactly one accepted source-of-truth attendance batch may exist for a payroll month.
-- Re-import promotion must transactionally void/supersede the old accepted batch before
-- accepting the replacement, so a calculation runtime never has two canonical inputs.
create unique index if not exists payroll_attendance_one_accepted_batch_per_month_uq
  on public.payroll_attendance_import_batches(payroll_month)
  where status='accepted';

create table if not exists public.payroll_attendance_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payroll_attendance_import_batches(id) on delete restrict,
  source_key text not null unique check (char_length(btrim(source_key)) between 1 and 500),
  source_sheet text check (char_length(coalesce(source_sheet,'')) <= 160),
  source_row_number integer check (source_row_number is null or source_row_number > 0),
  source_display_name text check (char_length(coalesce(source_display_name,'')) <= 160),
  employee_uuid uuid references public.employees(id) on delete restrict,
  work_date date not null,
  clock_in_raw text check (char_length(coalesce(clock_in_raw,'')) <= 80),
  clock_out_raw text check (char_length(coalesce(clock_out_raw,'')) <= 80),
  source_status text check (char_length(coalesce(source_status,'')) <= 120),
  manual_flag boolean not null default false,
  scheduled_hours numeric(8,2),
  match_status text not null
    check (match_status in ('matched','unmatched','ambiguous','lifecycle_conflict')),
  record_status text not null
    check (record_status in ('complete_actual','expected_future','partial','manual_review','leave_paid','absence_unpaid','holiday_paid','holiday_unpaid','termination','out_of_scope','review_required')),
  auto_decision text not null
    check (auto_decision in ('actual_scheduled','expected_scheduled','paid_leave','unpaid_absence','paid_holiday','unpaid_holiday','termination','confirmed_correction','review_required','out_of_scope')),
  exception_type text,
  review_status text not null default 'pending'
    check (review_status in ('not_required','pending','confirmed','cancelled')),
  confirmed_hours numeric(8,2),
  created_at timestamptz not null default now(),
  check (scheduled_hours is null or scheduled_hours >= 0),
  check (confirmed_hours is null or confirmed_hours >= 0),
  check (match_status='matched' or employee_uuid is null),
  check (match_status<>'matched' or employee_uuid is not null),
  check (
    auto_decision<>'confirmed_correction'
    or (review_status='confirmed' and confirmed_hours is not null)
  ),
  unique (batch_id, source_key)
);

create index if not exists payroll_attendance_rows_batch_employee_date_idx
  on public.payroll_attendance_rows(batch_id,employee_uuid,work_date);

create table if not exists public.payroll_attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  correction_key text not null unique check (char_length(btrim(correction_key)) between 1 and 500),
  attendance_row_id uuid not null references public.payroll_attendance_rows(id) on delete restrict,
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  work_date date not null,
  previous_confirmed_hours numeric(8,2),
  new_confirmed_hours numeric(8,2) not null check (new_confirmed_hours >= 0),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  evidence_ref text check (char_length(coalesce(evidence_ref,'')) <= 500),
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict
);

-- Raw clocks are evidence only. No generated duration column, subtraction expression,
-- or trigger is allowed to convert clock_in_raw/clock_out_raw into paid hours.
comment on column public.payroll_attendance_rows.clock_in_raw is
  'Source evidence only. Never derive paid hours from clock span automatically.';
comment on column public.payroll_attendance_rows.clock_out_raw is
  'Source evidence only. Never derive paid hours from clock span automatically.';
comment on column public.payroll_attendance_rows.confirmed_hours is
  'Payroll-confirmed hours only; populated by approved decision/correction semantics, not clock-span arithmetic.';

-- Final payroll calculation should consume only an accepted batch.
-- Any unmatched/ambiguous/partial/manual-review row remains a calculation blocker until resolved.

alter table public.payroll_attendance_import_batches enable row level security;
alter table public.payroll_attendance_rows enable row level security;
alter table public.payroll_attendance_corrections enable row level security;

revoke all on
  public.payroll_attendance_import_batches,
  public.payroll_attendance_rows,
  public.payroll_attendance_corrections
from public, anon, authenticated;

-- Intentionally absent:
-- - broad authenticated table policies/grants
-- - resident-registration, disability, bank-account, health/support data
-- - clock-span-to-paid-hours formula/trigger
-- - destructive overwrite of source rows/corrections
-- - automatic acceptance of unresolved imports
-- - Production/staging application

rollback;
