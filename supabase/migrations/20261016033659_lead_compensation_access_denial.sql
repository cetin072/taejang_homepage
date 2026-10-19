-- Issue #474: user-approved removal of operations-lead payroll authority.
-- No payroll/attendance/HR/content rows or existing audit history are rewritten.
begin;

delete from public.role_capability_grants g
using public.roles r
where g.role_id = r.id
  and r.code = 'promotion_lead'
  and g.capability_code like 'payroll.%';

create or replace function public.private_payroll_handoff_reviewer_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and 'operations_manager' = any(public.private_actual_role_codes())
    and public.current_user_has_role('operations_manager')
    and public.private_actor_can('payroll.handoff.review');
$$;

revoke all on function public.private_payroll_handoff_reviewer_allowed()
from public, anon, authenticated;

create or replace function public.private_payroll_operator_allowed()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.current_profile_is_active()
    and 'operations_manager' = any(public.private_actual_role_codes())
    and public.current_user_has_role('operations_manager')
    and public.private_actor_can('payroll.manage');
$$;

create or replace function public.private_payroll_handoff_operations_allowed()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.current_profile_is_active()
    and 'operations_manager' = any(public.private_actual_role_codes())
    and public.current_user_has_role('operations_manager')
    and public.private_actor_can('payroll.handoff.approve');
$$;

revoke all on function public.private_payroll_operator_allowed()
from public, anon, authenticated;
revoke all on function public.private_payroll_handoff_operations_allowed()
from public, anon, authenticated;

commit;
