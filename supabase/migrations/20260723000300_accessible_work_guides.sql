-- Accessible, read-only work guides for general workers.
-- Apply after 20260723000200_general_worker_today_board.sql.

begin;

create type public.work_guide_category as enum (
  'packing', 'inspection', 'organization', 'safety', 'company_life', 'other'
);

create type public.work_guide_format as enum ('procedure', 'reference');
create type public.work_guide_audience_scope as enum ('company', 'department');

alter table public.work_guides
  add column category public.work_guide_category not null default 'other',
  add column guide_format public.work_guide_format not null default 'procedure',
  add column audience_scope public.work_guide_audience_scope not null default 'department',
  add column audience_department_id uuid references public.departments(id) on delete restrict,
  add column cover_image_url text,
  add column cover_image_alt text,
  add column completion_text text,
  add column common_mistakes_text text,
  add column contact_label text,
  add column is_featured boolean not null default false;

alter table public.work_guides
  add constraint work_guides_audience_check check (
    (audience_scope = 'company' and audience_department_id is null)
    or (audience_scope = 'department' and audience_department_id is not null)
  ),
  add constraint work_guides_cover_image_check check (
    cover_image_url is null
    or (char_length(cover_image_url) between 1 and 2000
      and char_length(btrim(coalesce(cover_image_alt, ''))) between 1 and 240)
  ),
  add constraint work_guides_extended_text_check check (
    char_length(coalesce(completion_text, '')) <= 1200
    and char_length(coalesce(common_mistakes_text, '')) <= 1200
    and char_length(coalesce(contact_label, '')) <= 160
  );

create table public.work_guide_steps (
  id uuid primary key default gen_random_uuid(),
  work_guide_id uuid not null references public.work_guides(id) on delete restrict,
  step_order smallint not null check (step_order between 1 and 7),
  title text not null check (char_length(title) between 1 and 120),
  easy_text text not null check (char_length(easy_text) between 1 and 500),
  image_url text,
  image_alt text,
  caution_text text check (char_length(coalesce(caution_text, '')) <= 500),
  status public.board_record_status not null default 'draft',
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('draft', 'published', 'inactive')),
  check (
    image_url is null
    or (char_length(image_url) between 1 and 2000
      and char_length(btrim(coalesce(image_alt, ''))) between 1 and 240)
  ),
  unique (work_guide_id, step_order) deferrable initially deferred
);

create index work_guide_steps_read_idx
  on public.work_guide_steps (work_guide_id, status, step_order);
create index work_guides_worker_list_idx
  on public.work_guides (status, audience_scope, audience_department_id, category, updated_at desc);

comment on table public.work_guide_steps is
  'Short ordered instructions for an accessible work guide. General workers can only read published steps through safe RPCs.';
comment on column public.work_guides.cover_image_url is
  'Temporary optional URL only. A later Storage migration may replace this with a protected file reference.';

