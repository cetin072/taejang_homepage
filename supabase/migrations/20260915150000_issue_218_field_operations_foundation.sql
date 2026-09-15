-- Issue #218 Phase D field operations foundation.
-- Reuses authoritative Employee, work groups, Today assignments, work guides,
-- capability authorization and audit. No sensitive worker-support data is added here.

begin;

create type public.field_time_block as enum (
  'morning',
  'afternoon',
  'full_day',
  'custom'
);

create type public.field_assignment_override_action as enum (
  'include',
  'exclude'
);

insert into public.platform_capabilities(code, capability_kind, operations_manager_auto_grant, description)
values
  ('field.membership.manage', 'operational', true, '현장 작업반 Employee 구성 관리'),
  ('field.template.manage', 'operational', true, '현장 반복업무 템플릿 관리'),
  ('field.assignment.manage', 'operational', true, '현장 당일 작업 및 예외 근로자 관리')
on conflict (code) do update
set capability_kind = excluded.capability_kind,
    operations_manager_auto_grant = excluded.operations_manager_auto_grant,
    description = excluded.description,
    active = true,
    updated_at = now();

with grants(role_code, capability_code) as (
  values
    ('department_lead', 'field.membership.manage'),
    ('department_lead', 'field.template.manage'),
    ('department_lead', 'field.assignment.manage'),
    ('field_lead', 'field.template.manage'),
    ('field_lead', 'field.assignment.manage')
)
insert into public.role_capability_grants(role_id, capability_code)
select role.id, grants.capability_code
from grants
join public.roles role on role.code = grants.role_code
join public.platform_capabilities capability on capability.code = grants.capability_code
where role.active and capability.active
on conflict (role_id, capability_code) do nothing;

