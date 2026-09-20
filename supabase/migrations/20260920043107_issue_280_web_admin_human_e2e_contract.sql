-- Issue #280: align the promotion-lead navigation with the existing server-authoritative
-- capability gates. This adds no payroll capability and does not change attendance subject policy.
-- Hosted deployment remains a separate, explicitly approved operation.

begin;

insert into public.role_capability_grants(role_id, capability_code)
select role.id, capability.code
from public.roles role
join public.platform_capabilities capability
  on capability.code in ('task.manage', 'schedule.manage', 'notice.manage')
where role.code = 'promotion_lead'
  and role.active
  and capability.active
on conflict (role_id, capability_code) do nothing;

-- The capability registry is the authority. Promotion leads remain restricted to
-- their own department/work-group targets; they do not receive the operations
-- manager's company-wide scope or guidance/payroll capabilities.
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
        public.current_user_has_role('promotion_lead')
        and public.private_actor_can('task.manage')
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
  is_department_manager boolean := public.current_user_has_role('department_lead')
    or public.current_user_has_role('promotion_lead');
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
    return is_department_manager
      and public.current_user_department_id() = p_department_id;
  elsif p_target_scope = 'work_group' then
    select work_group.department_id
    into target_department
    from public.work_groups work_group
    where work_group.id = p_work_group_id
      and work_group.active;

    return (
      is_department_manager
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

    if is_department_manager
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

-- The older private pre-148 readers retained their historic role check after the
-- public capability wrappers were introduced. Define the public readers directly
-- so a granted promotion_lead reaches the same scope filter without inheriting
-- operations-manager authority.
create or replace function public.get_today_board_admin_options()
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

  return jsonb_build_object(
    'company_allowed', public.current_user_has_role('operations_manager'),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('id', department.id, 'name', department.name) order by department.sort_order, department.name)
      from public.departments department
      where department.active
        and public.current_user_can_manage_today_target('department', department.id, null, null)
    ), '[]'::jsonb),
    'work_groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', work_group.id, 'name', work_group.name, 'department_id', work_group.department_id) order by work_group.sort_order, work_group.name)
      from public.work_groups work_group
      where work_group.active
        and public.current_user_can_manage_today_target('work_group', null, work_group.id, null)
    ), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object('id', profile.id, 'name', profile.display_name, 'department_id', profile.department_id) order by profile.display_name)
      from public.profiles profile
      where profile.account_status = 'active'
        and public.current_user_can_manage_today_target('profile', null, null, profile.id)
    ), '[]'::jsonb),
    'work_guides', coalesce((
      select jsonb_agg(jsonb_build_object('id', guide.id, 'title', guide.title, 'department_id', guide.department_id, 'status', guide.status) order by guide.title)
      from public.work_guides guide
      where guide.status <> 'inactive'
        and public.current_user_can_manage_department(guide.department_id)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_manageable_today_records(p_board_date date default current_date)
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
  return jsonb_build_object(
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(task) order by task.start_time nulls last, task.created_at)
      from public.daily_work_assignments task
      where task.work_date = p_board_date
        and public.current_user_can_manage_today_target(task.target_scope, task.target_department_id, task.target_work_group_id, task.target_profile_id)
    ), '[]'::jsonb),
    'information', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.start_time nulls last, item.created_at)
      from public.today_information_items item
      where item.information_date = p_board_date
        and public.current_user_can_manage_today_target(item.target_scope, item.target_department_id, item.target_work_group_id, item.target_profile_id)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_manageable_schedules(p_include_past boolean default true, p_limit integer default 200)
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
  if p_limit not between 1 and 500 then raise exception using errcode = '22023', message = 'INVALID_LIMIT'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(item) order by item.starts_at desc, item.created_at desc)
    from (
      select schedule.*
      from public.schedule_items schedule
      where schedule.status <> 'inactive'
        and (p_include_past or coalesce(schedule.ends_at, schedule.starts_at) >= now())
        and public.current_user_can_manage_today_target(schedule.target_scope, schedule.target_department_id, schedule.target_work_group_id, schedule.target_profile_id)
      order by schedule.starts_at desc, schedule.created_at desc
      limit p_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_manageable_notices(p_limit integer default 200)
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
  if p_limit not between 1 and 500 then raise exception using errcode = '22023', message = 'INVALID_LIMIT'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(item) order by case item.importance when 'urgent' then 2 when 'important' then 1 else 0 end desc, item.publish_start_at desc, item.created_at desc)
    from (
      select notice.*
      from public.notices notice
      where notice.status <> 'inactive'
        and public.current_user_can_manage_today_target(notice.target_scope, notice.target_department_id, notice.target_work_group_id, notice.target_profile_id)
      order by case notice.importance when 'urgent' then 2 when 'important' then 1 else 0 end desc, notice.publish_start_at desc, notice.created_at desc
      limit p_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_notice_ack_summary(p_notice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  notice public.notices%rowtype;
  required_count integer := 0;
  acknowledged_count integer := 0;
begin
  if not public.private_actor_can('notice.manage') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  select * into notice from public.notices item where item.id = p_notice_id;
  if notice.id is null or not public.current_user_can_manage_today_target(notice.target_scope, notice.target_department_id, notice.target_work_group_id, notice.target_profile_id) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if notice.requires_acknowledgement then
    select count(*)::integer into required_count from public.profiles profile
    where public.private_target_matches_profile(profile.id, notice.target_scope, notice.target_department_id, notice.target_work_group_id, notice.target_profile_id, current_date);
    select count(*)::integer into acknowledged_count
    from public.notice_acknowledgements acknowledgement
    join public.profiles profile on profile.id = acknowledgement.profile_id
    where acknowledgement.notice_id = notice.id and acknowledgement.notice_version = notice.version_no
      and public.private_target_matches_profile(profile.id, notice.target_scope, notice.target_department_id, notice.target_work_group_id, notice.target_profile_id, current_date);
  end if;
  return jsonb_build_object('notice_id', notice.id, 'notice_version', notice.version_no, 'requires_acknowledgement', notice.requires_acknowledgement, 'required_count', required_count, 'acknowledged_count', acknowledged_count, 'unacknowledged_count', greatest(required_count - acknowledged_count, 0));
end;
$$;

-- The save implementations already preserve validation, append-only audit events,
-- and target checks. Wrap them only to bind each mutation to its exact capability.
alter function public.save_daily_work_assignment(uuid, date, time, time, text, text, uuid, text, text, uuid, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text)
  rename to private_save_daily_work_assignment_pre280;
alter function public.save_today_information_item(uuid, date, public.today_information_kind, time, time, text, text, text, text, boolean, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text)
  rename to private_save_today_information_item_pre280;
alter function public.save_schedule_item(uuid, public.schedule_item_type, text, timestamptz, timestamptz, boolean, text, text, text, text, timestamptz, text, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text, text, text, timestamptz, public.calendar_sync_direction)
  rename to private_save_schedule_item_pre280;
alter function public.save_notice(uuid, public.notice_kind, public.notice_importance, text, text, timestamptz, timestamptz, date, date, text, text, uuid, uuid, text, text, boolean, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text)
  rename to private_save_notice_pre280;
alter function public.save_work_guide(uuid, uuid, text, public.work_guide_category, public.work_guide_format, public.work_guide_audience_scope, uuid, text, text, text, text, text, text, text, text, boolean, public.board_record_status, text)
  rename to private_save_work_guide_pre280;
alter function public.save_work_guide_step(uuid, uuid, smallint, text, text, text, text, text, public.board_record_status, text)
  rename to private_save_work_guide_step_pre280;
alter function public.save_staff_guidance(uuid, public.staff_guidance_category, text, text, text, text, text, text, uuid, uuid, text, text, public.today_target_scope, uuid, uuid, uuid, integer, boolean, public.board_record_status, date, date, text)
  rename to private_save_staff_guidance_pre280;

revoke all on function public.private_save_daily_work_assignment_pre280(uuid, date, time, time, text, text, uuid, text, text, uuid, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) from public, anon, authenticated;
revoke all on function public.private_save_today_information_item_pre280(uuid, date, public.today_information_kind, time, time, text, text, text, text, boolean, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) from public, anon, authenticated;
revoke all on function public.private_save_schedule_item_pre280(uuid, public.schedule_item_type, text, timestamptz, timestamptz, boolean, text, text, text, text, timestamptz, text, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text, text, text, timestamptz, public.calendar_sync_direction) from public, anon, authenticated;
revoke all on function public.private_save_notice_pre280(uuid, public.notice_kind, public.notice_importance, text, text, timestamptz, timestamptz, date, date, text, text, uuid, uuid, text, text, boolean, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) from public, anon, authenticated;
revoke all on function public.private_save_work_guide_pre280(uuid, uuid, text, public.work_guide_category, public.work_guide_format, public.work_guide_audience_scope, uuid, text, text, text, text, text, text, text, text, boolean, public.board_record_status, text) from public, anon, authenticated;
revoke all on function public.private_save_work_guide_step_pre280(uuid, uuid, smallint, text, text, text, text, text, public.board_record_status, text) from public, anon, authenticated;
revoke all on function public.private_save_staff_guidance_pre280(uuid, public.staff_guidance_category, text, text, text, text, text, text, uuid, uuid, text, text, public.today_target_scope, uuid, uuid, uuid, integer, boolean, public.board_record_status, date, date, text) from public, anon, authenticated;

create function public.save_daily_work_assignment(
  p_assignment_id uuid, p_work_date date, p_start_time time, p_end_time time,
  p_title text, p_location text, p_lead_profile_id uuid, p_preparation_text text,
  p_caution_text text, p_work_guide_id uuid, p_target_scope public.today_target_scope,
  p_target_department_id uuid, p_target_work_group_id uuid, p_target_profile_id uuid,
  p_status public.board_record_status, p_change_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.private_actor_can('task.manage') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  return public.private_save_daily_work_assignment_pre280(p_assignment_id, p_work_date, p_start_time, p_end_time, p_title, p_location, p_lead_profile_id, p_preparation_text, p_caution_text, p_work_guide_id, p_target_scope, p_target_department_id, p_target_work_group_id, p_target_profile_id, p_status, p_change_reason);
end;
$$;

create function public.save_today_information_item(
  p_information_id uuid, p_information_date date, p_kind public.today_information_kind,
  p_start_time time, p_end_time time, p_title text, p_body_easy text, p_location text,
  p_preparation_text text, p_important boolean, p_target_scope public.today_target_scope,
  p_target_department_id uuid, p_target_work_group_id uuid, p_target_profile_id uuid,
  p_status public.board_record_status, p_change_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.private_actor_can('task.manage') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  return public.private_save_today_information_item_pre280(p_information_id, p_information_date, p_kind, p_start_time, p_end_time, p_title, p_body_easy, p_location, p_preparation_text, p_important, p_target_scope, p_target_department_id, p_target_work_group_id, p_target_profile_id, p_status, p_change_reason);
end;
$$;

create function public.save_schedule_item(
  p_schedule_id uuid, p_schedule_type public.schedule_item_type, p_title text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_all_day boolean, p_location text,
  p_manager_label text, p_materials_text text, p_transport_method text,
  p_vehicle_departure_at timestamptz, p_easy_text text, p_target_scope public.today_target_scope,
  p_target_department_id uuid, p_target_work_group_id uuid, p_target_profile_id uuid,
  p_status public.board_record_status, p_change_reason text, p_external_provider text default null,
  p_external_event_id text default null, p_last_synced_at timestamptz default null,
  p_sync_direction public.calendar_sync_direction default 'none'
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.private_actor_can('schedule.manage') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  return public.private_save_schedule_item_pre280(p_schedule_id, p_schedule_type, p_title, p_starts_at, p_ends_at, p_all_day, p_location, p_manager_label, p_materials_text, p_transport_method, p_vehicle_departure_at, p_easy_text, p_target_scope, p_target_department_id, p_target_work_group_id, p_target_profile_id, p_status, p_change_reason, p_external_provider, p_external_event_id, p_last_synced_at, p_sync_direction);
end;
$$;

create function public.save_notice(
  p_notice_id uuid, p_notice_kind public.notice_kind, p_importance public.notice_importance,
  p_title text, p_body_easy text, p_publish_start_at timestamptz, p_publish_end_at timestamptz,
  p_effective_start_date date, p_effective_end_date date, p_location text, p_materials_text text,
  p_related_schedule_id uuid, p_related_work_guide_id uuid, p_related_link_url text,
  p_related_link_label text, p_requires_acknowledgement boolean, p_target_scope public.today_target_scope,
  p_target_department_id uuid, p_target_work_group_id uuid, p_target_profile_id uuid,
  p_status public.board_record_status, p_change_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.private_actor_can('notice.manage') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  return public.private_save_notice_pre280(p_notice_id, p_notice_kind, p_importance, p_title, p_body_easy, p_publish_start_at, p_publish_end_at, p_effective_start_date, p_effective_end_date, p_location, p_materials_text, p_related_schedule_id, p_related_work_guide_id, p_related_link_url, p_related_link_label, p_requires_acknowledgement, p_target_scope, p_target_department_id, p_target_work_group_id, p_target_profile_id, p_status, p_change_reason);
end;
$$;

create function public.save_work_guide(
  p_work_guide_id uuid, p_department_id uuid, p_title text, p_category public.work_guide_category,
  p_guide_format public.work_guide_format, p_audience_scope public.work_guide_audience_scope,
  p_audience_department_id uuid, p_summary_text text, p_materials_text text, p_caution_text text,
  p_common_mistakes_text text, p_completion_text text, p_contact_label text, p_cover_image_url text,
  p_cover_image_alt text, p_is_featured boolean, p_status public.board_record_status, p_change_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.private_actor_can('guidance.manage') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  return public.private_save_work_guide_pre280(p_work_guide_id, p_department_id, p_title, p_category, p_guide_format, p_audience_scope, p_audience_department_id, p_summary_text, p_materials_text, p_caution_text, p_common_mistakes_text, p_completion_text, p_contact_label, p_cover_image_url, p_cover_image_alt, p_is_featured, p_status, p_change_reason);
end;
$$;

create function public.save_work_guide_step(
  p_step_id uuid, p_work_guide_id uuid, p_step_order smallint, p_title text, p_easy_text text,
  p_image_url text, p_image_alt text, p_caution_text text, p_status public.board_record_status,
  p_change_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.private_actor_can('guidance.manage') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  return public.private_save_work_guide_step_pre280(p_step_id, p_work_guide_id, p_step_order, p_title, p_easy_text, p_image_url, p_image_alt, p_caution_text, p_status, p_change_reason);
end;
$$;

create function public.save_staff_guidance(
  p_guidance_id uuid, p_category public.staff_guidance_category, p_title text, p_summary_easy text,
  p_body_easy text, p_location_text text, p_help_contact_label text, p_help_method_text text,
  p_related_work_guide_id uuid, p_related_schedule_id uuid, p_related_link_url text,
  p_related_link_label text, p_target_scope public.today_target_scope, p_target_department_id uuid,
  p_target_work_group_id uuid, p_target_profile_id uuid, p_display_order integer, p_is_featured boolean,
  p_status public.board_record_status, p_effective_from date, p_effective_until date, p_change_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.private_actor_can('guidance.manage') then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  return public.private_save_staff_guidance_pre280(p_guidance_id, p_category, p_title, p_summary_easy, p_body_easy, p_location_text, p_help_contact_label, p_help_method_text, p_related_work_guide_id, p_related_schedule_id, p_related_link_url, p_related_link_label, p_target_scope, p_target_department_id, p_target_work_group_id, p_target_profile_id, p_display_order, p_is_featured, p_status, p_effective_from, p_effective_until, p_change_reason);
end;
$$;

alter function public.save_daily_work_assignment(uuid, date, time, time, text, text, uuid, text, text, uuid, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) owner to postgres;
alter function public.save_today_information_item(uuid, date, public.today_information_kind, time, time, text, text, text, text, boolean, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) owner to postgres;
alter function public.save_schedule_item(uuid, public.schedule_item_type, text, timestamptz, timestamptz, boolean, text, text, text, text, timestamptz, text, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text, text, text, timestamptz, public.calendar_sync_direction) owner to postgres;
alter function public.save_notice(uuid, public.notice_kind, public.notice_importance, text, text, timestamptz, timestamptz, date, date, text, text, uuid, uuid, text, text, boolean, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) owner to postgres;
alter function public.save_work_guide(uuid, uuid, text, public.work_guide_category, public.work_guide_format, public.work_guide_audience_scope, uuid, text, text, text, text, text, text, text, text, boolean, public.board_record_status, text) owner to postgres;
alter function public.save_work_guide_step(uuid, uuid, smallint, text, text, text, text, text, public.board_record_status, text) owner to postgres;
alter function public.save_staff_guidance(uuid, public.staff_guidance_category, text, text, text, text, text, text, uuid, uuid, text, text, public.today_target_scope, uuid, uuid, uuid, integer, boolean, public.board_record_status, date, date, text) owner to postgres;

revoke all on function public.save_daily_work_assignment(uuid, date, time, time, text, text, uuid, text, text, uuid, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) from public, anon;
revoke all on function public.save_today_information_item(uuid, date, public.today_information_kind, time, time, text, text, text, text, boolean, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) from public, anon;
revoke all on function public.save_schedule_item(uuid, public.schedule_item_type, text, timestamptz, timestamptz, boolean, text, text, text, text, timestamptz, text, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text, text, text, timestamptz, public.calendar_sync_direction) from public, anon;
revoke all on function public.save_notice(uuid, public.notice_kind, public.notice_importance, text, text, timestamptz, timestamptz, date, date, text, text, uuid, uuid, text, text, boolean, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) from public, anon;
revoke all on function public.save_work_guide(uuid, uuid, text, public.work_guide_category, public.work_guide_format, public.work_guide_audience_scope, uuid, text, text, text, text, text, text, text, text, boolean, public.board_record_status, text) from public, anon;
revoke all on function public.save_work_guide_step(uuid, uuid, smallint, text, text, text, text, text, public.board_record_status, text) from public, anon;
revoke all on function public.save_staff_guidance(uuid, public.staff_guidance_category, text, text, text, text, text, text, uuid, uuid, text, text, public.today_target_scope, uuid, uuid, uuid, integer, boolean, public.board_record_status, date, date, text) from public, anon;
grant execute on function public.save_daily_work_assignment(uuid, date, time, time, text, text, uuid, text, text, uuid, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) to authenticated;
grant execute on function public.save_today_information_item(uuid, date, public.today_information_kind, time, time, text, text, text, text, boolean, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) to authenticated;
grant execute on function public.save_schedule_item(uuid, public.schedule_item_type, text, timestamptz, timestamptz, boolean, text, text, text, text, timestamptz, text, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text, text, text, timestamptz, public.calendar_sync_direction) to authenticated;
grant execute on function public.save_notice(uuid, public.notice_kind, public.notice_importance, text, text, timestamptz, timestamptz, date, date, text, text, uuid, uuid, text, text, boolean, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) to authenticated;
grant execute on function public.save_work_guide(uuid, uuid, text, public.work_guide_category, public.work_guide_format, public.work_guide_audience_scope, uuid, text, text, text, text, text, text, text, text, boolean, public.board_record_status, text) to authenticated;
grant execute on function public.save_work_guide_step(uuid, uuid, smallint, text, text, text, text, text, public.board_record_status, text) to authenticated;
grant execute on function public.save_staff_guidance(uuid, public.staff_guidance_category, text, text, text, text, text, text, uuid, uuid, text, text, public.today_target_scope, uuid, uuid, uuid, integer, boolean, public.board_record_status, date, date, text) to authenticated;

commit;
