-- Taejang Payroll Source Identity Mapping Candidate
-- Goal: #142 / Shadow Payroll #178
-- Status: CANDIDATE ONLY. ROLLBACK-ONLY. DO NOT APPLY TO STAGING/PRODUCTION WITHOUT SEPARATE APPROVAL.
--
-- Purpose:
-- - keep public.employees.id as the canonical employee identity;
-- - map payroll/vendor source identities to that canonical UUID after explicit review;
-- - preserve source identifiers such as payroll Sheet TJ-EMP-xxxx without changing employees.employee_id;
-- - fail closed when a stable source key is missing, revoked or unresolved;
-- - never use source_display_name as an automatic fallback once a stable source key exists.

begin;

create table if not exists public.payroll_source_identity_mappings (
  id uuid primary key default gen_random_uuid(),
  source_system text not null
    check (source_system ~ '^[a-z][a-z0-9_]{1,49}$'),
  source_employee_key text not null
    check (char_length(btrim(source_employee_key)) between 1 and 200),
  source_display_name text
    check (char_length(coalesce(source_display_name,'')) <= 160),
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active','revoked')),
  reviewed_at timestamptz not null,
  reviewed_by uuid not null references public.profiles(id) on delete restrict,
  review_reason text not null
    check (char_length(btrim(review_reason)) between 1 and 500),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete restrict,
  revoke_reason text
    check (char_length(coalesce(revoke_reason,'')) <= 500),
  created_at timestamptz not null default now(),
  check (
    (status='active' and revoked_at is null and revoked_by is null)
    or
    (status='revoked' and revoked_at is not null and revoked_by is not null and char_length(btrim(coalesce(revoke_reason,''))) > 0)
  )
);

-- A source key can resolve to only one active canonical employee.
create unique index if not exists payroll_source_identity_active_key_uq
  on public.payroll_source_identity_mappings(source_system, source_employee_key)
  where status='active';

-- One canonical employee can have only one currently-active identity per source system.
-- A changed/reissued source key requires revoking the old mapping first, preserving history.
create unique index if not exists payroll_source_identity_active_employee_uq
  on public.payroll_source_identity_mappings(source_system, employee_uuid)
  where status='active';

alter table public.payroll_source_identity_mappings enable row level security;

revoke all on public.payroll_source_identity_mappings
from public, anon, authenticated;

comment on column public.payroll_source_identity_mappings.source_employee_key is
  'Stable identifier owned by the payroll source, not public.employees.employee_id.';
comment on column public.payroll_source_identity_mappings.source_display_name is
  'Human review context only. Never use as a silent fallback when source_employee_key exists.';

-- Trusted resolver: exact active source-key lookup only. No name fallback.
create or replace function public.private_resolve_payroll_source_identity(
  p_source_system text,
  p_source_employee_key text
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_uuid uuid;
begin
  if p_source_system is null or btrim(p_source_system) = ''
     or p_source_employee_key is null or btrim(p_source_employee_key) = '' then
    raise exception 'PAYROLL_SOURCE_IDENTITY_KEY_REQUIRED';
  end if;

  select m.employee_uuid
    into v_employee_uuid
    from public.payroll_source_identity_mappings m
   where m.source_system = p_source_system
     and m.source_employee_key = p_source_employee_key
     and m.status = 'active';

  if v_employee_uuid is null then
    raise exception 'PAYROLL_SOURCE_IDENTITY_UNRESOLVED';
  end if;

  return v_employee_uuid;
end;
$$;

revoke all on function public.private_resolve_payroll_source_identity(text,text)
from public, anon, authenticated;

-- Promotion requirements still pending:
-- - operations_manager/payroll.manage reviewed create/revoke RPCs;
-- - append-only audit for mapping creation/revocation without copying payroll amounts;
-- - staging verification that canonical employees already present are reused rather than duplicated;
-- - real-data import approval.
--
-- Intentionally absent:
-- - any update of public.employees.employee_id to TJ-EMP-xxxx;
-- - name-only automatic mapping;
-- - resident-registration, bank-account, disability, health or support fields;
-- - broad browser table access;
-- - staging/Production application.

rollback;