create or replace function public.current_user_can_manage_work_guide(p_guide_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and exists (
      select 1
      from public.work_guides guide
      where guide.id = p_guide_id
        and (
          public.current_user_has_role('super_admin')
          or public.current_user_has_role('operations_manager')
          or (
            public.current_user_has_role('department_lead')
            and guide.department_id = public.current_user_department_id()
          )
          or (
            public.current_user_has_role('field_lead')
            and exists (
              select 1
              from public.work_group_members membership
              join public.work_groups work_group on work_group.id = membership.work_group_id
              where membership.profile_id = (select auth.uid())
                and membership.member_type = 'lead'
                and membership.start_date <= current_date
                and (membership.end_date is null or membership.end_date >= current_date)
                and work_group.active
                and work_group.department_id = guide.department_id
            )
          )
        )
    );
$$;

create or replace function public.current_user_can_read_work_guide(p_guide_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and exists (
      select 1
      from public.work_guides guide
      where guide.id = p_guide_id
        and (
          public.current_user_can_manage_work_guide(guide.id)
          or (
            guide.status = 'published'
            and (
              guide.audience_scope = 'company'
              or (
                guide.audience_scope = 'department'
                and guide.audience_department_id = public.current_user_department_id()
              )
              or exists (
                select 1
                from public.daily_work_assignments task
                where task.work_guide_id = guide.id
                  and task.status = 'published'
                  and public.today_target_matches_current_user(
                    task.target_scope,
                    task.target_department_id,
                    task.target_work_group_id,
                    task.target_profile_id
                  )
              )
            )
          )
        )
    );
$$;

create or replace function public.private_validate_work_guide_publish(p_work_guide_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  guide_format public.work_guide_format;
  published_steps integer;
begin
  select work_guide.guide_format into guide_format
  from public.work_guides work_guide
  where work_guide.id = p_work_guide_id;
  if guide_format is null then
    raise exception using errcode = '22023', message = 'WORK_GUIDE_NOT_FOUND';
  end if;

  select count(*) into published_steps
  from public.work_guide_steps step
  where step.work_guide_id = p_work_guide_id
    and step.status = 'published';

  if published_steps > 7
     or (guide_format = 'procedure' and published_steps not between 3 and 7)
     or (guide_format = 'reference' and published_steps not between 1 and 7) then
    raise exception using errcode = '22023', message = 'INVALID_PUBLISHED_STEP_COUNT';
  end if;
end;
$$;

create or replace function public.private_work_guide_touch(p_work_guide_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.work_guides
  set updated_at = now(), updated_by = auth.uid(), version_no = version_no + 1
  where id = p_work_guide_id;
end;
$$;

create or replace function public.save_work_guide(
  p_work_guide_id uuid,
  p_department_id uuid,
  p_title text,
  p_category public.work_guide_category,
  p_guide_format public.work_guide_format,
  p_audience_scope public.work_guide_audience_scope,
  p_audience_department_id uuid,
  p_summary_text text,
  p_materials_text text,
  p_caution_text text,
  p_common_mistakes_text text,
  p_completion_text text,
  p_contact_label text,
  p_cover_image_url text,
  p_cover_image_alt text,
  p_is_featured boolean,
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
  previous_status public.board_record_status;
  normalized_url text := nullif(btrim(coalesce(p_cover_image_url, '')), '');
  normalized_alt text := nullif(btrim(coalesce(p_cover_image_alt, '')), '');
begin
  if p_status = 'cancelled' then
    raise exception using errcode = '22023', message = 'INVALID_GUIDE_STATUS';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 300
     or (p_audience_scope = 'department' and p_audience_department_id is null)
     or (p_audience_scope = 'company' and p_audience_department_id is not null)
     or (normalized_url is not null and normalized_alt is null) then
    raise exception using errcode = '22023', message = 'INVALID_WORK_GUIDE';
  end if;
  if not exists (select 1 from public.departments where id = p_department_id and active)
     or (p_audience_department_id is not null and not exists (
       select 1 from public.departments where id = p_audience_department_id and active
     )) then
    raise exception using errcode = '22023', message = 'INVALID_GUIDE_DEPARTMENT';
  end if;

  if p_work_guide_id is null then
    if not public.current_user_can_manage_department(p_department_id) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
    end if;
    insert into public.work_guides (
      department_id, title, category, guide_format, audience_scope, audience_department_id,
      summary_text, materials_text, caution_text, common_mistakes_text, completion_text,
      contact_label, cover_image_url, cover_image_alt, is_featured, status, change_reason,
      created_by, updated_by, published_at
    ) values (
      p_department_id, btrim(p_title), p_category, p_guide_format, p_audience_scope, p_audience_department_id,
      nullif(btrim(coalesce(p_summary_text, '')), ''), nullif(btrim(coalesce(p_materials_text, '')), ''),
      nullif(btrim(coalesce(p_caution_text, '')), ''), nullif(btrim(coalesce(p_common_mistakes_text, '')), ''),
      nullif(btrim(coalesce(p_completion_text, '')), ''), nullif(btrim(coalesce(p_contact_label, '')), ''),
      normalized_url, normalized_alt, coalesce(p_is_featured, false), p_status, btrim(p_change_reason),
      auth.uid(), auth.uid(), case when p_status = 'published' then now() else null end
    ) returning id into saved_id;
  else
    select status into previous_status from public.work_guides where id = p_work_guide_id for update;
    if previous_status is null or not public.current_user_can_manage_work_guide(p_work_guide_id) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
    end if;
    if not public.current_user_can_manage_department(p_department_id) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
    end if;
    update public.work_guides
    set department_id = p_department_id, title = btrim(p_title), category = p_category,
        guide_format = p_guide_format, audience_scope = p_audience_scope,
        audience_department_id = p_audience_department_id,
        summary_text = nullif(btrim(coalesce(p_summary_text, '')), ''),
        materials_text = nullif(btrim(coalesce(p_materials_text, '')), ''),
        caution_text = nullif(btrim(coalesce(p_caution_text, '')), ''),
        common_mistakes_text = nullif(btrim(coalesce(p_common_mistakes_text, '')), ''),
        completion_text = nullif(btrim(coalesce(p_completion_text, '')), ''),
        contact_label = nullif(btrim(coalesce(p_contact_label, '')), ''),
        cover_image_url = normalized_url, cover_image_alt = normalized_alt,
        is_featured = coalesce(p_is_featured, false), status = p_status,
        change_reason = btrim(p_change_reason), updated_by = auth.uid(),
        version_no = version_no + 1,
        published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end,
        updated_at = now()
    where id = p_work_guide_id returning id into saved_id;
  end if;

  if p_status = 'published' then perform public.private_validate_work_guide_publish(saved_id); end if;
  perform public.private_append_audit(
    auth.uid(), case when p_work_guide_id is null then 'work_guide_created' else
      case when p_status = 'published' and coalesce(previous_status, 'draft') <> 'published' then 'work_guide_published'
           when p_status = 'inactive' then 'work_guide_inactivated' else 'work_guide_updated' end end,
    'work_guide', saved_id::text, 'success', p_change_reason,
    jsonb_build_object('department_id', p_department_id, 'category', p_category,
      'previous_status', previous_status, 'status', p_status, 'version_no', (select version_no from public.work_guides where id = saved_id))
  );
  return jsonb_build_object('ok', true, 'code', 'WORK_GUIDE_SAVED', 'id', saved_id);
end;
$$;

-- PR #21 exposed this temporary writer while step content did not exist.
-- Keep the signature only to fail safely for stale clients; publishing must now
-- use save_work_guide so the step-count check cannot be bypassed.
create or replace function public.save_work_guide_stub(
  p_work_guide_id uuid, p_department_id uuid, p_title text, p_summary_text text,
  p_materials_text text, p_caution_text text, p_status public.board_record_status,
  p_change_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '22023', message = 'WORK_GUIDE_LEGACY_SAVE_DISABLED';
end;
$$;

create or replace function public.save_work_guide_step(
  p_step_id uuid, p_work_guide_id uuid, p_step_order smallint, p_title text,
  p_easy_text text, p_image_url text, p_image_alt text, p_caution_text text,
  p_status public.board_record_status, p_change_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  normalized_url text := nullif(btrim(coalesce(p_image_url, '')), '');
  normalized_alt text := nullif(btrim(coalesce(p_image_alt, '')), '');
begin
  if not public.current_user_can_manage_work_guide(p_work_guide_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_status = 'cancelled' or p_step_order not between 1 and 7
     or char_length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_easy_text, ''))) not between 1 and 500
     or char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 300
     or (normalized_url is not null and normalized_alt is null) then
    raise exception using errcode = '22023', message = 'INVALID_WORK_GUIDE_STEP';
  end if;
  if p_step_id is null then
    insert into public.work_guide_steps (work_guide_id, step_order, title, easy_text, image_url, image_alt, caution_text, status, created_by, updated_by)
    values (p_work_guide_id, p_step_order, btrim(p_title), btrim(p_easy_text), normalized_url, normalized_alt,
      nullif(btrim(coalesce(p_caution_text, '')), ''), p_status, auth.uid(), auth.uid()) returning id into saved_id;
  else
    if not exists (select 1 from public.work_guide_steps where id = p_step_id and work_guide_id = p_work_guide_id) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
    end if;
    update public.work_guide_steps
    set step_order = p_step_order, title = btrim(p_title), easy_text = btrim(p_easy_text),
        image_url = normalized_url, image_alt = normalized_alt,
        caution_text = nullif(btrim(coalesce(p_caution_text, '')), ''), status = p_status,
        updated_by = auth.uid(), updated_at = now()
    where id = p_step_id returning id into saved_id;
  end if;
  perform public.private_work_guide_touch(p_work_guide_id);
  perform public.private_append_audit(auth.uid(), case when p_step_id is null then 'work_guide_step_created' else 'work_guide_step_updated' end,
    'work_guide_step', saved_id::text, 'success', p_change_reason,
    jsonb_build_object('work_guide_id', p_work_guide_id, 'step_order', p_step_order, 'status', p_status));
  return jsonb_build_object('ok', true, 'code', 'WORK_GUIDE_STEP_SAVED', 'id', saved_id);
end;
$$;

create or replace function public.reorder_work_guide_steps(p_work_guide_id uuid, p_step_ids jsonb, p_change_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare expected_count integer; supplied_count integer; step_id uuid; item jsonb; sequence_no integer := 0;
begin
  if not public.current_user_can_manage_work_guide(p_work_guide_id) then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if jsonb_typeof(p_step_ids) <> 'array' or char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 300 then
    raise exception using errcode = '22023', message = 'INVALID_STEP_ORDER';
  end if;
  select count(*) into expected_count from public.work_guide_steps where work_guide_id = p_work_guide_id;
  select count(distinct value) into supplied_count from jsonb_array_elements_text(p_step_ids);
  if expected_count <> jsonb_array_length(p_step_ids) or supplied_count <> expected_count or expected_count > 7 then
    raise exception using errcode = '22023', message = 'INVALID_STEP_ORDER';
  end if;
  update public.work_guide_steps set step_order = step_order + 20, updated_at = now()
  where work_guide_id = p_work_guide_id;
  for item in select value from jsonb_array_elements(p_step_ids) loop
    sequence_no := sequence_no + 1; step_id := trim(both '"' from item::text)::uuid;
    update public.work_guide_steps set step_order = sequence_no, updated_by = auth.uid(), updated_at = now()
    where id = step_id and work_guide_id = p_work_guide_id;
    if not found then raise exception using errcode = '22023', message = 'INVALID_STEP_ORDER'; end if;
  end loop;
  perform public.private_work_guide_touch(p_work_guide_id);
  perform public.private_append_audit(auth.uid(), 'work_guide_steps_reordered', 'work_guide', p_work_guide_id::text,
    'success', p_change_reason, jsonb_build_object('step_count', expected_count));
  return jsonb_build_object('ok', true, 'code', 'WORK_GUIDE_STEPS_REORDERED');
end;
$$;

create or replace function public.get_my_work_guide_list(
  p_category public.work_guide_category default null,
  p_today_only boolean default false,
  p_featured_only boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', guide.id, 'title', guide.title, 'summary', guide.summary_text,
    'category', guide.category, 'cover_image_url', guide.cover_image_url,
    'cover_image_alt', guide.cover_image_alt, 'updated_at', guide.updated_at,
    'is_today', exists (select 1 from public.daily_work_assignments task where task.work_guide_id = guide.id
      and task.work_date = current_date and task.status = 'published'
      and public.today_target_matches_current_user(task.target_scope, task.target_department_id, task.target_work_group_id, task.target_profile_id)),
    'is_featured', guide.is_featured
  ) order by
    exists (select 1 from public.daily_work_assignments task where task.work_guide_id = guide.id
      and task.work_date = current_date and task.status = 'published'
      and public.today_target_matches_current_user(task.target_scope, task.target_department_id, task.target_work_group_id, task.target_profile_id)) desc,
    guide.is_featured desc, guide.updated_at desc), '[]'::jsonb)
  from public.work_guides guide
  where guide.status = 'published'
    and public.current_user_can_read_work_guide(guide.id)
    and (p_category is null or guide.category = p_category)
    and (not p_featured_only or guide.is_featured)
    and (not p_today_only or exists (
      select 1 from public.daily_work_assignments task where task.work_guide_id = guide.id
        and task.work_date = current_date and task.status = 'published'
        and public.today_target_matches_current_user(task.target_scope, task.target_department_id, task.target_work_group_id, task.target_profile_id)
    ));
$$;

create or replace function public.get_my_work_guide_detail(p_work_guide_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.current_user_can_read_work_guide(p_work_guide_id) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  select jsonb_build_object(
    'id', guide.id, 'title', guide.title, 'summary', guide.summary_text, 'category', guide.category,
    'guide_format', guide.guide_format, 'materials', guide.materials_text, 'caution', guide.caution_text,
    'common_mistakes', guide.common_mistakes_text, 'completion', guide.completion_text,
    'contact_label', guide.contact_label, 'cover_image_url', guide.cover_image_url,
    'cover_image_alt', guide.cover_image_alt, 'updated_at', guide.updated_at, 'version_no', guide.version_no,
    'steps', coalesce((select jsonb_agg(jsonb_build_object(
      'id', step.id, 'step_order', step.step_order, 'title', step.title, 'easy_text', step.easy_text,
      'image_url', step.image_url, 'image_alt', step.image_alt, 'caution', step.caution_text
    ) order by step.step_order) from public.work_guide_steps step
      where step.work_guide_id = guide.id and step.status = 'published'), '[]'::jsonb)
  ) into result from public.work_guides guide where guide.id = p_work_guide_id and guide.status = 'published';
  if result is null then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return result;
end;
$$;

create or replace function public.list_manageable_work_guides()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', guide.id, 'title', guide.title, 'department_id', guide.department_id,
    'category', guide.category, 'guide_format', guide.guide_format, 'status', guide.status,
    'version_no', guide.version_no, 'updated_at', guide.updated_at,
    'step_count', (select count(*) from public.work_guide_steps step where step.work_guide_id = guide.id),
    'published_step_count', (select count(*) from public.work_guide_steps step where step.work_guide_id = guide.id and step.status = 'published')
  ) order by guide.updated_at desc), '[]'::jsonb)
  from public.work_guides guide where public.current_user_can_manage_work_guide(guide.id);
$$;

create or replace function public.get_manageable_work_guide_detail(p_work_guide_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.current_user_can_manage_work_guide(p_work_guide_id) then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  select jsonb_build_object('guide', to_jsonb(guide) - 'created_by' - 'updated_by', 'steps', coalesce((
    select jsonb_agg(to_jsonb(step) - 'created_by' - 'updated_by' order by step.step_order)
    from public.work_guide_steps step where step.work_guide_id = guide.id), '[]'::jsonb))
  into result from public.work_guides guide where guide.id = p_work_guide_id;
  return result;
end;
$$;

create or replace function public.private_enforce_published_work_guide_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.work_guide_id is not null and not exists (
    select 1 from public.work_guides where id = new.work_guide_id and status = 'published'
  ) then raise exception using errcode = '22023', message = 'WORK_GUIDE_MUST_BE_PUBLISHED'; end if;
  return new;
end;
$$;

create trigger daily_work_assignments_published_guide_only
before insert or update of work_guide_id on public.daily_work_assignments
for each row execute function public.private_enforce_published_work_guide_assignment();

alter table public.work_guide_steps enable row level security;
alter function public.current_user_can_manage_work_guide(uuid) owner to postgres;
alter function public.current_user_can_read_work_guide(uuid) owner to postgres;
alter function public.private_validate_work_guide_publish(uuid) owner to postgres;
alter function public.private_work_guide_touch(uuid) owner to postgres;
alter function public.save_work_guide(uuid, uuid, text, public.work_guide_category, public.work_guide_format, public.work_guide_audience_scope, uuid, text, text, text, text, text, text, text, text, boolean, public.board_record_status, text) owner to postgres;
alter function public.save_work_guide_stub(uuid, uuid, text, text, text, text, public.board_record_status, text) owner to postgres;
alter function public.save_work_guide_step(uuid, uuid, smallint, text, text, text, text, text, public.board_record_status, text) owner to postgres;
alter function public.reorder_work_guide_steps(uuid, jsonb, text) owner to postgres;
alter function public.get_my_work_guide_list(public.work_guide_category, boolean, boolean) owner to postgres;
alter function public.get_my_work_guide_detail(uuid) owner to postgres;
alter function public.list_manageable_work_guides() owner to postgres;
alter function public.get_manageable_work_guide_detail(uuid) owner to postgres;

drop policy if exists work_guides_read on public.work_guides;
create policy work_guides_read on public.work_guides for select to authenticated using (
  public.current_user_can_read_work_guide(id)
);
create policy work_guide_steps_read on public.work_guide_steps for select to authenticated using (
  public.current_user_can_manage_work_guide(work_guide_id)
  or (status = 'published' and public.current_user_can_read_work_guide(work_guide_id))
);

revoke all on public.work_guide_steps from public, anon, authenticated;
revoke execute on function public.current_user_can_manage_work_guide(uuid) from public, anon;
revoke execute on function public.current_user_can_read_work_guide(uuid) from public, anon;
revoke execute on function public.private_validate_work_guide_publish(uuid) from public, anon, authenticated;
revoke execute on function public.private_work_guide_touch(uuid) from public, anon, authenticated;
revoke execute on function public.save_work_guide(uuid, uuid, text, public.work_guide_category, public.work_guide_format, public.work_guide_audience_scope, uuid, text, text, text, text, text, text, text, text, boolean, public.board_record_status, text) from public, anon;
revoke execute on function public.save_work_guide_stub(uuid, uuid, text, text, text, text, public.board_record_status, text) from public, anon, authenticated;
revoke execute on function public.save_work_guide_step(uuid, uuid, smallint, text, text, text, text, text, public.board_record_status, text) from public, anon;
revoke execute on function public.reorder_work_guide_steps(uuid, jsonb, text) from public, anon;
revoke execute on function public.get_my_work_guide_list(public.work_guide_category, boolean, boolean) from public, anon;
revoke execute on function public.get_my_work_guide_detail(uuid) from public, anon;
revoke execute on function public.list_manageable_work_guides() from public, anon;
revoke execute on function public.get_manageable_work_guide_detail(uuid) from public, anon;
grant execute on function public.current_user_can_manage_work_guide(uuid) to authenticated;
grant execute on function public.current_user_can_read_work_guide(uuid) to authenticated;
grant execute on function public.save_work_guide(uuid, uuid, text, public.work_guide_category, public.work_guide_format, public.work_guide_audience_scope, uuid, text, text, text, text, text, text, text, text, boolean, public.board_record_status, text) to authenticated;
grant execute on function public.save_work_guide_step(uuid, uuid, smallint, text, text, text, text, text, public.board_record_status, text) to authenticated;
grant execute on function public.reorder_work_guide_steps(uuid, jsonb, text) to authenticated;
grant execute on function public.get_my_work_guide_list(public.work_guide_category, boolean, boolean) to authenticated;
grant execute on function public.get_my_work_guide_detail(uuid) to authenticated;
grant execute on function public.list_manageable_work_guides() to authenticated;
grant execute on function public.get_manageable_work_guide_detail(uuid) to authenticated;

commit;
