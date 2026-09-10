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

-- Public payroll RPC guard. After current-main resync this is the authoritative form;
-- it replaces the legacy direct role-string predicate currently present in the older
-- operations_manager_access_candidate.sql prototype when candidates are consolidated.
create or replace function public.private_payroll_operator_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
     and public.private_actor_can('payroll.manage');
$$;

revoke all on function public.private_payroll_operator_allowed()
  from public, anon, authenticated;

-- Trusted persistence runs under an internal service credential, so auth.uid() there is
-- not the original operator. Re-check the original actor explicitly. For the approved
-- operations_manager-only MVP, capability parity means:
--   1) profile is still active;
--   2) actual role still contains operations_manager;
--   3) no active lower-role simulation has removed operational capabilities;
--   4) payroll.manage remains an active operational OM auto-grant capability.
-- If the platform later adds a generic profile-id capability evaluator, prefer that helper
-- instead of duplicating these semantics.
create or replace function public.private_payroll_actor_allowed(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor_id is not null
    and exists (
      select 1
      from public.profiles p
      where p.id = p_actor_id
        and p.account_status = 'active'
    )
    and exists (
      select 1
      from public.profile_roles pr
      join public.roles r on r.id = pr.role_id
      where pr.profile_id = p_actor_id
        and pr.revoked_at is null
        and r.active
        and r.code = 'operations_manager'
    )
    and not exists (
      select 1
      from public.role_simulation_modes s
      where s.profile_id = p_actor_id
        and s.expires_at > now()
        and s.role_code <> 'operations_manager'
    )
    and exists (
      select 1
      from public.platform_capabilities c
      where c.code = 'payroll.manage'
        and c.active
        and c.capability_kind = 'operational'
        and c.operations_manager_auto_grant
    );
$$;

revoke all on function public.private_payroll_actor_allowed(uuid)
  from public, anon, authenticated;

-- No grants are made to anon/authenticated on capability registry tables.
-- Existing fail-closed capability-table access from Issue #148 remains authoritative.

rollback;
