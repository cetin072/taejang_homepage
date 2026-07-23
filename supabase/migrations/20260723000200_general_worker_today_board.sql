-- Taejang general-worker "Today" information board.
-- Apply only after 20260723000100_phase1a_security_foundation.sql.

begin;

create type public.today_target_scope as enum (
  'company',
  'department',
  'work_group',
  'profile'
);

create type public.work_group_member_type as enum (
  'worker',
  'lead',
  'assistant'
);

create type public.board_record_status as enum (
  'draft',
  'published',
  'cancelled',
  'inactive'
);

create type public.today_information_kind as enum (
  'work_hours',
  'training',
  'external_activity',
  'holiday',
  'location_change',
  'event',
  'transport',
  'notice',
  'safety'
);

create table public.work_groups (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, name)
);

create table public.work_group_members (
  id uuid primary key default gen_random_uuid(),
  work_group_id uuid not null references public.work_groups(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  member_type public.work_group_member_type not null default 'worker',
  start_date date not null,
  end_date date,
  assigned_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create unique index work_group_members_one_current_membership
  on public.work_group_members (work_group_id, profile_id, member_type)
  where end_date is null;

create index work_group_members_current_profile_idx
  on public.work_group_members (profile_id, work_group_id)
  where end_date is null;

create table public.work_guides (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 120),
  summary_text text check (char_length(coalesce(summary_text, '')) <= 500),
  materials_text text check (char_length(coalesce(materials_text, '')) <= 1000),
  caution_text text check (char_length(coalesce(caution_text, '')) <= 1000),
  status public.board_record_status not null default 'draft',
  version_no integer not null default 1 check (version_no > 0),
  change_reason text not null check (char_length(change_reason) between 1 and 300),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'published' or published_at is not null)
);

create table public.daily_work_assignments (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  start_time time,
  end_time time,
  title text not null check (char_length(title) between 1 and 120),
  location text not null check (char_length(location) between 1 and 200),
  lead_profile_id uuid references public.profiles(id) on delete restrict,
  preparation_text text check (char_length(coalesce(preparation_text, '')) <= 1000),
  caution_text text check (char_length(coalesce(caution_text, '')) <= 1000),
  work_guide_id uuid references public.work_guides(id) on delete restrict,
  target_scope public.today_target_scope not null,
  target_department_id uuid references public.departments(id) on delete restrict,
  target_work_group_id uuid references public.work_groups(id) on delete restrict,
  target_profile_id uuid references public.profiles(id) on delete restrict,
  status public.board_record_status not null default 'draft',
  change_reason text not null check (char_length(change_reason) between 1 and 300),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time is null or end_time is null or start_time < end_time),
  check (
    (target_scope = 'company' and target_department_id is null and target_work_group_id is null and target_profile_id is null)
    or (target_scope = 'department' and target_department_id is not null and target_work_group_id is null and target_profile_id is null)
    or (target_scope = 'work_group' and target_department_id is null and target_work_group_id is not null and target_profile_id is null)
    or (target_scope = 'profile' and target_department_id is null and target_work_group_id is null and target_profile_id is not null)
  )
);

create index daily_work_assignments_date_status_idx
  on public.daily_work_assignments (work_date, status, start_time);

create index daily_work_assignments_group_idx
  on public.daily_work_assignments (target_work_group_id, work_date)
  where target_work_group_id is not null;

create index daily_work_assignments_profile_idx
  on public.daily_work_assignments (target_profile_id, work_date)
  where target_profile_id is not null;

