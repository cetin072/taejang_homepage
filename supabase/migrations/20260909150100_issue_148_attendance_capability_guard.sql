-- Issue #148 safeguard: executive personal-attendance exclusion is based on
-- actual authority, so lower-role simulation must not re-enable self attendance.

begin;

create or replace function public.private_actor_capabilities()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actual_roles text[] := public.private_actual_role_codes();
  effective_roles text[] := public.private_effective_role_codes();
  result text[];
begin
  if not public.current_profile_is_active() then
    return array[]::text[];
  end if;

  select coalesce(array_agg(capability.code order by capability.code), array[]::text[])
  into result
  from public.platform_capabilities capability
  where capability.active
    and not (
      capability.code = 'attendance.self_record'
      and (
        'operations_manager' = any(actual_roles)
        or 'ceo' = any(actual_roles)
      )
    )
    and (
      (
        capability.capability_kind = 'operational'
        and (
          ('operations_manager' = any(effective_roles) and capability.operations_manager_auto_grant)
          or exists (
            select 1
            from public.role_capability_grants grant_row
            join public.roles role on role.id = grant_row.role_id
            where grant_row.capability_code = capability.code
              and role.code = any(effective_roles)
              and role.active
          )
        )
      )
      or (
        capability.capability_kind = 'technical'
        and exists (
          select 1
          from public.role_capability_grants grant_row
          join public.roles role on role.id = grant_row.role_id
          where grant_row.capability_code = capability.code
            and role.code = any(actual_roles)
            and role.active
        )
      )
    );

  return result;
end;
$$;

revoke all on function public.private_actor_capabilities() from public, anon, authenticated;

commit;
