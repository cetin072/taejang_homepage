begin;

-- Share the existing per-employee sensitive-information boundary for the
-- operations lead without granting access via a delegated Employee menu.
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
  if not is_operations and not coalesce(public.private_can_manage_employee_resident_number(p_employee_uuid), false) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_DISABILITY_FORBIDDEN';
  end if;
end;
$$;

commit;
