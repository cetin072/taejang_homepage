-- Taejang staff schedules, important notices, and versioned acknowledgements.
-- Apply only after 20260723000300_accessible_work_guides.sql.

begin;

create type public.schedule_item_type as enum (
  'work',
  'training',
  'external_activity',
  'holiday',
  'location_change',
  'special_event',
  'transport',
  'other'
);

create type public.notice_kind as enum (
  'safety',
  'working_hours',
  'work_location',
  'training',
  'external_activity',
  'holiday',
  'transport',
  'materials',
  'clothing',
  'company_life',
  'general'
);

create type public.notice_importance as enum (
  'normal',
  'important',
  'urgent'
);

create type public.calendar_sync_direction as enum (
  'none',
  'platform_to_external',
  'external_to_platform',
  'bidirectional'
);

create or replace function public.is_safe_https_url(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is not null
    and char_length(p_url) between 9 and 2000
    and p_url ~ '^https://[A-Za-z0-9.-]+(?::[0-9]+)?(?:[/?#][^[:cntrl:][:space:]]*)?$'
    and position('@' in p_url) = 0
    and position(chr(92) in p_url) = 0;
$$;

create table public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  schedule_type public.schedule_item_type not null,
  title text not null check (char_length(title) between 1 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text check (char_length(coalesce(location, '')) <= 200),
  manager_label text check (char_length(coalesce(manager_label, '')) <= 160),
  materials_text text check (char_length(coalesce(materials_text, '')) <= 1000),
  transport_method text check (char_length(coalesce(transport_method, '')) <= 500),
  vehicle_departure_at timestamptz,
  easy_text text not null check (char_length(easy_text) between 1 and 2000),
  target_scope public.today_target_scope not null,
  target_department_id uuid references public.departments(id) on delete restrict,
  target_work_group_id uuid references public.work_groups(id) on delete restrict,
  target_profile_id uuid references public.profiles(id) on delete restrict,
  status public.board_record_status not null default 'draft',
  revision_no integer not null default 1 check (revision_no > 0),
  change_reason text not null check (char_length(change_reason) between 1 and 300),
  external_provider text check (external_provider is null or external_provider = 'google_calendar'),
  external_event_id text check (char_length(coalesce(external_event_id, '')) <= 1024),
  last_synced_at timestamptz,
  sync_direction public.calendar_sync_direction not null default 'none',
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (
    (external_provider is null and external_event_id is null)
    or (external_provider is not null and external_event_id is not null)
  ),
  check (
    (target_scope = 'company' and target_department_id is null and target_work_group_id is null and target_profile_id is null)
    or (target_scope = 'department' and target_department_id is not null and target_work_group_id is null and target_profile_id is null)
    or (target_scope = 'work_group' and target_department_id is null and target_work_group_id is not null and target_profile_id is null)
    or (target_scope = 'profile' and target_department_id is null and target_work_group_id is null and target_profile_id is not null)
  )
);

create unique index schedule_items_external_event_unique
  on public.schedule_items (external_provider, external_event_id)
  where external_provider is not null and external_event_id is not null;

create index schedule_items_upcoming_idx
  on public.schedule_items (status, starts_at, ends_at);

create index schedule_items_department_idx
  on public.schedule_items (target_department_id, starts_at)
  where target_department_id is not null;

create index schedule_items_work_group_idx
  on public.schedule_items (target_work_group_id, starts_at)
  where target_work_group_id is not null;

create index schedule_items_profile_idx
  on public.schedule_items (target_profile_id, starts_at)
  where target_profile_id is not null;

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  notice_kind public.notice_kind not null,
  importance public.notice_importance not null default 'normal',
  title text not null check (char_length(title) between 1 and 120),
  body_easy text not null check (char_length(body_easy) between 1 and 3000),
  publish_start_at timestamptz not null,
  publish_end_at timestamptz,
  effective_start_date date,
  effective_end_date date,
  location text check (char_length(coalesce(location, '')) <= 200),
  materials_text text check (char_length(coalesce(materials_text, '')) <= 1000),
  related_schedule_id uuid references public.schedule_items(id) on delete restrict,
  related_work_guide_id uuid references public.work_guides(id) on delete restrict,
  related_link_url text,
  related_link_label text check (char_length(coalesce(related_link_label, '')) <= 160),
  requires_acknowledgement boolean not null default false,
  version_no integer not null default 1 check (version_no > 0),
  target_scope public.today_target_scope not null,
  target_department_id uuid references public.departments(id) on delete restrict,
  target_work_group_id uuid references public.work_groups(id) on delete restrict,
  target_profile_id uuid references public.profiles(id) on delete restrict,
  status public.board_record_status not null default 'draft',
  change_reason text not null check (char_length(change_reason) between 1 and 300),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (publish_end_at is null or publish_end_at > publish_start_at),
  check (effective_end_date is null or effective_start_date is null or effective_end_date >= effective_start_date),
  check (not requires_acknowledgement or importance in ('important', 'urgent')),
  check (
    (related_link_url is null and related_link_label is null)
    or (
      related_link_url is not null
      and related_link_label is not null
      and public.is_safe_https_url(related_link_url)
    )
  ),
  check (status <> 'published' or published_at is not null),
  check (
    (target_scope = 'company' and target_department_id is null and target_work_group_id is null and target_profile_id is null)
    or (target_scope = 'department' and target_department_id is not null and target_work_group_id is null and target_profile_id is null)
    or (target_scope = 'work_group' and target_department_id is null and target_work_group_id is not null and target_profile_id is null)
    or (target_scope = 'profile' and target_department_id is null and target_work_group_id is null and target_profile_id is not null)
  )
);