create table public.today_information_items (
  id uuid primary key default gen_random_uuid(),
  information_date date not null,
  kind public.today_information_kind not null,
  start_time time,
  end_time time,
  title text not null check (char_length(title) between 1 and 120),
  body_easy text check (char_length(coalesce(body_easy, '')) <= 1000),
  location text check (char_length(coalesce(location, '')) <= 200),
  preparation_text text check (char_length(coalesce(preparation_text, '')) <= 1000),
  important boolean not null default false,
  target_scope public.today_target_scope not null,
  target_department_id uuid references public.departments(id) on delete restrict,
  target_work_group_id uuid references public.work_groups(id) on delete restrict,
  target_profile_id uuid references public.profiles(id) on delete restrict,
  status public.board_record_status not null default 'draft',
  change_reason text not null check (char_length(change_reason) between 1 and 300),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time is null or end_time is null or start_time < end_time),
  check (
    (target_scope = 'company' and target_department_id is null and target_work_group_id is null and target_profile_id is null)
    or (target_scope = 'department' and target_department_id is not null and target_work_group_id is null and target_profile_id is null)
    or (target_scope = 'work_group' and target_department_id is null and target_work_group_id is not null and target_profile_id is null)
    or (target_scope = 'profile' and target_department_id is null and target_work_group_id is null and target_profile_id is not null)
  )
);

create index today_information_items_date_status_idx
  on public.today_information_items (information_date, status, important desc, start_time);

comment on table public.daily_work_assignments is
  'Read-only Today task cards for general workers. It intentionally contains no progress, completion, output, or attendance fields.';
comment on table public.today_information_items is
  'Minimal work-hours, schedule, and notice summaries for the Today board.';
comment on table public.work_guides is
  'Minimal published guide reference. Step-by-step guide content is a later migration.';

create or replace function public.current_user_department_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.department_id
  from public.profiles profile
  where profile.id = (select auth.uid())
    and profile.account_status = 'active';
$$;

