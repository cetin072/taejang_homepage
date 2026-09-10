-- Taejang Payroll Capability Authorization Candidate
-- Goal: #142 / PR #143
-- Status: CANDIDATE ONLY. ROLLBACK-ONLY. DO NOT APPLY TO STAGING/PRODUCTION WITHOUT A SEPARATE APPROVAL.
--
-- Current-main integration target (Issue #148 capability model):
-- - feature authorization is capability-based;
-- - operations_manager automatically inherits operational capabilities unless explicitly excluded;
-- - technical super_admin capabilities remain separate from normal operations.
--
-- User-approved payroll audience remains unchanged: operations_manager only.
-- This candidate changes the implementation mechanism, not the approved audience.

begin;

-- A single capability is sufficient for the first controlled MVP because the same
-- operations_manager performs payroll read + calculation + adjustment + accounting + lock.
-- If payroll is delegated later, split view/manage capabilities only through a new approval.
insert into public.platform_capabilities(
  code,
  capability_kind,
  operations_manager_auto_grant,
  description,
  active
)
values (
  'payroll.manage',
  'operational',
  true,
  '급여·근태 월마감 운영',
  true
)
on conflict (code) do update
set capability_kind = excluded.capability_kind,
    operations_manager_auto_grant = excluded.operations_manager_auto_grant,
    description = excluded.description,
    active = true,
    updated_at = now();

-- IMPORTANT: no role_capability_grants row is inserted here.
-- The approved MVP relies only on operations_manager_auto_grant.
-- Therefore ordinary staff, team/department leads, CEO and technical super_admin do not
-- gain payroll access from this candidate.

-- Guard against an accidental lower-role grant if this candidate is evaluated in an
-- environment that already contains an unexpected payroll capability record/grant.
do $$
begin
  if exists (
    select 1
    from public.role_capability_grants g
    join public.roles r on r.id = g.role_id
    where g.capability_code = 'payroll.manage'
      and r.active
      and r.code <> 'operations_manager'
  ) then
    raise exception using errcode='42501', message='PAYROLL_CAPABILITY_GRANT_CONFLICT';
  end if;
end;
$$;

-- No grants are made to anon/authenticated on capability registry tables.
-- Existing fail-closed capability-table access from Issue #148 remains authoritative.

rollback;