create index notices_active_window_idx
  on public.notices (status, publish_start_at, publish_end_at, importance);

create index notices_department_idx
  on public.notices (target_department_id, publish_start_at)
  where target_department_id is not null;

create index notices_work_group_idx
  on public.notices (target_work_group_id, publish_start_at)
  where target_work_group_id is not null;

create index notices_profile_idx
  on public.notices (target_profile_id, publish_start_at)
  where target_profile_id is not null;

create table public.notice_acknowledgements (
  notice_id uuid not null references public.notices(id) on delete restrict,
  notice_version integer not null check (notice_version > 0),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  acknowledged_at timestamptz not null default now(),
  primary key (notice_id, notice_version, profile_id)
);

create index notice_acknowledgements_profile_idx
  on public.notice_acknowledgements (profile_id, acknowledged_at desc);

comment on table public.schedule_items is
  'Canonical staff schedule data. The Taejang platform remains the source of truth; external calendar fields are optional sync metadata only.';
comment on table public.notices is
  'Canonical versioned staff notices with publication windows, safe related links, and target scope.';
comment on table public.notice_acknowledgements is
  'Version-specific notice acknowledgement only. It is not attendance, performance, or evaluation data.';

create or replace function public.private_target_matches_profile(
  p_profile_id uuid,
  p_target_scope public.today_target_scope,
  p_department_id uuid,
  p_work_group_id uuid,
  p_target_profile_id uuid,
  p_reference_date date default current_date
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

create or replace function public.private_notice_is_current(p_notice public.notices)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_notice.status = 'published'
    and p_notice.publish_start_at <= now()
    and (p_notice.publish_end_at is null or p_notice.publish_end_at >= now());
$$;

create or replace function public.get_my_schedule_list(
  p_from_date date default current_date,
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

create or replace function public.get_my_schedule_detail(p_schedule_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select jsonb_build_object(
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
    'updated_at', item.updated_at,
    'created_at', item.created_at
  )
  into result
  from public.schedule_items item
  where item.id = p_schedule_id
    and item.status in ('published', 'cancelled')
    and public.today_target_matches_current_user(
      item.target_scope,
      item.target_department_id,
      item.target_work_group_id,
      item.target_profile_id
    );

  if result is null then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return result;
end;
$$;

create or replace function public.get_my_notice_list(p_limit integer default 100)
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
      'notice_kind', item.notice_kind,
      'importance', item.importance,
      'title', item.title,
      'summary', left(item.body_easy, 220),
      'publish_start_at', item.publish_start_at,
      'publish_end_at', item.publish_end_at,
      'requires_acknowledgement', item.requires_acknowledgement,
      'version_no', item.version_no,
      'acknowledged', exists (
        select 1
        from public.notice_acknowledgements acknowledgement
        where acknowledgement.notice_id = item.id
          and acknowledgement.notice_version = item.version_no
          and acknowledgement.profile_id = (select auth.uid())
      ),
      'is_new', item.publish_start_at >= now() - interval '7 days',
      'is_changed', item.version_no > 1,
      'updated_at', item.updated_at
    ) order by
      case item.importance when 'urgent' then 2 when 'important' then 1 else 0 end desc,
      item.publish_start_at desc,
      item.created_at desc)
    from (
      select notice.*
      from public.notices notice
      where public.private_notice_is_current(notice)
        and public.today_target_matches_current_user(
          notice.target_scope,
          notice.target_department_id,
          notice.target_work_group_id,
          notice.target_profile_id
        )
      order by
        case notice.importance when 'urgent' then 2 when 'important' then 1 else 0 end desc,
        notice.publish_start_at desc,
        notice.created_at desc
      limit p_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_my_notice_detail(p_notice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select jsonb_build_object(
    'id', notice.id,
    'notice_kind', notice.notice_kind,
    'importance', notice.importance,
    'title', notice.title,
    'body_easy', notice.body_easy,
    'publish_start_at', notice.publish_start_at,
    'publish_end_at', notice.publish_end_at,
    'effective_start_date', notice.effective_start_date,
    'effective_end_date', notice.effective_end_date,
    'location', notice.location,
    'materials', notice.materials_text,
    'related_schedule_id', notice.related_schedule_id,
    'related_work_guide_id', notice.related_work_guide_id,
    'related_link_url', notice.related_link_url,
    'related_link_label', notice.related_link_label,
    'requires_acknowledgement', notice.requires_acknowledgement,
    'version_no', notice.version_no,
    'acknowledged', exists (
      select 1
      from public.notice_acknowledgements acknowledgement
      where acknowledgement.notice_id = notice.id
        and acknowledgement.notice_version = notice.version_no
        and acknowledgement.profile_id = (select auth.uid())
    ),
    'acknowledged_at', (
      select acknowledgement.acknowledged_at
      from public.notice_acknowledgements acknowledgement
      where acknowledgement.notice_id = notice.id
        and acknowledgement.notice_version = notice.version_no
        and acknowledgement.profile_id = (select auth.uid())
    ),
    'updated_at', notice.updated_at
  )
  into result
  from public.notices notice
  where notice.id = p_notice_id
    and public.private_notice_is_current(notice)
    and public.today_target_matches_current_user(
      notice.target_scope,
      notice.target_department_id,
      notice.target_work_group_id,
      notice.target_profile_id
    );

  if result is null then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return result;
end;
$$;

create or replace function public.acknowledge_notice(
  p_notice_id uuid,
  p_notice_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  notice public.notices%rowtype;
  acknowledged_time timestamptz := now();
begin
  if not public.current_profile_is_active() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into notice
  from public.notices item
  where item.id = p_notice_id
  for share;

  if notice.id is null
     or not public.private_notice_is_current(notice)
     or not public.today_target_matches_current_user(
       notice.target_scope,
       notice.target_department_id,
       notice.target_work_group_id,
       notice.target_profile_id
     ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if not notice.requires_acknowledgement then
    return jsonb_build_object('ok', false, 'code', 'ACKNOWLEDGEMENT_NOT_REQUIRED');
  end if;
  if notice.version_no <> p_notice_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'NOTICE_VERSION_CHANGED',
      'current_version', notice.version_no
    );
  end if;

  insert into public.notice_acknowledgements (
    notice_id,
    notice_version,
    profile_id,
    acknowledged_at
  ) values (
    notice.id,
    notice.version_no,
    auth.uid(),
    acknowledged_time
  )
  on conflict (notice_id, notice_version, profile_id)
  do update set acknowledged_at = excluded.acknowledged_at;

  return jsonb_build_object(
    'ok', true,
    'code', 'NOTICE_ACKNOWLEDGED',
    'notice_id', notice.id,
    'notice_version', notice.version_no,
    'acknowledged_at', acknowledged_time
  );
end;
$$;

create or replace function public.list_manageable_schedules(
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
  if not (
    public.current_user_has_role('super_admin')
    or public.current_user_has_role('operations_manager')
    or public.current_user_has_role('department_lead')
    or public.current_user_has_role('field_lead')
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_LIMIT';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(item) order by item.starts_at desc, item.created_at desc)
    from (
      select schedule.*
      from public.schedule_items schedule
      where (p_include_past or coalesce(schedule.ends_at, schedule.starts_at) >= now())
        and public.current_user_can_manage_today_target(
          schedule.target_scope,
          schedule.target_department_id,
          schedule.target_work_group_id,
          schedule.target_profile_id
        )
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
  if not (
    public.current_user_has_role('super_admin')
    or public.current_user_has_role('operations_manager')
    or public.current_user_has_role('department_lead')
    or public.current_user_has_role('field_lead')
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_LIMIT';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(item) order by
      case item.importance when 'urgent' then 2 when 'important' then 1 else 0 end desc,
      item.publish_start_at desc,
      item.created_at desc)
    from (
      select notice.*
      from public.notices notice
      where public.current_user_can_manage_today_target(
        notice.target_scope,
        notice.target_department_id,
        notice.target_work_group_id,
        notice.target_profile_id
      )
      order by
        case notice.importance when 'urgent' then 2 when 'important' then 1 else 0 end desc,
        notice.publish_start_at desc,
        notice.created_at desc
      limit p_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

create or replace function public.save_schedule_item(
  p_schedule_id uuid,
  p_schedule_type public.schedule_item_type,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_all_day boolean,
  p_location text,
  p_manager_label text,
  p_materials_text text,
  p_transport_method text,
  p_vehicle_departure_at timestamptz,
  p_easy_text text,
  p_target_scope public.today_target_scope,
  p_target_department_id uuid,
  p_target_work_group_id uuid,
  p_target_profile_id uuid,
  p_status public.board_record_status,
  p_change_reason text,
  p_external_provider text default null,
  p_external_event_id text default null,
  p_last_synced_at timestamptz default null,
  p_sync_direction public.calendar_sync_direction default 'none'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  old_item public.schedule_items%rowtype;
  action_code text;
begin
  perform public.private_validate_today_target(
    p_target_scope,
    p_target_department_id,
    p_target_work_group_id,
    p_target_profile_id
  );
  if not public.current_user_can_manage_today_target(
    p_target_scope,
    p_target_department_id,
    p_target_work_group_id,
    p_target_profile_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_easy_text, ''))) not between 1 and 2000
     or char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 300
     or p_starts_at is null
     or (p_ends_at is not null and p_ends_at <= p_starts_at)
     or (p_external_provider is not null and p_external_provider <> 'google_calendar')
     or (p_external_provider is not null and btrim(coalesce(p_external_event_id, '')) = '')
     or ((p_external_provider is null) <> (p_external_event_id is null)) then
    raise exception using errcode = '22023', message = 'INVALID_SCHEDULE';
  end if;

  if p_schedule_id is null then
    insert into public.schedule_items (
      schedule_type, title, starts_at, ends_at, all_day, location, manager_label,
      materials_text, transport_method, vehicle_departure_at, easy_text,
      target_scope, target_department_id, target_work_group_id, target_profile_id,
      status, change_reason, external_provider, external_event_id, last_synced_at,
      sync_direction, created_by, updated_by
    ) values (
      p_schedule_type, btrim(p_title), p_starts_at, p_ends_at, p_all_day,
      nullif(btrim(coalesce(p_location, '')), ''),
      nullif(btrim(coalesce(p_manager_label, '')), ''),
      nullif(btrim(coalesce(p_materials_text, '')), ''),
      nullif(btrim(coalesce(p_transport_method, '')), ''),
      p_vehicle_departure_at, btrim(p_easy_text),
      p_target_scope, p_target_department_id, p_target_work_group_id, p_target_profile_id,
      p_status, btrim(p_change_reason), p_external_provider,
      nullif(btrim(coalesce(p_external_event_id, '')), ''), p_last_synced_at,
      p_sync_direction, auth.uid(), auth.uid()
    )
    returning id into saved_id;
    action_code := 'schedule_created';
  else
    select * into old_item
    from public.schedule_items item
    where item.id = p_schedule_id
    for update;

    if old_item.id is null
       or not public.current_user_can_manage_today_target(
         old_item.target_scope,
         old_item.target_department_id,
         old_item.target_work_group_id,
         old_item.target_profile_id
       ) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
    end if;

    update public.schedule_items
    set schedule_type = p_schedule_type,
        title = btrim(p_title),
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        all_day = p_all_day,
        location = nullif(btrim(coalesce(p_location, '')), ''),
        manager_label = nullif(btrim(coalesce(p_manager_label, '')), ''),
        materials_text = nullif(btrim(coalesce(p_materials_text, '')), ''),
        transport_method = nullif(btrim(coalesce(p_transport_method, '')), ''),
        vehicle_departure_at = p_vehicle_departure_at,
        easy_text = btrim(p_easy_text),
        target_scope = p_target_scope,
        target_department_id = p_target_department_id,
        target_work_group_id = p_target_work_group_id,
        target_profile_id = p_target_profile_id,
        status = p_status,
        revision_no = revision_no + 1,
        change_reason = btrim(p_change_reason),
        external_provider = p_external_provider,
        external_event_id = nullif(btrim(coalesce(p_external_event_id, '')), ''),
        last_synced_at = p_last_synced_at,
        sync_direction = p_sync_direction,
        updated_by = auth.uid(),
        updated_at = now()
    where id = p_schedule_id
    returning id into saved_id;

    action_code := case
      when old_item.status <> 'cancelled' and p_status = 'cancelled' then 'schedule_cancelled'
      when old_item.status <> 'inactive' and p_status = 'inactive' then 'schedule_inactivated'
      else 'schedule_updated'
    end;
  end if;

  perform public.private_append_audit(
    auth.uid(),
    action_code,
    'schedule_item',
    saved_id::text,
    'success',
    p_change_reason,
    jsonb_build_object(
      'previous_status', old_item.status,
      'status', p_status,
      'previous_revision', old_item.revision_no,
      'revision', case when p_schedule_id is null then 1 else old_item.revision_no + 1 end,
      'time_changed', p_schedule_id is not null and (
        old_item.starts_at is distinct from p_starts_at
        or old_item.ends_at is distinct from p_ends_at
        or old_item.vehicle_departure_at is distinct from p_vehicle_departure_at
      ),
      'location_changed', p_schedule_id is not null and old_item.location is distinct from nullif(btrim(coalesce(p_location, '')), ''),
      'target_changed', p_schedule_id is not null and (
        old_item.target_scope is distinct from p_target_scope
        or old_item.target_department_id is distinct from p_target_department_id
        or old_item.target_work_group_id is distinct from p_target_work_group_id
        or old_item.target_profile_id is distinct from p_target_profile_id
      ),
      'schedule_type', p_schedule_type,
      'external_provider', p_external_provider,
      'sync_direction', p_sync_direction
    )
  );

  return jsonb_build_object('ok', true, 'code', 'SCHEDULE_SAVED', 'id', saved_id);
end;
$$;

create or replace function public.save_notice(
  p_notice_id uuid,
  p_notice_kind public.notice_kind,
  p_importance public.notice_importance,
  p_title text,
  p_body_easy text,
  p_publish_start_at timestamptz,
  p_publish_end_at timestamptz,
  p_effective_start_date date,
  p_effective_end_date date,
  p_location text,
  p_materials_text text,
  p_related_schedule_id uuid,
  p_related_work_guide_id uuid,
  p_related_link_url text,
  p_related_link_label text,
  p_requires_acknowledgement boolean,
  p_target_scope public.today_target_scope,
  p_target_department_id uuid,
  p_target_work_group_id uuid,
  p_target_profile_id uuid,
  p_status public.board_record_status,
  p_change_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  saved_version integer;
  old_item public.notices%rowtype;
  action_code text;
begin
  perform public.private_validate_today_target(
    p_target_scope,
    p_target_department_id,
    p_target_work_group_id,
    p_target_profile_id
  );
  if not public.current_user_can_manage_today_target(
    p_target_scope,
    p_target_department_id,
    p_target_work_group_id,
    p_target_profile_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_body_easy, ''))) not between 1 and 3000
     or char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 300
     or p_publish_start_at is null
     or (p_publish_end_at is not null and p_publish_end_at <= p_publish_start_at)
     or (p_effective_start_date is not null and p_effective_end_date is not null and p_effective_end_date < p_effective_start_date)
     or (p_requires_acknowledgement and p_importance = 'normal')
     or ((p_related_link_url is null) <> (p_related_link_label is null))
     or (p_related_link_url is not null and not public.is_safe_https_url(p_related_link_url)) then
    raise exception using errcode = '22023', message = 'INVALID_NOTICE';
  end if;
  if p_related_schedule_id is not null
     and not exists (
       select 1 from public.schedule_items schedule
       where schedule.id = p_related_schedule_id
         and public.current_user_can_manage_today_target(
           schedule.target_scope,
           schedule.target_department_id,
           schedule.target_work_group_id,
           schedule.target_profile_id
         )
     ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN_RELATED_SCHEDULE');
  end if;
  if p_related_work_guide_id is not null
     and not public.current_user_can_manage_work_guide(p_related_work_guide_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN_RELATED_WORK_GUIDE');
  end if;

  if p_notice_id is null then
    insert into public.notices (
      notice_kind, importance, title, body_easy, publish_start_at, publish_end_at,
      effective_start_date, effective_end_date, location, materials_text,
      related_schedule_id, related_work_guide_id, related_link_url, related_link_label,
      requires_acknowledgement, version_no, target_scope, target_department_id,
      target_work_group_id, target_profile_id, status, change_reason, created_by,
      updated_by, published_at
    ) values (
      p_notice_kind, p_importance, btrim(p_title), btrim(p_body_easy),
      p_publish_start_at, p_publish_end_at, p_effective_start_date, p_effective_end_date,
      nullif(btrim(coalesce(p_location, '')), ''),
      nullif(btrim(coalesce(p_materials_text, '')), ''),
      p_related_schedule_id, p_related_work_guide_id,
      nullif(btrim(coalesce(p_related_link_url, '')), ''),
      nullif(btrim(coalesce(p_related_link_label, '')), ''),
      p_requires_acknowledgement, 1, p_target_scope, p_target_department_id,
      p_target_work_group_id, p_target_profile_id, p_status, btrim(p_change_reason),
      auth.uid(), auth.uid(), case when p_status = 'published' then now() else null end
    )
    returning id, version_no into saved_id, saved_version;
    action_code := case when p_status = 'published' then 'notice_published' else 'notice_created' end;
  else
    select * into old_item
    from public.notices item
    where item.id = p_notice_id
    for update;

    if old_item.id is null
       or not public.current_user_can_manage_today_target(
         old_item.target_scope,
         old_item.target_department_id,
         old_item.target_work_group_id,
         old_item.target_profile_id
       ) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
    end if;

    update public.notices
    set notice_kind = p_notice_kind,
        importance = p_importance,
        title = btrim(p_title),
        body_easy = btrim(p_body_easy),
        publish_start_at = p_publish_start_at,
        publish_end_at = p_publish_end_at,
        effective_start_date = p_effective_start_date,
        effective_end_date = p_effective_end_date,
        location = nullif(btrim(coalesce(p_location, '')), ''),
        materials_text = nullif(btrim(coalesce(p_materials_text, '')), ''),
        related_schedule_id = p_related_schedule_id,
        related_work_guide_id = p_related_work_guide_id,
        related_link_url = nullif(btrim(coalesce(p_related_link_url, '')), ''),
        related_link_label = nullif(btrim(coalesce(p_related_link_label, '')), ''),
        requires_acknowledgement = p_requires_acknowledgement,
        version_no = version_no + 1,
        target_scope = p_target_scope,
        target_department_id = p_target_department_id,
        target_work_group_id = p_target_work_group_id,
        target_profile_id = p_target_profile_id,
        status = p_status,
        change_reason = btrim(p_change_reason),
        updated_by = auth.uid(),
        published_at = case
          when p_status = 'published' and published_at is null then now()
          else published_at
        end,
        updated_at = now()
    where id = p_notice_id
    returning id, version_no into saved_id, saved_version;

    action_code := case
      when old_item.status <> 'published' and p_status = 'published' then 'notice_published'
      when old_item.status <> 'inactive' and p_status = 'inactive' then 'notice_inactivated'
      when old_item.status <> 'cancelled' and p_status = 'cancelled' then 'notice_cancelled'
      else 'notice_updated'
    end;
  end if;

  perform public.private_append_audit(
    auth.uid(),
    action_code,
    'notice',
    saved_id::text,
    'success',
    p_change_reason,
    jsonb_build_object(
      'previous_status', old_item.status,
      'status', p_status,
      'previous_version', old_item.version_no,
      'version', saved_version,
      'previous_importance', old_item.importance,
      'importance', p_importance,
      'acknowledgement_changed', p_notice_id is not null and old_item.requires_acknowledgement is distinct from p_requires_acknowledgement,
      'target_changed', p_notice_id is not null and (
        old_item.target_scope is distinct from p_target_scope
        or old_item.target_department_id is distinct from p_target_department_id
        or old_item.target_work_group_id is distinct from p_target_work_group_id
        or old_item.target_profile_id is distinct from p_target_profile_id
      ),
      'related_schedule_changed', p_notice_id is not null and old_item.related_schedule_id is distinct from p_related_schedule_id,
      'related_work_guide_changed', p_notice_id is not null and old_item.related_work_guide_id is distinct from p_related_work_guide_id,
      'related_link_changed', p_notice_id is not null and old_item.related_link_url is distinct from p_related_link_url
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'NOTICE_SAVED',
    'id', saved_id,
    'version_no', saved_version
  );
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
  select * into notice
  from public.notices item
  where item.id = p_notice_id;

  if notice.id is null
     or not public.current_user_can_manage_today_target(
       notice.target_scope,
       notice.target_department_id,
       notice.target_work_group_id,
       notice.target_profile_id
     ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  if notice.requires_acknowledgement then
    select count(*)::integer into required_count
    from public.profiles profile
    where public.private_target_matches_profile(
      profile.id,
      notice.target_scope,
      notice.target_department_id,
      notice.target_work_group_id,
      notice.target_profile_id,
      current_date
    );

    select count(*)::integer into acknowledged_count
    from public.notice_acknowledgements acknowledgement
    join public.profiles profile on profile.id = acknowledgement.profile_id
    where acknowledgement.notice_id = notice.id
      and acknowledgement.notice_version = notice.version_no
      and public.private_target_matches_profile(
        profile.id,
        notice.target_scope,
        notice.target_department_id,
        notice.target_work_group_id,
        notice.target_profile_id,
        current_date
      );
  end if;

  return jsonb_build_object(
    'notice_id', notice.id,
    'notice_version', notice.version_no,
    'requires_acknowledgement', notice.requires_acknowledgement,
    'required_count', required_count,
    'acknowledged_count', acknowledged_count,
    'unacknowledged_count', greatest(required_count - acknowledged_count, 0)
  );
end;
$$;

-- Keep the legacy Today rows readable while adding canonical schedule and notice summaries.
create or replace function public.get_my_today_board(p_board_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  board jsonb;
begin
  if not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select jsonb_build_object(
    'date', p_board_date,
    'display_name', profile.display_name,
    'work_hours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'title', item.title,
        'start_time', item.start_time,
        'end_time', item.end_time,
        'location', item.location,
        'body', item.body_easy,
        'status', item.status
      ) order by item.start_time nulls last, item.created_at)
      from public.today_information_items item
      where item.information_date = p_board_date
        and item.kind = 'work_hours'
        and item.status in ('published', 'cancelled')
        and public.today_target_matches_current_user(
          item.target_scope,
          item.target_department_id,
          item.target_work_group_id,
          item.target_profile_id
        )
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', task.id,
        'title', task.title,
        'start_time', task.start_time,
        'end_time', task.end_time,
        'location', task.location,
        'lead', case when lead.id is null then null else jsonb_build_object('id', lead.id, 'name', lead.display_name) end,
        'preparation', task.preparation_text,
        'caution', task.caution_text,
        'status', task.status,
        'work_guide', case when guide.id is null then null else jsonb_build_object(
          'id', guide.id,
          'title', guide.title,
          'summary', guide.summary_text,
          'materials', guide.materials_text,
          'caution', guide.caution_text
        ) end
      ) order by task.start_time nulls last, task.created_at)
      from public.daily_work_assignments task
      left join public.profiles lead
        on lead.id = task.lead_profile_id
       and lead.account_status = 'active'
      left join public.work_guides guide
        on guide.id = task.work_guide_id
       and guide.status = 'published'
      where task.work_date = p_board_date
        and task.status in ('published', 'cancelled')
        and public.today_target_matches_current_user(
          task.target_scope,
          task.target_department_id,
          task.target_work_group_id,
          task.target_profile_id
        )
    ), '[]'::jsonb),
    'information', coalesce((
      select jsonb_agg(entry.payload order by entry.priority desc, entry.sort_at nulls last, entry.created_at desc)
      from (
        select
          case when item.important then 20 else 1 end as priority,
          (p_board_date + coalesce(item.start_time, time '23:59'))::timestamp at time zone 'Asia/Seoul' as sort_at,
          item.created_at,
          jsonb_build_object(
            'source', 'legacy',
            'id', item.id,
            'kind', item.kind,
            'title', item.title,
            'body', item.body_easy,
            'start_time', item.start_time,
            'end_time', item.end_time,
            'location', item.location,
            'preparation', item.preparation_text,
            'important', item.important,
            'status', item.status
          ) as payload
        from public.today_information_items item
        where item.information_date = p_board_date
          and item.kind <> 'work_hours'
          and item.status in ('published', 'cancelled')
          and public.today_target_matches_current_user(
            item.target_scope,
            item.target_department_id,
            item.target_work_group_id,
            item.target_profile_id
          )

        union all

        select
          case
            when schedule.schedule_type in ('transport', 'location_change') then 30
            else 10
          end as priority,
          schedule.starts_at as sort_at,
          schedule.created_at,
          jsonb_build_object(
            'source', 'schedule',
            'detail_id', schedule.id,
            'id', schedule.id,
            'kind', schedule.schedule_type,
            'title', schedule.title,
            'body', schedule.easy_text,
            'start_time', (schedule.starts_at at time zone 'Asia/Seoul')::time,
            'end_time', (schedule.ends_at at time zone 'Asia/Seoul')::time,
            'starts_at', schedule.starts_at,
            'ends_at', schedule.ends_at,
            'location', schedule.location,
            'preparation', schedule.materials_text,
            'vehicle_departure_at', schedule.vehicle_departure_at,
            'important', schedule.schedule_type in ('transport', 'location_change'),
            'is_changed', schedule.revision_no > 1,
            'status', schedule.status
          ) as payload
        from public.schedule_items schedule
        where schedule.status in ('published', 'cancelled')
          and (schedule.starts_at at time zone 'Asia/Seoul')::date <= p_board_date
          and (coalesce(schedule.ends_at, schedule.starts_at) at time zone 'Asia/Seoul')::date >= p_board_date
          and public.today_target_matches_current_user(
            schedule.target_scope,
            schedule.target_department_id,
            schedule.target_work_group_id,
            schedule.target_profile_id
          )

        union all

        select
          case notice.importance when 'urgent' then 50 when 'important' then 40 else 35 end as priority,
          notice.publish_start_at as sort_at,
          notice.created_at,
          jsonb_build_object(
            'source', 'notice',
            'detail_id', notice.id,
            'id', notice.id,
            'kind', notice.notice_kind,
            'title', notice.title,
            'body', notice.body_easy,
            'start_time', null,
            'end_time', null,
            'location', notice.location,
            'preparation', notice.materials_text,
            'important', notice.importance <> 'normal',
            'importance', notice.importance,
            'requires_acknowledgement', notice.requires_acknowledgement,
            'acknowledged', exists (
              select 1
              from public.notice_acknowledgements acknowledgement
              where acknowledgement.notice_id = notice.id
                and acknowledgement.notice_version = notice.version_no
                and acknowledgement.profile_id = (select auth.uid())
            ),
            'status', notice.status
          ) as payload
        from public.notices notice
        where public.private_notice_is_current(notice)
          and (
            notice.importance <> 'normal'
            or (
              notice.requires_acknowledgement
              and not exists (
                select 1
                from public.notice_acknowledgements acknowledgement
                where acknowledgement.notice_id = notice.id
                  and acknowledgement.notice_version = notice.version_no
                  and acknowledgement.profile_id = (select auth.uid())
              )
            )
          )
          and public.today_target_matches_current_user(
            notice.target_scope,
            notice.target_department_id,
            notice.target_work_group_id,
            notice.target_profile_id
          )
      ) entry
    ), '[]'::jsonb)
  )
  into board
  from public.profiles profile
  where profile.id = (select auth.uid())
    and profile.account_status = 'active';

  return board;
end;
$$;

alter table public.schedule_items enable row level security;
alter table public.notices enable row level security;
alter table public.notice_acknowledgements enable row level security;

create policy schedule_items_manager_read on public.schedule_items
for select to authenticated
using (
  public.current_user_can_manage_today_target(
    target_scope,
    target_department_id,
    target_work_group_id,
    target_profile_id
  )
);

create policy notices_manager_read on public.notices
for select to authenticated
using (
  public.current_user_can_manage_today_target(
    target_scope,
    target_department_id,
    target_work_group_id,
    target_profile_id
  )
);

create policy notice_acknowledgements_own_read on public.notice_acknowledgements
for select to authenticated
using (
  public.current_profile_is_active()
  and profile_id = (select auth.uid())
);

alter function public.is_safe_https_url(text) owner to postgres;
alter function public.private_target_matches_profile(uuid, public.today_target_scope, uuid, uuid, uuid, date) owner to postgres;
alter function public.private_notice_is_current(public.notices) owner to postgres;
alter function public.get_my_schedule_list(date, integer) owner to postgres;
alter function public.get_my_schedule_detail(uuid) owner to postgres;
alter function public.get_my_notice_list(integer) owner to postgres;
alter function public.get_my_notice_detail(uuid) owner to postgres;
alter function public.acknowledge_notice(uuid, integer) owner to postgres;
alter function public.list_manageable_schedules(boolean, integer) owner to postgres;
alter function public.list_manageable_notices(integer) owner to postgres;
alter function public.save_schedule_item(
  uuid, public.schedule_item_type, text, timestamptz, timestamptz, boolean, text, text,
  text, text, timestamptz, text, public.today_target_scope, uuid, uuid, uuid,
  public.board_record_status, text, text, text, timestamptz, public.calendar_sync_direction
) owner to postgres;
alter function public.save_notice(
  uuid, public.notice_kind, public.notice_importance, text, text, timestamptz, timestamptz,
  date, date, text, text, uuid, uuid, text, text, boolean, public.today_target_scope,
  uuid, uuid, uuid, public.board_record_status, text
) owner to postgres;
alter function public.get_notice_ack_summary(uuid) owner to postgres;
alter function public.get_my_today_board(date) owner to postgres;

revoke all on table public.schedule_items from public, anon, authenticated;
revoke all on table public.notices from public, anon, authenticated;
revoke all on table public.notice_acknowledgements from public, anon, authenticated;

revoke execute on function public.is_safe_https_url(text) from public, anon;
revoke execute on function public.private_target_matches_profile(uuid, public.today_target_scope, uuid, uuid, uuid, date) from public, anon, authenticated;
revoke execute on function public.private_notice_is_current(public.notices) from public, anon, authenticated;
revoke execute on function public.get_my_schedule_list(date, integer) from public, anon;
revoke execute on function public.get_my_schedule_detail(uuid) from public, anon;
revoke execute on function public.get_my_notice_list(integer) from public, anon;
revoke execute on function public.get_my_notice_detail(uuid) from public, anon;
revoke execute on function public.acknowledge_notice(uuid, integer) from public, anon;
revoke execute on function public.list_manageable_schedules(boolean, integer) from public, anon;
revoke execute on function public.list_manageable_notices(integer) from public, anon;
revoke execute on function public.save_schedule_item(
  uuid, public.schedule_item_type, text, timestamptz, timestamptz, boolean, text, text,
  text, text, timestamptz, text, public.today_target_scope, uuid, uuid, uuid,
  public.board_record_status, text, text, text, timestamptz, public.calendar_sync_direction
) from public, anon;
revoke execute on function public.save_notice(
  uuid, public.notice_kind, public.notice_importance, text, text, timestamptz, timestamptz,
  date, date, text, text, uuid, uuid, text, text, boolean, public.today_target_scope,
  uuid, uuid, uuid, public.board_record_status, text
) from public, anon;
revoke execute on function public.get_notice_ack_summary(uuid) from public, anon;

grant execute on function public.is_safe_https_url(text) to authenticated;
grant execute on function public.get_my_schedule_list(date, integer) to authenticated;
grant execute on function public.get_my_schedule_detail(uuid) to authenticated;
grant execute on function public.get_my_notice_list(integer) to authenticated;
grant execute on function public.get_my_notice_detail(uuid) to authenticated;
grant execute on function public.acknowledge_notice(uuid, integer) to authenticated;
grant execute on function public.list_manageable_schedules(boolean, integer) to authenticated;
grant execute on function public.list_manageable_notices(integer) to authenticated;
grant execute on function public.save_schedule_item(
  uuid, public.schedule_item_type, text, timestamptz, timestamptz, boolean, text, text,
  text, text, timestamptz, text, public.today_target_scope, uuid, uuid, uuid,
  public.board_record_status, text, text, text, timestamptz, public.calendar_sync_direction
) to authenticated;
grant execute on function public.save_notice(
  uuid, public.notice_kind, public.notice_importance, text, text, timestamptz, timestamptz,
  date, date, text, text, uuid, uuid, text, text, boolean, public.today_target_scope,
  uuid, uuid, uuid, public.board_record_status, text
) to authenticated;
grant execute on function public.get_notice_ack_summary(uuid) to authenticated;

commit;
