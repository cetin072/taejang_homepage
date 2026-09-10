-- Issue #148: remove remaining direct super_admin bypasses from normal operations.
-- Existing implementations are preserved behind private wrappers so scope/business
-- validation remains unchanged while capability authorization becomes authoritative.

begin;

-- Work-group RLS: technical super_admin alone must not receive normal business reads.
drop policy if exists work_groups_read on public.work_groups;
create policy work_groups_read on public.work_groups
for select to authenticated
using (
  (active and (select public.current_user_in_work_group(id)))
  or (
    (select public.private_actor_can('task.manage'))
    and (
      (select public.current_user_has_role('operations_manager'))
      or (
        (select public.current_user_has_role('department_lead'))
        and (select public.current_user_department_id()) = department_id
      )
      or (
        (select public.current_user_has_role('field_lead'))
        and (select public.current_user_leads_work_group(id))
      )
    )
  )
);

-- Preserve old implementations under private names.
alter function public.get_today_board_admin_options()
  rename to private_get_today_board_admin_options_pre148;
alter function public.list_manageable_today_records(date)
  rename to private_list_manageable_today_records_pre148;
alter function public.save_work_group(uuid, uuid, text, boolean, text)
  rename to private_save_work_group_pre148;
alter function public.set_work_group_member(uuid, uuid, public.work_group_member_type, date, date, text)
  rename to private_set_work_group_member_pre148;
alter function public.list_manageable_schedules(boolean, integer)
  rename to private_list_manageable_schedules_pre148;
alter function public.list_manageable_notices(integer)
  rename to private_list_manageable_notices_pre148;
alter function public.get_notice_ack_summary(uuid)
  rename to private_get_notice_ack_summary_pre148;
alter function public.list_manageable_staff_guidance(integer)
  rename to private_list_manageable_staff_guidance_pre148;
alter function public.get_staff_guidance_for_edit(uuid)
  rename to private_get_staff_guidance_for_edit_pre148;

revoke all on function public.private_get_today_board_admin_options_pre148() from public, anon, authenticated;
revoke all on function public.private_list_manageable_today_records_pre148(date) from public, anon, authenticated;
revoke all on function public.private_save_work_group_pre148(uuid, uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.private_set_work_group_member_pre148(uuid, uuid, public.work_group_member_type, date, date, text) from public, anon, authenticated;
revoke all on function public.private_list_manageable_schedules_pre148(boolean, integer) from public, anon, authenticated;
revoke all on function public.private_list_manageable_notices_pre148(integer) from public, anon, authenticated;
revoke all on function public.private_get_notice_ack_summary_pre148(uuid) from public, anon, authenticated;
revoke all on function public.private_list_manageable_staff_guidance_pre148(integer) from public, anon, authenticated;
revoke all on function public.private_get_staff_guidance_for_edit_pre148(uuid) from public, anon, authenticated;

create function public.get_today_board_admin_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    public.private_actor_can('task.manage')
    or public.private_actor_can('schedule.manage')
    or public.private_actor_can('notice.manage')
    or public.private_actor_can('guidance.manage')
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return public.private_get_today_board_admin_options_pre148();
end;
$$;

create function public.list_manageable_today_records(p_board_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('task.manage') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return public.private_list_manageable_today_records_pre148(p_board_date);
end;
$$;

create function public.save_work_group(
  p_work_group_id uuid,
  p_department_id uuid,
  p_name text,
  p_active boolean,
  p_change_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('task.manage') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  return public.private_save_work_group_pre148(
    p_work_group_id, p_department_id, p_name, p_active, p_change_reason
  );
end;
$$;

create function public.set_work_group_member(
  p_work_group_id uuid,
  p_profile_id uuid,
  p_member_type public.work_group_member_type,
  p_start_date date,
  p_end_date date,
  p_change_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('task.manage') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  return public.private_set_work_group_member_pre148(
    p_work_group_id, p_profile_id, p_member_type, p_start_date, p_end_date, p_change_reason
  );
end;
$$;

create function public.list_manageable_schedules(
  p_include_past boolean default true,
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('schedule.manage') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return public.private_list_manageable_schedules_pre148(p_include_past, p_limit);
end;
$$;

create function public.list_manageable_notices(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('notice.manage') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return public.private_list_manageable_notices_pre148(p_limit);
end;
$$;

create function public.get_notice_ack_summary(p_notice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('notice.manage') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return public.private_get_notice_ack_summary_pre148(p_notice_id);
end;
$$;

create function public.list_manageable_staff_guidance(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('guidance.manage') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return public.private_list_manageable_staff_guidance_pre148(p_limit);
end;
$$;

create function public.get_staff_guidance_for_edit(p_guidance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('guidance.manage') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return public.private_get_staff_guidance_for_edit_pre148(p_guidance_id);
end;
$$;

alter function public.get_today_board_admin_options() owner to postgres;
alter function public.list_manageable_today_records(date) owner to postgres;
alter function public.save_work_group(uuid, uuid, text, boolean, text) owner to postgres;
alter function public.set_work_group_member(uuid, uuid, public.work_group_member_type, date, date, text) owner to postgres;
alter function public.list_manageable_schedules(boolean, integer) owner to postgres;
alter function public.list_manageable_notices(integer) owner to postgres;
alter function public.get_notice_ack_summary(uuid) owner to postgres;
alter function public.list_manageable_staff_guidance(integer) owner to postgres;
alter function public.get_staff_guidance_for_edit(uuid) owner to postgres;

revoke all on function public.get_today_board_admin_options() from public, anon;
revoke all on function public.list_manageable_today_records(date) from public, anon;
revoke all on function public.save_work_group(uuid, uuid, text, boolean, text) from public, anon;
revoke all on function public.set_work_group_member(uuid, uuid, public.work_group_member_type, date, date, text) from public, anon;
revoke all on function public.list_manageable_schedules(boolean, integer) from public, anon;
revoke all on function public.list_manageable_notices(integer) from public, anon;
revoke all on function public.get_notice_ack_summary(uuid) from public, anon;
revoke all on function public.list_manageable_staff_guidance(integer) from public, anon;
revoke all on function public.get_staff_guidance_for_edit(uuid) from public, anon;

grant execute on function public.get_today_board_admin_options() to authenticated;
grant execute on function public.list_manageable_today_records(date) to authenticated;
grant execute on function public.save_work_group(uuid, uuid, text, boolean, text) to authenticated;
grant execute on function public.set_work_group_member(uuid, uuid, public.work_group_member_type, date, date, text) to authenticated;
grant execute on function public.list_manageable_schedules(boolean, integer) to authenticated;
grant execute on function public.list_manageable_notices(integer) to authenticated;
grant execute on function public.get_notice_ack_summary(uuid) to authenticated;
grant execute on function public.list_manageable_staff_guidance(integer) to authenticated;
grant execute on function public.get_staff_guidance_for_edit(uuid) to authenticated;

commit;
