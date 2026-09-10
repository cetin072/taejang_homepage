-- Issue #146: disambiguate the operational account-unlink RPC.
-- Forward-only correction; preserves existing audit and last-super-admin guards.
begin;

create or replace function public.unlink_employee_account(
  p_employee_uuid uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  employee_row public.employees%rowtype;
  v_linked_profile_id uuid;
  v_reason text := nullif(btrim(p_reason), '');
  active_super_admin_count integer;
begin
  if actor_id is null or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'ACCOUNT_UNLINK_FORBIDDEN';
  end if;
  if v_reason is null then
    raise exception using errcode = '22023', message = 'ACCOUNT_UNLINK_REASON_REQUIRED';
  end if;

  select * into employee_row from public.employees where id = p_employee_uuid for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  select account_link.profile_id into v_linked_profile_id
  from public.account_person_links account_link
  where account_link.person_id = employee_row.person_id and account_link.revoked_at is null
  limit 1 for update;
  if v_linked_profile_id is null then
    return jsonb_build_object('ok', true, 'code', 'EMPLOYEE_ACCOUNT_ALREADY_UNLINKED');
  end if;
  if v_linked_profile_id = actor_id then
    raise exception using errcode = '42501', message = 'ACCOUNT_UNLINK_SELF_FORBIDDEN';
  end if;
  if exists (
    select 1 from public.profile_roles assignment join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = v_linked_profile_id and assignment.revoked_at is null and role.code = 'super_admin'
  ) then
    select count(distinct profile.id) into active_super_admin_count
    from public.profiles profile
    join public.profile_roles assignment on assignment.profile_id = profile.id and assignment.revoked_at is null
    join public.roles role on role.id = assignment.role_id and role.code = 'super_admin'
    where profile.account_status = 'active';
    if active_super_admin_count <= 1 then
      raise exception using errcode = '42501', message = 'LAST_ACTIVE_SUPER_ADMIN_PROTECTED';
    end if;
  end if;

  update public.account_person_links account_link
  set revoked_at = now(), revoked_by = actor_id, reason = left(v_reason, 300)
  where account_link.person_id = employee_row.person_id
    and account_link.profile_id = v_linked_profile_id
    and account_link.revoked_at is null;
  perform public.private_append_audit(actor_id, 'employee_account_unlinked', 'employee', employee_row.id::text,
    'success', left(v_reason, 300), jsonb_build_object('profile_id', v_linked_profile_id, 'employee_id', employee_row.employee_id));
  return jsonb_build_object('ok', true, 'code', 'EMPLOYEE_ACCOUNT_UNLINKED');
end;
$$;

revoke all on function public.unlink_employee_account(uuid, text) from public, anon;
grant execute on function public.unlink_employee_account(uuid, text) to authenticated;

commit;
