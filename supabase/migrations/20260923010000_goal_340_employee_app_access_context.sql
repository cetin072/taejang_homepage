-- Goal #340 S1: employee-app entry presentation is declared by the server-owned
-- access context. This does not change RPC/RLS authorization semantics.

begin;

create or replace function public.private_has_work_platform_access(p_capability_codes text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_capability_codes && array[
      'employee.view_all',
      'employee.view_scoped',
      'employee.create',
      'employee.request_change',
      'employee.onboard',
      'account.view_management',
      'promotion.write',
      'promotion.edit_own',
      'promotion.edit_any_unpublished',
      'promotion.review_lead',
      'promotion.review_operations',
      'promotion.review_ceo',
      'promotion.queue_publication',
      'promotion.manage_recent_public',
      'promotion.archive',
      'promotion.restore',
      'promotion.hide',
      'promotion.republish',
      'homepage.draft',
      'homepage.review',
      'homepage.approve_apply',
      'homepage.direct_edit',
      'task.manage',
      'schedule.manage',
      'notice.manage',
      'guidance.manage',
      'attendance.admin_view',
      'attendance.correct',
      'payroll.manage',
      'payroll.handoff.review',
      'payroll.handoff.approve',
      'support_radar.management_view',
      'support_radar.management_edit',
      'support_radar.assigned_work',
      'platform.navigation.manage'
    ]::text[],
    false
  );
$$;

create or replace function public.get_my_access_context_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_context jsonb := public.get_my_access_context();
  actual_roles jsonb := '[]'::jsonb;
  capability_codes text[] := array[]::text[];
begin
  if base_context is null then
    return null;
  end if;

  if coalesce(base_context->>'account_status', '') = 'active' then
    select coalesce(
      jsonb_agg(jsonb_build_object('code', role.code, 'name', role.name) order by role.code),
      '[]'::jsonb
    )
    into actual_roles
    from public.profile_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = (select auth.uid())
      and assignment.revoked_at is null
      and role.active;

    capability_codes := public.private_actor_capabilities();
  end if;

  return base_context || jsonb_build_object(
    'access_contract_version', 2,
    'actual_roles', actual_roles,
    'effective_roles', coalesce(base_context->'roles', '[]'::jsonb),
    'capabilities', to_jsonb(capability_codes),
    'work_platform_available', public.private_has_work_platform_access(capability_codes)
  );
end;
$$;

revoke all on function public.private_has_work_platform_access(text[]) from public, anon, authenticated;

comment on function public.private_has_work_platform_access(text[]) is
  'Server-owned employee-app entry presentation rule. It declares whether the authenticated account has an internal work-platform branch beyond self-service employee-app features.';

comment on function public.get_my_access_context_v2() is
  'Authenticated client access context. Capabilities and work_platform_available are server-declared presentation inputs; RPC/RLS remain the final authorization authority.';

commit;