create table public.work_group_employee_memberships (
  id uuid primary key default gen_random_uuid(),
  work_group_id uuid not null references public.work_groups(id) on delete restrict,
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  member_type public.work_group_member_type not null default 'worker',
  start_date date not null,
  end_date date,
  assigned_by uuid references public.profiles(id) on delete restrict,
  source text not null default 'field_operations'
    check (source in ('field_operations', 'legacy_profile_backfill')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create unique index work_group_employee_memberships_one_current
  on public.work_group_employee_memberships(work_group_id, employee_uuid, member_type)
  where end_date is null;

create index work_group_employee_memberships_employee_date_idx
  on public.work_group_employee_memberships(employee_uuid, start_date, end_date, work_group_id);

create index work_group_employee_memberships_group_date_idx
  on public.work_group_employee_memberships(work_group_id, start_date, end_date, member_type);

-- Preserve existing profile-based membership history when a profile is already
-- linked to the authoritative Employee record. Unlinked profiles are never guessed.
insert into public.work_group_employee_memberships(
  work_group_id,
  employee_uuid,
  member_type,
  start_date,
  end_date,
  assigned_by,
  source,
  created_at,
  updated_at
)
select
  legacy.work_group_id,
  employee.id,
  legacy.member_type,
  legacy.start_date,
  legacy.end_date,
  legacy.assigned_by,
  'legacy_profile_backfill',
  legacy.created_at,
  legacy.updated_at
from public.work_group_members legacy
join public.account_person_links link_row
  on link_row.profile_id = legacy.profile_id
 and link_row.revoked_at is null
join public.employees employee
  on employee.person_id = link_row.person_id
join public.work_groups work_group
  on work_group.id = legacy.work_group_id
 and work_group.department_id = employee.department_id
where not exists (
  select 1
  from public.work_group_employee_memberships existing
  where existing.work_group_id = legacy.work_group_id
    and existing.employee_uuid = employee.id
    and existing.member_type = legacy.member_type
    and existing.start_date = legacy.start_date
    and existing.end_date is not distinct from legacy.end_date
);

create table public.field_work_templates (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  work_type text not null check (char_length(btrim(work_type)) between 1 and 80),
  default_work_group_id uuid references public.work_groups(id) on delete restrict,
  default_lead_profile_id uuid references public.profiles(id) on delete restrict,
  default_location text not null check (char_length(btrim(default_location)) between 1 and 200),
  summary_text text check (char_length(coalesce(summary_text, '')) <= 500),
  materials_text text check (char_length(coalesce(materials_text, '')) <= 1000),
  work_guide_id uuid references public.work_guides(id) on delete restrict,
  completion_text text check (char_length(coalesce(completion_text, '')) <= 1200),
  caution_text text check (char_length(coalesce(caution_text, '')) <= 1000),
  common_problems_text text check (char_length(coalesce(common_problems_text, '')) <= 1200),
  default_start_time time,
  default_end_time time,
  recommended_people smallint check (recommended_people is null or recommended_people between 1 and 100),
  handoff_required boolean not null default false,
  status public.board_record_status not null default 'draft'
    check (status in ('draft', 'published', 'inactive')),
  version_no integer not null default 1 check (version_no > 0),
  change_reason text not null check (char_length(btrim(change_reason)) between 1 and 300),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (default_start_time is null or default_end_time is null or default_start_time < default_end_time),
  check (status <> 'published' or published_at is not null)
);

create index field_work_templates_department_status_idx
  on public.field_work_templates(department_id, status, updated_at desc);
create index field_work_templates_group_status_idx
  on public.field_work_templates(default_work_group_id, status)
  where default_work_group_id is not null;

alter table public.daily_work_assignments
  add column field_template_id uuid references public.field_work_templates(id) on delete restrict,
  add column field_time_block public.field_time_block,
  add column field_daily_note text;

alter table public.daily_work_assignments
  add constraint daily_work_assignments_field_note_check
    check (char_length(coalesce(field_daily_note, '')) <= 1000),
  add constraint daily_work_assignments_field_contract_check
    check (
      field_template_id is null
      or (
        target_scope = 'work_group'
        and target_work_group_id is not null
        and field_time_block is not null
      )
    );

create index daily_work_assignments_field_template_idx
  on public.daily_work_assignments(field_template_id, work_date, target_work_group_id)
  where field_template_id is not null;

create table public.field_assignment_employee_overrides (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.daily_work_assignments(id) on delete restrict,
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  override_action public.field_assignment_override_action not null,
  active boolean not null default true,
  change_reason text not null check (char_length(btrim(change_reason)) between 1 and 300),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, employee_uuid)
);

create index field_assignment_employee_overrides_active_idx
  on public.field_assignment_employee_overrides(assignment_id, override_action, employee_uuid)
  where active;

comment on table public.work_group_employee_memberships is
  'Employee-based field work-group membership. Employee identity is authoritative even when no Auth profile exists.';
comment on table public.field_work_templates is
  'Recurring field-work template linked to existing work guides; it does not duplicate work-guide steps.';
comment on table public.field_assignment_employee_overrides is
  'Daily include/exclude exceptions over the work-group Employee roster. It does not rewrite the base work-group membership.';

create or replace function public.private_profile_leads_work_group(
  p_profile_id uuid,
  p_work_group_id uuid
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
    join public.work_groups work_group on work_group.id = p_work_group_id
    where profile.id = p_profile_id
      and profile.account_status = 'active'
      and work_group.active
      and (
        exists (
          select 1
          from public.work_group_members membership
          where membership.profile_id = profile.id
            and membership.work_group_id = work_group.id
            and membership.member_type = 'lead'
            and membership.start_date <= current_date
            and (membership.end_date is null or membership.end_date >= current_date)
        )
        or exists (
          select 1
          from public.account_person_links account_link
          join public.employees employee on employee.person_id = account_link.person_id
          join public.work_group_employee_memberships membership
            on membership.employee_uuid = employee.id
          where account_link.profile_id = profile.id
            and account_link.revoked_at is null
            and membership.work_group_id = work_group.id
            and membership.member_type = 'lead'
            and membership.start_date <= current_date
            and (membership.end_date is null or membership.end_date >= current_date)
        )
      )
  );
$$;

create or replace function public.current_user_in_work_group(p_work_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and (
      exists (
        select 1
        from public.work_group_members membership
        join public.work_groups work_group on work_group.id = membership.work_group_id
        where membership.profile_id = (select auth.uid())
          and membership.work_group_id = p_work_group_id
          and membership.start_date <= current_date
          and (membership.end_date is null or membership.end_date >= current_date)
          and work_group.active
      )
      or exists (
        select 1
        from public.account_person_links account_link
        join public.employees employee on employee.person_id = account_link.person_id
        join public.work_group_employee_memberships membership on membership.employee_uuid = employee.id
        join public.work_groups work_group on work_group.id = membership.work_group_id
        where account_link.profile_id = (select auth.uid())
          and account_link.revoked_at is null
          and membership.work_group_id = p_work_group_id
          and membership.start_date <= current_date
          and (membership.end_date is null or membership.end_date >= current_date)
          and work_group.active
      )
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
    and public.private_profile_leads_work_group((select auth.uid()), p_work_group_id);
$$;

create or replace function public.private_actor_can_manage_field_department(
  p_capability text,
  p_department_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and public.private_actor_can(p_capability)
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
            and work_group.active
            and public.current_user_leads_work_group(work_group.id)
        )
      )
    );
$$;

create or replace function public.private_actor_can_manage_field_group(
  p_capability text,
  p_work_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and public.private_actor_can(p_capability)
    and exists (
      select 1
      from public.work_groups work_group
      where work_group.id = p_work_group_id
        and work_group.active
        and (
          public.current_user_has_role('operations_manager')
          or (
            public.current_user_has_role('department_lead')
            and public.current_user_department_id() = work_group.department_id
          )
          or (
            public.current_user_has_role('field_lead')
            and public.current_user_leads_work_group(work_group.id)
          )
        )
    );
$$;

create or replace function public.list_field_work_group_members(
  p_work_group_id uuid,
  p_on_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    public.private_actor_can_manage_field_group('field.assignment.manage', p_work_group_id)
    or public.private_actor_can_manage_field_group('field.membership.manage', p_work_group_id)
  ) then
    raise exception using errcode = '42501', message = 'FIELD_GROUP_READ_FORBIDDEN';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'membership_id', membership.id,
      'employee_uuid', employee.id,
      'employee_id', employee.employee_id,
      'name', person.full_name,
      'member_type', membership.member_type,
      'start_date', membership.start_date,
      'end_date', membership.end_date,
      'employment_status', employee.employment_status
    ) order by membership.member_type, person.full_name, employee.employee_id)
    from public.work_group_employee_memberships membership
    join public.employees employee on employee.id = membership.employee_uuid
    join public.people person on person.id = employee.person_id
    where membership.work_group_id = p_work_group_id
      and membership.start_date <= p_on_date
      and (membership.end_date is null or membership.end_date >= p_on_date)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.set_field_work_group_employee(
  p_work_group_id uuid,
  p_employee_uuid uuid,
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
  employee_row public.employees%rowtype;
begin
  if not public.private_actor_can_manage_field_group('field.membership.manage', p_work_group_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select work_group.department_id into group_department
  from public.work_groups work_group
  where work_group.id = p_work_group_id and work_group.active
  for update;

  select * into employee_row
  from public.employees employee
  where employee.id = p_employee_uuid
  for update;

  if group_department is null
     or employee_row.id is null
     or employee_row.department_id <> group_department
     or (p_end_date is null and employee_row.employment_status <> 'active') then
    raise exception using errcode = '22023', message = 'INVALID_FIELD_GROUP_EMPLOYEE';
  end if;
  if p_start_date is null or (p_end_date is not null and p_end_date < p_start_date) then
    raise exception using errcode = '22023', message = 'INVALID_MEMBERSHIP_DATES';
  end if;
  if char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 300 then
    raise exception using errcode = '22023', message = 'CHANGE_REASON_REQUIRED';
  end if;

  update public.work_group_employee_memberships
  set end_date = greatest(p_start_date - 1, start_date),
      updated_at = now()
  where work_group_id = p_work_group_id
    and employee_uuid = p_employee_uuid
    and member_type = p_member_type
    and end_date is null;

  insert into public.work_group_employee_memberships(
    work_group_id, employee_uuid, member_type, start_date, end_date,
    assigned_by, source
  ) values (
    p_work_group_id, p_employee_uuid, p_member_type, p_start_date, p_end_date,
    auth.uid(), 'field_operations'
  ) returning id into membership_id;

  perform public.private_append_audit(
    auth.uid(),
    'field_work_group_membership_changed',
    'work_group_employee_membership',
    membership_id::text,
    'success',
    btrim(p_change_reason),
    jsonb_build_object(
      'work_group_id', p_work_group_id,
      'employee_uuid', p_employee_uuid,
      'member_type', p_member_type,
      'start_date', p_start_date,
      'end_date', p_end_date
    )
  );

  return jsonb_build_object('ok', true, 'code', 'FIELD_GROUP_EMPLOYEE_SAVED', 'id', membership_id);
end;
$$;

create or replace function public.list_field_work_templates(
  p_department_id uuid default null,
  p_include_inactive boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$;
begin
  if not public.current_profile_is_active()
     or not public.private_actor_can('field.template.manage') then
    raise exception using errcode = '42501', message = 'FIELD_TEMPLATE_READ_FORBIDDEN';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', template.id,
      'department_id', template.department_id,
      'title', template.title,
      'work_type', template.work_type,
      'default_work_group_id', template.default_work_group_id,
      'default_lead_profile_id', template.default_lead_profile_id,
      'default_location', template.default_location,
      'summary_text', template.summary_text,
      'materials_text', template.materials_text,
      'work_guide_id', template.work_guide_id,
      'completion_text', template.completion_text,
      'caution_text', template.caution_text,
      'common_problems_text', template.common_problems_text,
      'default_start_time', template.default_start_time,
      'default_end_time', template.default_end_time,
      'recommended_people', template.recommended_people,
      'handoff_required', template.handoff_required,
      'status', template.status,
      'version_no', template.version_no,
      'updated_at', template.updated_at
    ) order by template.status, template.title)
    from public.field_work_templates template
    where (p_department_id is null or template.department_id = p_department_id)
      and (coalesce(p_include_inactive, false) or template.status <> 'inactive')
      and public.private_actor_can_manage_field_department('field.template.manage', template.department_id)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.save_field_work_template(
  p_template_id uuid,
  p_department_id uuid,
  p_title text,
  p_work_type text,
  p_default_work_group_id uuid,
  p_default_lead_profile_id uuid,
  p_default_location text,
  p_summary_text text,
  p_materials_text text,
  p_work_guide_id uuid,
  p_completion_text text,
  p_caution_text text,
  p_common_problems_text text,
  p_default_start_time time,
  p_default_end_time time,
  p_recommended_people smallint,
  p_handoff_required boolean,
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
  old_template public.field_work_templates%rowtype;
  group_department uuid;
  guide_department uuid;
begin
  if not public.private_actor_can_manage_field_department('field.template.manage', p_department_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if not exists (select 1 from public.departments where id = p_department_id and active) then
    raise exception using errcode = '22023', message = 'INVALID_FIELD_TEMPLATE_DEPARTMENT';
  end if;
  if p_status not in ('draft', 'published', 'inactive')
     or char_length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_work_type, ''))) not between 1 and 80
     or char_length(btrim(coalesce(p_default_location, ''))) not between 1 and 200
     or char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 300
     or (p_default_start_time is not null and p_default_end_time is not null and p_default_start_time >= p_default_end_time)
     or (p_recommended_people is not null and p_recommended_people not between 1 and 100) then
    raise exception using errcode = '22023', message = 'INVALID_FIELD_TEMPLATE';
  end if;

  if p_default_work_group_id is not null then
    select department_id into group_department
    from public.work_groups
    where id = p_default_work_group_id and active;
    if group_department is distinct from p_department_id
       or not public.private_actor_can_manage_field_group('field.template.manage', p_default_work_group_id) then
      raise exception using errcode = '42501', message = 'FIELD_TEMPLATE_GROUP_FORBIDDEN';
    end if;
  end if;

  if p_default_lead_profile_id is not null then
    if p_default_work_group_id is null
       or not public.private_profile_leads_work_group(p_default_lead_profile_id, p_default_work_group_id) then
      raise exception using errcode = '22023', message = 'INVALID_FIELD_TEMPLATE_LEAD';
    end if;
  end if;

  if p_work_guide_id is not null then
    select department_id into guide_department
    from public.work_guides
    where id = p_work_guide_id and status <> 'inactive';
    if guide_department is distinct from p_department_id then
      raise exception using errcode = '22023', message = 'INVALID_FIELD_TEMPLATE_GUIDE';
    end if;
  end if;

  if p_template_id is null then
    insert into public.field_work_templates(
      department_id, title, work_type, default_work_group_id, default_lead_profile_id,
      default_location, summary_text, materials_text, work_guide_id, completion_text,
      caution_text, common_problems_text, default_start_time, default_end_time,
      recommended_people, handoff_required, status, change_reason,
      created_by, updated_by, published_at
    ) values (
      p_department_id, btrim(p_title), btrim(p_work_type), p_default_work_group_id, p_default_lead_profile_id,
      btrim(p_default_location), nullif(btrim(coalesce(p_summary_text, '')), ''),
      nullif(btrim(coalesce(p_materials_text, '')), ''), p_work_guide_id,
      nullif(btrim(coalesce(p_completion_text, '')), ''),
      nullif(btrim(coalesce(p_caution_text, '')), ''),
      nullif(btrim(coalesce(p_common_problems_text, '')), ''),
      p_default_start_time, p_default_end_time, p_recommended_people,
      coalesce(p_handoff_required, false), p_status, btrim(p_change_reason),
      auth.uid(), auth.uid(), case when p_status = 'published' then now() else null end
    ) returning id into saved_id;
  else
    select * into old_template
    from public.field_work_templates
    where id = p_template_id
    for update;
    if old_template.id is null
       or not public.private_actor_can_manage_field_department('field.template.manage', old_template.department_id) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
    end if;

    update public.field_work_templates
    set department_id = p_department_id,
        title = btrim(p_title),
        work_type = btrim(p_work_type),
        default_work_group_id = p_default_work_group_id,
        default_lead_profile_id = p_default_lead_profile_id,
        default_location = btrim(p_default_location),
        summary_text = nullif(btrim(coalesce(p_summary_text, '')), ''),
        materials_text = nullif(btrim(coalesce(p_materials_text, '')), ''),
        work_guide_id = p_work_guide_id,
        completion_text = nullif(btrim(coalesce(p_completion_text, '')), ''),
        caution_text = nullif(btrim(coalesce(p_caution_text, '')), ''),
        common_problems_text = nullif(btrim(coalesce(p_common_problems_text, '')), ''),
        default_start_time = p_default_start_time,
        default_end_time = p_default_end_time,
        recommended_people = p_recommended_people,
        handoff_required = coalesce(p_handoff_required, false),
        status = p_status,
        version_no = version_no + 1,
        change_reason = btrim(p_change_reason),
        updated_by = auth.uid(),
        published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end,
        updated_at = now()
    where id = p_template_id
    returning id into saved_id;
  end if;

  perform public.private_append_audit(
    auth.uid(),
    case when p_template_id is null then 'field_template_created' else 'field_template_updated' end,
    'field_work_template',
    saved_id::text,
    'success',
    btrim(p_change_reason),
    jsonb_build_object(
      'department_id', p_department_id,
      'work_group_id', p_default_work_group_id,
      'previous_status', old_template.status,
      'status', p_status,
      'version_no', (select version_no from public.field_work_templates where id = saved_id)
    )
  );

  return jsonb_build_object('ok', true, 'code', 'FIELD_TEMPLATE_SAVED', 'id', saved_id);