create or replace function public.current_user_in_work_group(p_work_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and exists (
      select 1
      from public.work_group_members membership
      join public.work_groups work_group on work_group.id = membership.work_group_id
      where membership.profile_id = (select auth.uid())
        and membership.work_group_id = p_work_group_id
        and membership.start_date <= current_date
        and (membership.end_date is null or membership.end_date >= current_date)
        and work_group.active
    );
$$;

create or replace function public.current_user_leads_work_group(p_work_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and exists (
      select 1
      from public.work_group_members membership
      join public.work_groups work_group on work_group.id = membership.work_group_id
      where membership.profile_id = (select auth.uid())
        and membership.work_group_id = p_work_group_id
        and membership.member_type = 'lead'
        and membership.start_date <= current_date
        and (membership.end_date is null or membership.end_date >= current_date)
        and work_group.active
    );
$$;

create or replace function public.today_target_matches_current_user(
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
  select public.current_profile_is_active()
    and case p_target_scope
      when 'company' then true
      when 'department' then p_department_id = public.current_user_department_id()
      when 'work_group' then public.current_user_in_work_group(p_work_group_id)
      when 'profile' then p_profile_id = (select auth.uid())
      else false
    end;
$$;

create or replace function public.current_user_can_manage_department(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and (
      public.current_user_has_role('super_admin')
      or public.current_user_has_role('operations_manager')
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
begin
  if not public.current_profile_is_active() then
    return false;
  end if;

  if public.current_user_has_role('super_admin')
     or public.current_user_has_role('operations_manager') then
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

create or replace function public.private_validate_today_target(
  p_target_scope public.today_target_scope,
  p_department_id uuid,
  p_work_group_id uuid,
  p_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (p_target_scope = 'company' and (p_department_id is not null or p_work_group_id is not null or p_profile_id is not null))
     or (p_target_scope = 'department' and (p_department_id is null or p_work_group_id is not null or p_profile_id is not null))
     or (p_target_scope = 'work_group' and (p_department_id is not null or p_work_group_id is null or p_profile_id is not null))
     or (p_target_scope = 'profile' and (p_department_id is not null or p_work_group_id is not null or p_profile_id is null)) then
    raise exception using errcode = '22023', message = 'INVALID_TARGET';
  end if;

  if p_target_scope = 'department'
     and not exists (select 1 from public.departments where id = p_department_id and active) then
    raise exception using errcode = '22023', message = 'INVALID_TARGET_DEPARTMENT';
  end if;
  if p_target_scope = 'work_group'
     and not exists (select 1 from public.work_groups where id = p_work_group_id and active) then
    raise exception using errcode = '22023', message = 'INVALID_TARGET_WORK_GROUP';
  end if;
  if p_target_scope = 'profile'
     and not exists (select 1 from public.profiles where id = p_profile_id and account_status = 'active') then
    raise exception using errcode = '22023', message = 'INVALID_TARGET_PROFILE';
  end if;
end;
$$;

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
      select jsonb_agg(jsonb_build_object(
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
      ) order by item.important desc, item.start_time nulls last, item.created_at)
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
    ), '[]'::jsonb)
  )
  into board
  from public.profiles profile
  where profile.id = (select auth.uid())
    and profile.account_status = 'active';

  return board;
end;
$$;

create or replace function public.get_today_board_admin_options()
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

  return jsonb_build_object(
    'company_allowed', public.current_user_has_role('super_admin') or public.current_user_has_role('operations_manager'),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('id', department.id, 'name', department.name) order by department.sort_order, department.name)
      from public.departments department
      where department.active
        and public.current_user_can_manage_today_target('department', department.id, null, null)
    ), '[]'::jsonb),
    'work_groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', work_group.id,
        'name', work_group.name,
        'department_id', work_group.department_id
      ) order by work_group.sort_order, work_group.name)
      from public.work_groups work_group
      where work_group.active
        and public.current_user_can_manage_today_target('work_group', null, work_group.id, null)
    ), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', profile.id,
        'name', profile.display_name,
        'department_id', profile.department_id
      ) order by profile.display_name)
      from public.profiles profile
      where profile.account_status = 'active'
        and public.current_user_can_manage_today_target('profile', null, null, profile.id)
    ), '[]'::jsonb),
    'work_guides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', guide.id,
        'title', guide.title,
        'department_id', guide.department_id,
        'status', guide.status
      ) order by guide.title)
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
  if not (
    public.current_user_has_role('super_admin')
    or public.current_user_has_role('operations_manager')
    or public.current_user_has_role('department_lead')
    or public.current_user_has_role('field_lead')
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(task) order by task.start_time nulls last, task.created_at)
      from public.daily_work_assignments task
      where task.work_date = p_board_date
        and public.current_user_can_manage_today_target(
          task.target_scope,
          task.target_department_id,
          task.target_work_group_id,
          task.target_profile_id
        )
    ), '[]'::jsonb),
    'information', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.start_time nulls last, item.created_at)
      from public.today_information_items item
      where item.information_date = p_board_date
        and public.current_user_can_manage_today_target(
          item.target_scope,
          item.target_department_id,
          item.target_work_group_id,
          item.target_profile_id
        )
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_work_group(
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
declare
  saved_id uuid;
  old_group public.work_groups%rowtype;
begin
  if not (
    public.current_user_has_role('super_admin')
    or public.current_user_has_role('operations_manager')
    or (
      public.current_user_has_role('department_lead')
      and public.current_user_department_id() = p_department_id
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if not exists (select 1 from public.departments where id = p_department_id and active)
     or char_length(btrim(coalesce(p_name, ''))) not between 1 and 80
     or char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 300 then
    raise exception using errcode = '22023', message = 'INVALID_WORK_GROUP';
  end if;

  if p_work_group_id is null then
    insert into public.work_groups (
      department_id, name, active, created_by, updated_by
    ) values (
      p_department_id, btrim(p_name), p_active, auth.uid(), auth.uid()
    )
    returning id into saved_id;
  else
    select * into old_group
    from public.work_groups
    where id = p_work_group_id
    for update;
    if old_group.id is null
       or not (
         public.current_user_has_role('super_admin')
         or public.current_user_has_role('operations_manager')
         or (
           public.current_user_has_role('department_lead')
           and public.current_user_department_id() = old_group.department_id
           and public.current_user_department_id() = p_department_id
         )
       ) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
    end if;
    update public.work_groups
    set department_id = p_department_id,
        name = btrim(p_name),
        active = p_active,
        updated_by = auth.uid(),
        updated_at = now()
    where id = p_work_group_id
    returning id into saved_id;
  end if;

  perform public.private_append_audit(
    auth.uid(),
    case when p_work_group_id is null then 'work_group_created' else 'work_group_updated' end,
    'work_group',
    saved_id::text,
    'success',
    p_change_reason,
    jsonb_build_object('department_id', p_department_id, 'active', p_active)
  );

  return jsonb_build_object('ok', true, 'code', 'WORK_GROUP_SAVED', 'id', saved_id);
end;
$$;

create or replace function public.set_work_group_member(
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
declare
  group_department uuid;
  membership_id uuid;
begin
  select department_id into group_department
  from public.work_groups
  where id = p_work_group_id
    and active
  for update;

  if group_department is null
     or not (
       public.current_user_has_role('super_admin')
       or public.current_user_has_role('operations_manager')
       or (
         public.current_user_has_role('department_lead')
         and public.current_user_department_id() = group_department
       )
     ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_profile_id
      and account_status = 'active'
      and department_id = group_department
  ) then
    raise exception using errcode = '22023', message = 'INVALID_GROUP_MEMBER';
  end if;
  if p_end_date is not null and p_end_date < p_start_date then
    raise exception using errcode = '22023', message = 'INVALID_MEMBERSHIP_DATES';
  end if;
  if char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 300 then
    raise exception using errcode = '22023', message = 'CHANGE_REASON_REQUIRED';
  end if;

  update public.work_group_members
  set end_date = greatest(p_start_date - 1, start_date),
      updated_at = now()
  where work_group_id = p_work_group_id
    and profile_id = p_profile_id
    and member_type = p_member_type
    and end_date is null;

  insert into public.work_group_members (
    work_group_id,
    profile_id,
    member_type,
    start_date,
    end_date,
    assigned_by
  ) values (
    p_work_group_id,
    p_profile_id,
    p_member_type,
    p_start_date,
    p_end_date,
    auth.uid()
  )
  returning id into membership_id;

  perform public.private_append_audit(
    auth.uid(),
    'work_group_membership_changed',
    'work_group_member',
    membership_id::text,
    'success',
    p_change_reason,
    jsonb_build_object(
      'work_group_id', p_work_group_id,
      'profile_id', p_profile_id,
      'member_type', p_member_type,
      'start_date', p_start_date,
      'end_date', p_end_date
    )
  );

  return jsonb_build_object('ok', true, 'code', 'WORK_GROUP_MEMBER_SAVED', 'id', membership_id);
end;
$$;

create or replace function public.save_work_guide_stub(
  p_work_guide_id uuid,
  p_department_id uuid,
  p_title text,
  p_summary_text text,
  p_materials_text text,
  p_caution_text text,
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
  old_guide public.work_guides%rowtype;
begin
  if not public.current_user_can_manage_department(p_department_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_status = 'cancelled' then
    raise exception using errcode = '22023', message = 'INVALID_GUIDE_STATUS';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 300 then
    raise exception using errcode = '22023', message = 'INVALID_WORK_GUIDE';
  end if;

  if p_work_guide_id is null then
    insert into public.work_guides (
      department_id,
      title,
      summary_text,
      materials_text,
      caution_text,
      status,
      change_reason,
      created_by,
      updated_by,
      published_at
    ) values (
      p_department_id,
      btrim(p_title),
      nullif(btrim(coalesce(p_summary_text, '')), ''),
      nullif(btrim(coalesce(p_materials_text, '')), ''),
      nullif(btrim(coalesce(p_caution_text, '')), ''),
      p_status,
      btrim(p_change_reason),
      auth.uid(),
      auth.uid(),
      case when p_status = 'published' then now() else null end
    )
    returning id into saved_id;
  else
    select * into old_guide
    from public.work_guides
    where id = p_work_guide_id
    for update;
    if old_guide.id is null
       or not public.current_user_can_manage_department(old_guide.department_id) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
    end if;

    update public.work_guides
    set department_id = p_department_id,
        title = btrim(p_title),
        summary_text = nullif(btrim(coalesce(p_summary_text, '')), ''),
        materials_text = nullif(btrim(coalesce(p_materials_text, '')), ''),
        caution_text = nullif(btrim(coalesce(p_caution_text, '')), ''),
        status = p_status,
        version_no = version_no + 1,
        change_reason = btrim(p_change_reason),
        updated_by = auth.uid(),
        published_at = case
          when p_status = 'published' then coalesce(published_at, now())
          else published_at
        end,
        updated_at = now()
    where id = p_work_guide_id
    returning id into saved_id;
  end if;

  perform public.private_append_audit(
    auth.uid(),
    case when p_work_guide_id is null then 'work_guide_created' else 'work_guide_updated' end,
    'work_guide',
    saved_id::text,
    'success',
    p_change_reason,
    jsonb_build_object(
      'department_id', p_department_id,
      'previous_status', old_guide.status,
      'status', p_status
    )
  );

  return jsonb_build_object('ok', true, 'code', 'WORK_GUIDE_SAVED', 'id', saved_id);
end;
$$;

create or replace function public.save_daily_work_assignment(
  p_assignment_id uuid,
  p_work_date date,
  p_start_time time,
  p_end_time time,
  p_title text,
  p_location text,
  p_lead_profile_id uuid,
  p_preparation_text text,
  p_caution_text text,
  p_work_guide_id uuid,
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
  old_task public.daily_work_assignments%rowtype;
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
     or char_length(btrim(coalesce(p_location, ''))) not between 1 and 200
     or char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 300
     or (p_start_time is not null and p_end_time is not null and p_start_time >= p_end_time) then
    raise exception using errcode = '22023', message = 'INVALID_WORK_ASSIGNMENT';
  end if;
  if p_lead_profile_id is not null and not exists (
    select 1 from public.profiles where id = p_lead_profile_id and account_status = 'active'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_LEAD_PROFILE';
  end if;
  if p_work_guide_id is not null and not exists (
    select 1 from public.work_guides
    where id = p_work_guide_id
      and status <> 'inactive'
      and public.current_user_can_manage_department(department_id)
  ) then
    raise exception using errcode = '22023', message = 'INVALID_WORK_GUIDE';
  end if;

  if p_assignment_id is null then
    insert into public.daily_work_assignments (
      work_date,
      start_time,
      end_time,
      title,
      location,
      lead_profile_id,
      preparation_text,
      caution_text,
      work_guide_id,
      target_scope,
      target_department_id,
      target_work_group_id,
      target_profile_id,
      status,
      change_reason,
      created_by,
      updated_by
    ) values (
      p_work_date,
      p_start_time,
      p_end_time,
      btrim(p_title),
      btrim(p_location),
      p_lead_profile_id,
      nullif(btrim(coalesce(p_preparation_text, '')), ''),
      nullif(btrim(coalesce(p_caution_text, '')), ''),
      p_work_guide_id,
      p_target_scope,
      p_target_department_id,
      p_target_work_group_id,
      p_target_profile_id,
      p_status,
      btrim(p_change_reason),
      auth.uid(),
      auth.uid()
    )
    returning id into saved_id;
  else
    select * into old_task
    from public.daily_work_assignments
    where id = p_assignment_id
    for update;
    if old_task.id is null
       or not public.current_user_can_manage_today_target(
         old_task.target_scope,
         old_task.target_department_id,
         old_task.target_work_group_id,
         old_task.target_profile_id
       ) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
    end if;

    update public.daily_work_assignments
    set work_date = p_work_date,
        start_time = p_start_time,
        end_time = p_end_time,
        title = btrim(p_title),
        location = btrim(p_location),
        lead_profile_id = p_lead_profile_id,
        preparation_text = nullif(btrim(coalesce(p_preparation_text, '')), ''),
        caution_text = nullif(btrim(coalesce(p_caution_text, '')), ''),
        work_guide_id = p_work_guide_id,
        target_scope = p_target_scope,
        target_department_id = p_target_department_id,
        target_work_group_id = p_target_work_group_id,
        target_profile_id = p_target_profile_id,
        status = p_status,
        change_reason = btrim(p_change_reason),
        updated_by = auth.uid(),
        updated_at = now()
    where id = p_assignment_id
    returning id into saved_id;
  end if;

  perform public.private_append_audit(
    auth.uid(),
    case when p_assignment_id is null then 'daily_work_created' else 'daily_work_updated' end,
    'daily_work_assignment',
    saved_id::text,
    'success',
    p_change_reason,
    jsonb_build_object(
      'previous_scope', old_task.target_scope,
      'scope', p_target_scope,
      'previous_status', old_task.status,
      'status', p_status,
      'previous_start_time', old_task.start_time,
      'start_time', p_start_time,
      'previous_end_time', old_task.end_time,
      'end_time', p_end_time,
      'previous_location', left(old_task.location, 80),
      'location', left(p_location, 80),
      'previous_lead_profile_id', old_task.lead_profile_id,
      'lead_profile_id', p_lead_profile_id,
      'previous_work_guide_id', old_task.work_guide_id,
      'work_guide_id', p_work_guide_id
    )
  );

  return jsonb_build_object('ok', true, 'code', 'DAILY_WORK_SAVED', 'id', saved_id);
end;
$$;

create or replace function public.save_today_information_item(
  p_information_id uuid,
  p_information_date date,
  p_kind public.today_information_kind,
  p_start_time time,
  p_end_time time,
  p_title text,
  p_body_easy text,
  p_location text,
  p_preparation_text text,
  p_important boolean,
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
  old_item public.today_information_items%rowtype;
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
     or char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 300
     or (p_start_time is not null and p_end_time is not null and p_start_time >= p_end_time) then
    raise exception using errcode = '22023', message = 'INVALID_TODAY_INFORMATION';
  end if;

  if p_information_id is null then
    insert into public.today_information_items (
      information_date,
      kind,
      start_time,
      end_time,
      title,
      body_easy,
      location,
      preparation_text,
      important,
      target_scope,
      target_department_id,
      target_work_group_id,
      target_profile_id,
      status,
      change_reason,
      created_by,
      updated_by
    ) values (
      p_information_date,
      p_kind,
      p_start_time,
      p_end_time,
      btrim(p_title),
      nullif(btrim(coalesce(p_body_easy, '')), ''),
      nullif(btrim(coalesce(p_location, '')), ''),
      nullif(btrim(coalesce(p_preparation_text, '')), ''),
      p_important,
      p_target_scope,
      p_target_department_id,
      p_target_work_group_id,
      p_target_profile_id,
      p_status,
      btrim(p_change_reason),
      auth.uid(),
      auth.uid()
    )
    returning id into saved_id;
  else
    select * into old_item
    from public.today_information_items
    where id = p_information_id
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

    update public.today_information_items
    set information_date = p_information_date,
        kind = p_kind,
        start_time = p_start_time,
        end_time = p_end_time,
        title = btrim(p_title),
        body_easy = nullif(btrim(coalesce(p_body_easy, '')), ''),
        location = nullif(btrim(coalesce(p_location, '')), ''),
        preparation_text = nullif(btrim(coalesce(p_preparation_text, '')), ''),
        important = p_important,
        target_scope = p_target_scope,
        target_department_id = p_target_department_id,
        target_work_group_id = p_target_work_group_id,
        target_profile_id = p_target_profile_id,
        status = p_status,
        change_reason = btrim(p_change_reason),
        updated_by = auth.uid(),
        updated_at = now()
    where id = p_information_id
    returning id into saved_id;
  end if;

  perform public.private_append_audit(
    auth.uid(),
    case when p_information_id is null then 'today_information_created' else 'today_information_updated' end,
    'today_information_item',
    saved_id::text,
    'success',
    p_change_reason,
    jsonb_build_object(
      'kind', p_kind,
      'previous_scope', old_item.target_scope,
      'scope', p_target_scope,
      'previous_status', old_item.status,
      'status', p_status,
      'previous_start_time', old_item.start_time,
      'start_time', p_start_time,
      'previous_end_time', old_item.end_time,
      'end_time', p_end_time,
      'previous_location', left(old_item.location, 80),
      'location', left(p_location, 80),
      'important', p_important
    )
  );

  return jsonb_build_object('ok', true, 'code', 'TODAY_INFORMATION_SAVED', 'id', saved_id);
end;
$$;

alter table public.work_groups enable row level security;
alter table public.work_group_members enable row level security;
alter table public.work_guides enable row level security;
alter table public.daily_work_assignments enable row level security;
alter table public.today_information_items enable row level security;

alter function public.current_user_department_id() owner to postgres;
alter function public.current_user_in_work_group(uuid) owner to postgres;
alter function public.current_user_leads_work_group(uuid) owner to postgres;
alter function public.today_target_matches_current_user(public.today_target_scope, uuid, uuid, uuid) owner to postgres;
alter function public.current_user_can_manage_department(uuid) owner to postgres;
alter function public.current_user_can_manage_today_target(public.today_target_scope, uuid, uuid, uuid) owner to postgres;
alter function public.private_validate_today_target(public.today_target_scope, uuid, uuid, uuid) owner to postgres;
alter function public.get_my_today_board(date) owner to postgres;
alter function public.get_today_board_admin_options() owner to postgres;
alter function public.list_manageable_today_records(date) owner to postgres;
alter function public.save_work_group(uuid, uuid, text, boolean, text) owner to postgres;
alter function public.set_work_group_member(uuid, uuid, public.work_group_member_type, date, date, text) owner to postgres;
alter function public.save_work_guide_stub(uuid, uuid, text, text, text, text, public.board_record_status, text) owner to postgres;
alter function public.save_daily_work_assignment(uuid, date, time, time, text, text, uuid, text, text, uuid, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) owner to postgres;
alter function public.save_today_information_item(uuid, date, public.today_information_kind, time, time, text, text, text, text, boolean, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) owner to postgres;

create policy work_groups_read on public.work_groups
for select to authenticated
using (
  (active and (select public.current_user_in_work_group(id)))
  or public.current_user_has_role('super_admin')
  or public.current_user_has_role('operations_manager')
  or (
    public.current_user_has_role('department_lead')
    and public.current_user_department_id() = department_id
  )
  or (
    public.current_user_has_role('field_lead')
    and public.current_user_leads_work_group(id)
  )
);

create policy work_group_members_read on public.work_group_members
for select to authenticated
using (
  (
    profile_id = (select auth.uid())
    and (select public.current_profile_is_active())
  )
  or (select public.current_user_can_manage_today_target('work_group', null, work_group_id, null))
);

create policy work_guides_read on public.work_guides
for select to authenticated
using (
  (
    status = 'published'
    and (select public.current_profile_is_active())
    and exists (
      select 1
      from public.daily_work_assignments task
      where task.work_guide_id = id
        and task.status in ('published', 'cancelled')
        and public.today_target_matches_current_user(
          task.target_scope,
          task.target_department_id,
          task.target_work_group_id,
          task.target_profile_id
        )
    )
  )
  or (select public.current_user_can_manage_department(department_id))
);

create policy daily_work_assignments_read on public.daily_work_assignments
for select to authenticated
using (
  (
    status in ('published', 'cancelled')
    and (select public.today_target_matches_current_user(
      target_scope,
      target_department_id,
      target_work_group_id,
      target_profile_id
    ))
  )
  or (select public.current_user_can_manage_today_target(
    target_scope,
    target_department_id,
    target_work_group_id,
    target_profile_id
  ))
);

create policy today_information_items_read on public.today_information_items
for select to authenticated
using (
  (
    status in ('published', 'cancelled')
    and (select public.today_target_matches_current_user(
      target_scope,
      target_department_id,
      target_work_group_id,
      target_profile_id
    ))
  )
  or (select public.current_user_can_manage_today_target(
    target_scope,
    target_department_id,
    target_work_group_id,
    target_profile_id
  ))
);

revoke all on table
  public.work_groups,
  public.work_group_members,
  public.work_guides,
  public.daily_work_assignments,
  public.today_information_items
from public, anon, authenticated;

grant select (
  id,
  department_id,
  name,
  active,
  sort_order,
  created_at,
  updated_at
) on public.work_groups to authenticated;

grant select (
  id,
  work_group_id,
  profile_id,
  member_type,
  start_date,
  end_date,
  created_at,
  updated_at
) on public.work_group_members to authenticated;

grant select (
  id,
  department_id,
  title,
  summary_text,
  materials_text,
  caution_text,
  status,
  version_no,
  published_at,
  created_at,
  updated_at
) on public.work_guides to authenticated;

grant select (
  id,
  work_date,
  start_time,
  end_time,
  title,
  location,
  lead_profile_id,
  preparation_text,
  caution_text,
  work_guide_id,
  target_scope,
  target_department_id,
  target_work_group_id,
  target_profile_id,
  status,
  created_at,
  updated_at
) on public.daily_work_assignments to authenticated;

grant select (
  id,
  information_date,
  kind,
  start_time,
  end_time,
  title,
  body_easy,
  location,
  preparation_text,
  important,
  target_scope,
  target_department_id,
  target_work_group_id,
  target_profile_id,
  status,
  created_at,
  updated_at
) on public.today_information_items to authenticated;

revoke execute on function public.current_user_department_id() from public, anon;
revoke execute on function public.current_user_in_work_group(uuid) from public, anon;
revoke execute on function public.current_user_leads_work_group(uuid) from public, anon;
revoke execute on function public.today_target_matches_current_user(public.today_target_scope, uuid, uuid, uuid) from public, anon;
revoke execute on function public.current_user_can_manage_department(uuid) from public, anon;
revoke execute on function public.current_user_can_manage_today_target(public.today_target_scope, uuid, uuid, uuid) from public, anon;
revoke execute on function public.private_validate_today_target(public.today_target_scope, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.get_my_today_board(date) from public, anon;
revoke execute on function public.get_today_board_admin_options() from public, anon;
revoke execute on function public.list_manageable_today_records(date) from public, anon;
revoke execute on function public.save_work_group(uuid, uuid, text, boolean, text) from public, anon;
revoke execute on function public.set_work_group_member(uuid, uuid, public.work_group_member_type, date, date, text) from public, anon;
revoke execute on function public.save_work_guide_stub(uuid, uuid, text, text, text, text, public.board_record_status, text) from public, anon;
revoke execute on function public.save_daily_work_assignment(uuid, date, time, time, text, text, uuid, text, text, uuid, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) from public, anon;
revoke execute on function public.save_today_information_item(uuid, date, public.today_information_kind, time, time, text, text, text, text, boolean, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) from public, anon;

grant execute on function public.current_user_department_id() to authenticated;
grant execute on function public.current_user_in_work_group(uuid) to authenticated;
grant execute on function public.current_user_leads_work_group(uuid) to authenticated;
grant execute on function public.today_target_matches_current_user(public.today_target_scope, uuid, uuid, uuid) to authenticated;
grant execute on function public.current_user_can_manage_department(uuid) to authenticated;
grant execute on function public.current_user_can_manage_today_target(public.today_target_scope, uuid, uuid, uuid) to authenticated;
grant execute on function public.get_my_today_board(date) to authenticated;
grant execute on function public.get_today_board_admin_options() to authenticated;
grant execute on function public.list_manageable_today_records(date) to authenticated;
grant execute on function public.save_work_group(uuid, uuid, text, boolean, text) to authenticated;
grant execute on function public.set_work_group_member(uuid, uuid, public.work_group_member_type, date, date, text) to authenticated;
grant execute on function public.save_work_guide_stub(uuid, uuid, text, text, text, text, public.board_record_status, text) to authenticated;
grant execute on function public.save_daily_work_assignment(uuid, date, time, time, text, text, uuid, text, text, uuid, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) to authenticated;
grant execute on function public.save_today_information_item(uuid, date, public.today_information_kind, time, time, text, text, text, text, boolean, public.today_target_scope, uuid, uuid, uuid, public.board_record_status, text) to authenticated;

commit;
