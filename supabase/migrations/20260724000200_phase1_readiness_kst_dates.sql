-- Phase 1 readiness: make worker-facing date defaults deterministic in Korea Standard Time.
begin;

create or replace function public.korea_current_date()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Seoul')::date;
$$;

-- Work-group membership and schedule queries must not switch a day early when
-- a Supabase/PostgREST session happens to run in UTC.
create or replace function public.private_target_matches_profile(
  p_profile_id uuid,
  p_target_scope public.today_target_scope,
  p_department_id uuid,
  p_work_group_id uuid,
  p_target_profile_id uuid,
  p_reference_date date default public.korea_current_date()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = p_profile_id
      and profile.account_status = 'active'
      and case p_target_scope
        when 'company' then true
        when 'department' then profile.department_id = p_department_id
        when 'work_group' then exists (
          select 1
          from public.work_group_members membership
          join public.work_groups work_group on work_group.id = membership.work_group_id
          where membership.profile_id = profile.id
            and membership.work_group_id = p_work_group_id
            and membership.start_date <= p_reference_date
            and (membership.end_date is null or membership.end_date >= p_reference_date)
            and work_group.active
        )
        when 'profile' then profile.id = p_target_profile_id
        else false
      end
  );
$$;

create or replace function public.get_my_schedule_list(
  p_from_date date default public.korea_current_date(),
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if p_limit not between 1 and 200 then
    raise exception using errcode = '22023', message = 'INVALID_LIMIT';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', item.id,
      'schedule_type', item.schedule_type,
      'title', item.title,
      'starts_at', item.starts_at,
      'ends_at', item.ends_at,
      'all_day', item.all_day,
      'location', item.location,
      'manager_label', item.manager_label,
      'materials', item.materials_text,
      'transport_method', item.transport_method,
      'vehicle_departure_at', item.vehicle_departure_at,
      'easy_text', item.easy_text,
      'status', item.status,
      'is_changed', item.revision_no > 1,
      'updated_at', item.updated_at
    ) order by item.starts_at, item.created_at)
    from (
      select schedule.*
      from public.schedule_items schedule
      where schedule.status in ('published', 'cancelled')
        and (
          (schedule.starts_at at time zone 'Asia/Seoul')::date >= p_from_date
          or (coalesce(schedule.ends_at, schedule.starts_at) at time zone 'Asia/Seoul')::date >= p_from_date
        )
        and public.today_target_matches_current_user(
          schedule.target_scope,
          schedule.target_department_id,
          schedule.target_work_group_id,
          schedule.target_profile_id
        )
      order by schedule.starts_at, schedule.created_at
      limit p_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

create or replace function public.private_staff_guidance_is_current(p_item public.staff_guidance_items)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_item.status = 'published'
    and (p_item.effective_from is null or p_item.effective_from <= public.korea_current_date())
    and (p_item.effective_until is null or p_item.effective_until >= public.korea_current_date());
$$;

-- These functions use current_date internally. Their function-local setting keeps
-- acknowledgement counts and explicit Today calls on the same KST day.
alter function public.current_user_in_work_group(uuid) set timezone to 'Asia/Seoul';
alter function public.current_user_leads_work_group(uuid) set timezone to 'Asia/Seoul';
alter function public.current_user_can_manage_today_target(public.today_target_scope, uuid, uuid, uuid) set timezone to 'Asia/Seoul';
alter function public.current_user_can_manage_work_guide(uuid) set timezone to 'Asia/Seoul';
alter function public.get_my_work_guide_list(public.work_guide_category, boolean, boolean) set timezone to 'Asia/Seoul';
alter function public.get_notice_ack_summary(uuid) set timezone to 'Asia/Seoul';
alter function public.get_my_today_board(date) set timezone to 'Asia/Seoul';

alter function public.korea_current_date() owner to postgres;
alter function public.private_target_matches_profile(uuid, public.today_target_scope, uuid, uuid, uuid, date) owner to postgres;
alter function public.get_my_schedule_list(date, integer) owner to postgres;
alter function public.private_staff_guidance_is_current(public.staff_guidance_items) owner to postgres;

revoke execute on function public.korea_current_date() from public, anon;
grant execute on function public.korea_current_date() to authenticated;

commit;