end;
$$;

create or replace function public.create_field_assignment_from_template(
  p_template_id uuid,
  p_work_date date,
  p_time_block public.field_time_block,
  p_work_group_id uuid default null,
  p_lead_profile_id uuid default null,
  p_location text default null,
  p_daily_note text default null,
  p_status public.board_record_status default 'draft',
  p_change_reason text default '현장업무 배정'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  template public.field_work_templates%rowtype;
  effective_group uuid;
  effective_lead uuid;
  effective_location text;
  assignment_id uuid;
  group_department uuid;
begin
  select * into template
  from public.field_work_templates
  where id = p_template_id and status = 'published'
  for share;
  if template.id is null then
    raise exception using errcode = '22023', message = 'FIELD_TEMPLATE_NOT_PUBLISHED';
  end if;

  effective_group := coalesce(p_work_group_id, template.default_work_group_id);
  effective_lead := coalesce(p_lead_profile_id, template.default_lead_profile_id);
  effective_location := coalesce(nullif(btrim(coalesce(p_location, '')), ''), template.default_location);

  if p_work_date is null or p_time_block is null or effective_group is null
     or p_status not in ('draft', 'published')
     or char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 300
     or char_length(coalesce(p_daily_note, '')) > 1000 then
    raise exception using errcode = '22023', message = 'INVALID_FIELD_ASSIGNMENT';
  end if;

  select department_id into group_department
  from public.work_groups where id = effective_group and active;
  if group_department is distinct from template.department_id
     or not public.private_actor_can_manage_field_group('field.assignment.manage', effective_group) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if effective_lead is not null
     and not public.private_profile_leads_work_group(effective_lead, effective_group) then
    raise exception using errcode = '22023', message = 'INVALID_FIELD_ASSIGNMENT_LEAD';
  end if;

  insert into public.daily_work_assignments(
    work_date, start_time, end_time, title, location, lead_profile_id,
    preparation_text, caution_text, work_guide_id,
    target_scope, target_department_id, target_work_group_id, target_profile_id,
    status, change_reason, created_by, updated_by,
    field_template_id, field_time_block, field_daily_note
  ) values (
    p_work_date, template.default_start_time, template.default_end_time,
    template.title, effective_location, effective_lead,
    template.materials_text, template.caution_text, template.work_guide_id,
    'work_group', null, effective_group, null,
    p_status, btrim(p_change_reason), auth.uid(), auth.uid(),
    template.id, p_time_block, nullif(btrim(coalesce(p_daily_note, '')), '')
  ) returning id into assignment_id;

  perform public.private_append_audit(
    auth.uid(),
    'field_assignment_created',
    'daily_work_assignment',
    assignment_id::text,
    'success',
    btrim(p_change_reason),
    jsonb_build_object(
      'field_template_id', template.id,
      'work_date', p_work_date,
      'time_block', p_time_block,
      'work_group_id', effective_group,
      'lead_profile_id', effective_lead,
      'status', p_status
    )
  );

  return jsonb_build_object('ok', true, 'code', 'FIELD_ASSIGNMENT_CREATED', 'id', assignment_id);
end;
$$;

create or replace function public.set_field_assignment_employee_override(
  p_assignment_id uuid,
  p_employee_uuid uuid,
  p_action public.field_assignment_override_action,
  p_active boolean,
  p_change_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment public.daily_work_assignments%rowtype;
  employee_row public.employees%rowtype;
  old_override public.field_assignment_employee_overrides%rowtype;
  override_id uuid;
  group_department uuid;
begin
  select * into assignment
  from public.daily_work_assignments
  where id = p_assignment_id and field_template_id is not null
  for update;
  if assignment.id is null or assignment.target_work_group_id is null then
    raise exception using errcode = '22023', message = 'FIELD_ASSIGNMENT_NOT_FOUND';
  end if;
  if not public.private_actor_can_manage_field_group('field.assignment.manage', assignment.target_work_group_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select department_id into group_department
  from public.work_groups where id = assignment.target_work_group_id and active;
  select * into employee_row from public.employees where id = p_employee_uuid;

  if employee_row.id is null
     or employee_row.department_id is distinct from group_department
     or (coalesce(p_active, true) and p_action = 'include' and employee_row.employment_status <> 'active')
     or char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 300 then
    raise exception using errcode = '22023', message = 'INVALID_FIELD_ASSIGNMENT_OVERRIDE';
  end if;

  select * into old_override
  from public.field_assignment_employee_overrides
  where assignment_id = p_assignment_id and employee_uuid = p_employee_uuid
  for update;

  if old_override.id is null then
    insert into public.field_assignment_employee_overrides(
      assignment_id, employee_uuid, override_action, active, change_reason,
      created_by, updated_by
    ) values (
      p_assignment_id, p_employee_uuid, p_action, coalesce(p_active, true), btrim(p_change_reason),
      auth.uid(), auth.uid()
    ) returning id into override_id;
  else
    update public.field_assignment_employee_overrides
    set override_action = p_action,
        active = coalesce(p_active, true),
        change_reason = btrim(p_change_reason),
        updated_by = auth.uid(),
        updated_at = now()
    where id = old_override.id
    returning id into override_id;
  end if;

  perform public.private_append_audit(
    auth.uid(),
    'field_assignment_employee_override_changed',
    'field_assignment_employee_override',
    override_id::text,
    'success',
    btrim(p_change_reason),
    jsonb_build_object(
      'assignment_id', p_assignment_id,
      'employee_uuid', p_employee_uuid,
      'previous_action', old_override.override_action,
      'action', p_action,
      'previous_active', old_override.active,
      'active', coalesce(p_active, true)
    )
  );

  return jsonb_build_object('ok', true, 'code', 'FIELD_ASSIGNMENT_OVERRIDE_SAVED', 'id', override_id);
end;
$$;

create or replace function public.get_field_assignment_roster(p_assignment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  assignment public.daily_work_assignments%rowtype;
  roster jsonb;
begin
  select * into assignment
  from public.daily_work_assignments
  where id = p_assignment_id and field_template_id is not null;

  if assignment.id is null or assignment.target_work_group_id is null then
    raise exception using errcode = '22023', message = 'FIELD_ASSIGNMENT_NOT_FOUND';
  end if;
  if not public.private_actor_can_manage_field_group('field.assignment.manage', assignment.target_work_group_id) then
    raise exception using errcode = '42501', message = 'FIELD_ASSIGNMENT_READ_FORBIDDEN';
  end if;

  with base_members as (
    select membership.employee_uuid, membership.member_type
    from public.work_group_employee_memberships membership
    where membership.work_group_id = assignment.target_work_group_id
      and membership.start_date <= assignment.work_date
      and (membership.end_date is null or membership.end_date >= assignment.work_date)
  ),
  effective_members as (
    select base.employee_uuid, base.member_type, 'work_group'::text as source
    from base_members base
    where not exists (
      select 1
      from public.field_assignment_employee_overrides override_row
      where override_row.assignment_id = assignment.id
        and override_row.employee_uuid = base.employee_uuid
        and override_row.active
        and override_row.override_action = 'exclude'
    )
    union
    select override_row.employee_uuid,
           coalesce(base.member_type, 'worker'::public.work_group_member_type),
           'include_override'::text
    from public.field_assignment_employee_overrides override_row
    left join base_members base on base.employee_uuid = override_row.employee_uuid
    where override_row.assignment_id = assignment.id
      and override_row.active
      and override_row.override_action = 'include'
      and base.employee_uuid is null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_uuid', employee.id,
    'employee_id', employee.employee_id,
    'name', person.full_name,
    'member_type', effective.member_type,
    'source', effective.source,
    'employment_status', employee.employment_status
  ) order by effective.member_type, person.full_name, employee.employee_id), '[]'::jsonb)
  into roster
  from effective_members effective
  join public.employees employee on employee.id = effective.employee_uuid
  join public.people person on person.id = employee.person_id;

  return jsonb_build_object(
    'assignment', jsonb_build_object(
      'id', assignment.id,
      'work_date', assignment.work_date,
      'title', assignment.title,
      'work_group_id', assignment.target_work_group_id,
      'lead_profile_id', assignment.lead_profile_id,
      'field_template_id', assignment.field_template_id,
      'time_block', assignment.field_time_block,
      'status', assignment.status
    ),
    'employees', roster
  );
end;
$$;

alter table public.work_group_employee_memberships enable row level security;
alter table public.field_work_templates enable row level security;
alter table public.field_assignment_employee_overrides enable row level security;

revoke all on table public.work_group_employee_memberships from public, anon, authenticated;
revoke all on table public.field_work_templates from public, anon, authenticated;
revoke all on table public.field_assignment_employee_overrides from public, anon, authenticated;

revoke all on function public.private_profile_leads_work_group(uuid, uuid) from public, anon, authenticated;
revoke all on function public.private_actor_can_manage_field_department(text, uuid) from public, anon, authenticated;
revoke all on function public.private_actor_can_manage_field_group(text, uuid) from public, anon, authenticated;

revoke all on function public.list_field_work_group_members(uuid, date) from public, anon;
revoke all on function public.set_field_work_group_employee(uuid, uuid, public.work_group_member_type, date, date, text) from public, anon;
revoke all on function public.list_field_work_templates(uuid, boolean) from public, anon;
revoke all on function public.save_field_work_template(uuid, uuid, text, text, uuid, uuid, text, text, text, uuid, text, text, text, time, time, smallint, boolean, public.board_record_status, text) from public, anon;
revoke all on function public.create_field_assignment_from_template(uuid, date, public.field_time_block, uuid, uuid, text, text, public.board_record_status, text) from public, anon;
revoke all on function public.set_field_assignment_employee_override(uuid, uuid, public.field_assignment_override_action, boolean, text) from public, anon;
revoke all on function public.get_field_assignment_roster(uuid) from public, anon;

grant execute on function public.list_field_work_group_members(uuid, date) to authenticated;
grant execute on function public.set_field_work_group_employee(uuid, uuid, public.work_group_member_type, date, date, text) to authenticated;
grant execute on function public.list_field_work_templates(uuid, boolean) to authenticated;
grant execute on function public.save_field_work_template(uuid, uuid, text, text, uuid, uuid, text, text, text, uuid, text, text, text, time, time, smallint, boolean, public.board_record_status, text) to authenticated;
grant execute on function public.create_field_assignment_from_template(uuid, date, public.field_time_block, uuid, uuid, text, text, public.board_record_status, text) to authenticated;
grant execute on function public.set_field_assignment_employee_override(uuid, uuid, public.field_assignment_override_action, boolean, text) to authenticated;
grant execute on function public.get_field_assignment_roster(uuid) to authenticated;

comment on function public.create_field_assignment_from_template(uuid, date, public.field_time_block, uuid, uuid, text, text, public.board_record_status, text) is
  'Creates a work-group Today assignment from a published field template. Worker progress/output fields are intentionally absent.';
comment on function public.get_field_assignment_roster(uuid) is
  'Returns the effective Employee roster for one field assignment after applying include/exclude exceptions.';

commit;
