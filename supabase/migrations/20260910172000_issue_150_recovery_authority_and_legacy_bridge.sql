-- Issue #150: preserve the pre-existing operations-only delete/recovery authority.
-- Department/field leads keep their existing scoped edit/inactivate rights, but
-- archive/delete and restore are not broadened to new roles.
begin;

create or replace function public.private_actor_can_manage_recovery_target(
  p_capability text,
  p_target_scope public.today_target_scope,
  p_department_id uuid,
  p_work_group_id uuid,
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.private_actor_can(p_capability)
     and 'operations_manager' = any(public.private_effective_role_codes());
$$;

revoke all on function public.private_actor_can_manage_recovery_target(text, public.today_target_scope, uuid, uuid, uuid)
  from public, anon, authenticated;

-- Keep the existing browser RPC names as compatibility aliases, but route them
-- into the new recoverable archive contract so there is no non-recoverable
-- "delete" path left for these resources.
create or replace function public.delete_schedule_item(p_schedule_id uuid, p_reason text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.archive_schedule_item(p_schedule_id, p_reason);
$$;

create or replace function public.delete_notice(p_notice_id uuid, p_reason text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.archive_notice(p_notice_id, p_reason);
$$;

create or replace function public.delete_staff_guidance(p_guidance_id uuid, p_reason text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.archive_staff_guidance(p_guidance_id, p_reason);
$$;

revoke all on function public.delete_schedule_item(uuid,text) from public, anon;
revoke all on function public.delete_notice(uuid,text) from public, anon;
revoke all on function public.delete_staff_guidance(uuid,text) from public, anon;
grant execute on function public.delete_schedule_item(uuid,text), public.delete_notice(uuid,text), public.delete_staff_guidance(uuid,text) to authenticated;

comment on function public.delete_schedule_item(uuid,text) is 'Compatibility alias: recoverable schedule archive, not physical delete.';
comment on function public.delete_notice(uuid,text) is 'Compatibility alias: recoverable notice archive, not physical delete.';
comment on function public.delete_staff_guidance(uuid,text) is 'Compatibility alias: recoverable staff-guidance archive, not physical delete.';

commit;
