-- Issue #148 Phase A: first real server-side migration from role-only management
-- authorization to capability-gated management. Scope rules stay unchanged.

begin;

create or replace function public.current_user_can_manage_department(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and (
      public.private_actor_can('task.manage')
      or public.private_actor_can('schedule.manage')
      or public.private_actor_can('notice.manage')
      or public.private_actor_can('guidance.manage')
    )
    and (
      public.current_user_has_role('operations_manager')
      or (
        public.current_user_has_role('department_lead')
        and public.current_user_department_id() = p_department_id
      )
      or (
        public.current_user_has_role('field_lead')
        and exists (
          select 1
          from public.work_groups work_group
          where work_group.department_id = p_department_id
            and public.current_user_leads_work_group(work_group.id)
        )
      )
    );
$$;

create or replace function public.current_user_can_manage_today_target(
  p_target_scope public.today_target_scope,
  p_department_id uuid,
  p_work_group_id uuid,
  p_profile_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_department uuid;
  has_management_capability boolean := (
    public.private_actor_can('task.manage')
    or public.private_actor_can('schedule.manage')
    or public.private_actor_can('notice.manage')
    or public.private_actor_can('guidance.manage')
  );
begin
  if not public.current_profile_is_active() or not has_management_capability then
    return false;
  end if;

  if public.current_user_has_role('operations_manager') then
    return true;
  end if;

  if p_target_scope = 'company' then
    return false;
  elsif p_target_scope = 'department' then
    return public.current_user_has_role('department_lead')
      and public.current_user_department_id() = p_department_id;
  elsif p_target_scope = 'work_group' then
    select work_group.department_id
    into target_department
    from public.work_groups work_group
    where work_group.id = p_work_group_id
      and work_group.active;

    return (
      public.current_user_has_role('department_lead')
      and public.current_user_department_id() = target_department
    ) or (
      public.current_user_has_role('field_lead')
      and public.current_user_leads_work_group(p_work_group_id)
    );
  elsif p_target_scope = 'profile' then
    select profile.department_id
    into target_department
    from public.profiles profile
    where profile.id = p_profile_id
      and profile.account_status = 'active';

    if public.current_user_has_role('department_lead')
       and public.current_user_department_id() = target_department then
      return true;
    end if;

    return public.current_user_has_role('field_lead')
      and exists (
        select 1
        from public.work_group_members worker_membership
        join public.work_group_members lead_membership
          on lead_membership.work_group_id = worker_membership.work_group_id
        join public.work_groups work_group on work_group.id = worker_membership.work_group_id
        where worker_membership.profile_id = p_profile_id
          and worker_membership.start_date <= current_date
          and (worker_membership.end_date is null or worker_membership.end_date >= current_date)
          and lead_membership.profile_id = (select auth.uid())
          and lead_membership.member_type = 'lead'
          and lead_membership.start_date <= current_date
          and (lead_membership.end_date is null or lead_membership.end_date >= current_date)
          and work_group.active
      );
  end if;

  return false;
end;
$$;

comment on function public.current_user_can_manage_today_target(
  public.today_target_scope, uuid, uuid, uuid
) is
  'Capability-gated management scope helper. operations_manager keeps operational superset; technical super_admin alone is not normal business authority.';

commit;
