-- Staging-applied payroll capability boundary for Shadow MVP.
-- operations_manager only; technical super_admin is not an operational bypass.
begin;

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

create or replace function public.private_require_payroll_operator()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not public.private_payroll_operator_allowed() then
    raise exception using errcode='42501', message='PAYROLL_ACCESS_FORBIDDEN';
  end if;
  return actor_id;
end;
$$;

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

revoke all on function public.private_payroll_operator_allowed()
from public, anon, authenticated;
revoke all on function public.private_require_payroll_operator()
from public, anon, authenticated;
revoke all on function public.private_payroll_actor_allowed(uuid)
from public, anon, authenticated;

commit;
