begin;

-- Match the operations lead's existing sensitive-information scope.
-- A delegated Employee menu can widen the resident-number helper's scope,
-- so keep the protected-target checks explicit for this data.
create or replace function private.require_employee_disability_access(p_employee_uuid uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actual_roles text[] := public.private_actual_role_codes();
  is_operations boolean := 'operations_manager' = any(actual_roles)
    and public.current_user_has_role('operations_manager');
  is_lead boolean := 'promotion_lead' = any(actual_roles)
    and public.current_user_has_role('promotion_lead');
begin
  if public.private_menu_denied('employee.manage') or not coalesce(is_operations or is_lead, false) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_DISABILITY_FORBIDDEN';
  end if;

  -- Keep the target's position and archival state stable until the RPC finishes.
  perform 1 from public.employees e where e.id = p_employee_uuid and e.archived_at is null for update;
  if not found then
    raise exception using errcode = '22023', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  if not is_operations and not coalesce(
    public.private_actor_can('employee.resident_number_manage')
    and not public.private_employee_is_protected(p_employee_uuid)
    and exists (
      select 1 from public.employees e
      join public.positions p on p.id = e.position_id
      where e.id = p_employee_uuid and e.employment_status in ('active', 'leave')
        and p.code not in ('ceo', 'executive_director', 'operations_manager',
          'system_super_admin', 'department_lead')
    ), false) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_DISABILITY_FORBIDDEN';
  end if;
end;
$$;

commit;
