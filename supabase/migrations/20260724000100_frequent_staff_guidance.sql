-- Taejang frequently used staff guidance. This is deliberately separate from time-bound notices.
begin;

create type public.staff_guidance_category as enum (
  'working_hours', 'breaks_meals', 'places', 'safety', 'clothing_supplies',
  'absence_contact', 'pay_documents', 'help_request', 'company_life', 'other'
);

create table public.staff_guidance_items (
  id uuid primary key default gen_random_uuid(),
  category public.staff_guidance_category not null,
  title text not null check (char_length(title) between 1 and 120),
  summary_easy text not null check (char_length(summary_easy) between 1 and 500),
  body_easy text not null check (char_length(body_easy) between 1 and 3000),
  location_text text check (char_length(coalesce(location_text, '')) <= 200),
  help_contact_label text check (char_length(coalesce(help_contact_label, '')) <= 160),
  help_method_text text check (char_length(coalesce(help_method_text, '')) <= 1000),
  related_work_guide_id uuid references public.work_guides(id) on delete restrict,
  related_schedule_id uuid references public.schedule_items(id) on delete restrict,
  related_link_url text,
  related_link_label text check (char_length(coalesce(related_link_label, '')) <= 160),
  target_scope public.today_target_scope not null,
  target_department_id uuid references public.departments(id) on delete restrict,
  target_work_group_id uuid references public.work_groups(id) on delete restrict,
  target_profile_id uuid references public.profiles(id) on delete restrict,
  display_order integer not null default 0 check (display_order between -100000 and 100000),
  is_featured boolean not null default false,
  status public.board_record_status not null default 'draft',
  effective_from date,
  effective_until date,
  change_reason text not null check (char_length(change_reason) between 1 and 300),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_until is null or effective_from is null or effective_until >= effective_from),
  check (
    (related_link_url is null and related_link_label is null)
    or (related_link_url is not null and related_link_label is not null and public.is_safe_https_url(related_link_url))
  ),
  check (
    (target_scope = 'company' and target_department_id is null and target_work_group_id is null and target_profile_id is null)
    or (target_scope = 'department' and target_department_id is not null and target_work_group_id is null and target_profile_id is null)
    or (target_scope = 'work_group' and target_department_id is null and target_work_group_id is not null and target_profile_id is null)
    or (target_scope = 'profile' and target_department_id is null and target_work_group_id is null and target_profile_id is not null)
  )
);

create index staff_guidance_items_worker_list_idx
  on public.staff_guidance_items (status, is_featured desc, display_order, updated_at desc, title);
create index staff_guidance_items_department_idx on public.staff_guidance_items (target_department_id) where target_department_id is not null;
create index staff_guidance_items_work_group_idx on public.staff_guidance_items (target_work_group_id) where target_work_group_id is not null;
create index staff_guidance_items_profile_idx on public.staff_guidance_items (target_profile_id) where target_profile_id is not null;

comment on table public.staff_guidance_items is
  'Longer-lived repeat-reference guidance. It is not an urgent notice, attendance, support case, or evaluation record.';

create or replace function public.private_staff_guidance_is_current(p_item public.staff_guidance_items)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_item.status = 'published'
    and (p_item.effective_from is null or p_item.effective_from <= current_date)
    and (p_item.effective_until is null or p_item.effective_until >= current_date);
$$;

create or replace function public.get_my_staff_guidance_list(p_category public.staff_guidance_category default null, p_limit integer default 100)
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
      'id', item.id, 'category', item.category, 'title', item.title,
      'summary_easy', item.summary_easy, 'is_featured', item.is_featured,
      'display_order', item.display_order, 'updated_at', item.updated_at
    ) order by item.is_featured desc, item.display_order, item.updated_at desc, item.title)
    from (
      select guidance.* from public.staff_guidance_items guidance
      where public.private_staff_guidance_is_current(guidance)
        and (p_category is null or guidance.category = p_category)
        and public.today_target_matches_current_user(
          guidance.target_scope, guidance.target_department_id, guidance.target_work_group_id, guidance.target_profile_id
        )
      order by guidance.is_featured desc, guidance.display_order, guidance.updated_at desc, guidance.title
      limit p_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_my_staff_guidance_detail(p_guidance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  select jsonb_build_object(
    'id', guidance.id, 'category', guidance.category, 'title', guidance.title,
    'summary_easy', guidance.summary_easy, 'body_easy', guidance.body_easy,
    'location_text', guidance.location_text, 'help_contact_label', guidance.help_contact_label,
    'help_method_text', guidance.help_method_text, 'related_work_guide_id', guidance.related_work_guide_id,
    'related_schedule_id', guidance.related_schedule_id, 'related_link_url', guidance.related_link_url,
    'related_link_label', guidance.related_link_label, 'target_scope', guidance.target_scope,
    'is_featured', guidance.is_featured, 'effective_from', guidance.effective_from,
    'effective_until', guidance.effective_until, 'created_at', guidance.created_at, 'updated_at', guidance.updated_at
  ) into result
  from public.staff_guidance_items guidance
  where guidance.id = p_guidance_id
    and public.private_staff_guidance_is_current(guidance)
    and public.today_target_matches_current_user(
      guidance.target_scope, guidance.target_department_id, guidance.target_work_group_id, guidance.target_profile_id
    );
  if result is null then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return result;
end;
$$;

create or replace function public.list_manageable_staff_guidance(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_profile_is_active() or p_limit not between 1 and 200 then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(item) order by item.updated_at desc, item.title)
    from (
      select guidance.* from public.staff_guidance_items guidance
      where public.current_user_can_manage_today_target(
        guidance.target_scope, guidance.target_department_id, guidance.target_work_group_id, guidance.target_profile_id
      )
      order by guidance.updated_at desc, guidance.title limit p_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_staff_guidance_for_edit(p_guidance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.current_profile_is_active() then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  select to_jsonb(guidance) into result from public.staff_guidance_items guidance
  where guidance.id = p_guidance_id and public.current_user_can_manage_today_target(
    guidance.target_scope, guidance.target_department_id, guidance.target_work_group_id, guidance.target_profile_id
  );
  if result is null then raise exception using errcode = '42501', message = 'FORBIDDEN'; end if;
  return result;
end;
$$;

create or replace function public.save_staff_guidance(
  p_guidance_id uuid, p_category public.staff_guidance_category, p_title text, p_summary_easy text, p_body_easy text,
  p_location_text text, p_help_contact_label text, p_help_method_text text, p_related_work_guide_id uuid,
  p_related_schedule_id uuid, p_related_link_url text, p_related_link_label text, p_target_scope public.today_target_scope,
  p_target_department_id uuid, p_target_work_group_id uuid, p_target_profile_id uuid, p_display_order integer,
  p_is_featured boolean, p_status public.board_record_status, p_effective_from date, p_effective_until date, p_change_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare saved_id uuid; old_item public.staff_guidance_items%rowtype; action_code text;
begin
  perform public.private_validate_today_target(p_target_scope, p_target_department_id, p_target_work_group_id, p_target_profile_id);
  if not public.current_user_can_manage_today_target(p_target_scope, p_target_department_id, p_target_work_group_id, p_target_profile_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_summary_easy, ''))) not between 1 and 500
     or char_length(btrim(coalesce(p_body_easy, ''))) not between 1 and 3000
     or char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 300
     or (p_effective_from is not null and p_effective_until is not null and p_effective_until < p_effective_from)
     or ((p_related_link_url is null) <> (p_related_link_label is null))
     or (p_related_link_url is not null and not public.is_safe_https_url(p_related_link_url)) then
    raise exception using errcode = '22023', message = 'INVALID_STAFF_GUIDANCE';
  end if;
  if p_related_work_guide_id is not null and not public.current_user_can_manage_work_guide(p_related_work_guide_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN_RELATED_WORK_GUIDE');
  end if;
  if p_related_schedule_id is not null and not exists (select 1 from public.schedule_items schedule where schedule.id = p_related_schedule_id and public.current_user_can_manage_today_target(schedule.target_scope, schedule.target_department_id, schedule.target_work_group_id, schedule.target_profile_id)) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN_RELATED_SCHEDULE');
  end if;
  if p_guidance_id is null then
    insert into public.staff_guidance_items(category, title, summary_easy, body_easy, location_text, help_contact_label, help_method_text, related_work_guide_id, related_schedule_id, related_link_url, related_link_label, target_scope, target_department_id, target_work_group_id, target_profile_id, display_order, is_featured, status, effective_from, effective_until, change_reason, created_by, updated_by)
    values(p_category, btrim(p_title), btrim(p_summary_easy), btrim(p_body_easy), nullif(btrim(coalesce(p_location_text, '')), ''), nullif(btrim(coalesce(p_help_contact_label, '')), ''), nullif(btrim(coalesce(p_help_method_text, '')), ''), p_related_work_guide_id, p_related_schedule_id, nullif(btrim(coalesce(p_related_link_url, '')), ''), nullif(btrim(coalesce(p_related_link_label, '')), ''), p_target_scope, p_target_department_id, p_target_work_group_id, p_target_profile_id, p_display_order, p_is_featured, p_status, p_effective_from, p_effective_until, btrim(p_change_reason), auth.uid(), auth.uid()) returning id into saved_id;
    action_code := case when p_status = 'published' then 'staff_guidance_published' else 'staff_guidance_created' end;
  else
    select * into old_item from public.staff_guidance_items where id = p_guidance_id for update;
    if old_item.id is null or not public.current_user_can_manage_today_target(old_item.target_scope, old_item.target_department_id, old_item.target_work_group_id, old_item.target_profile_id) then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
    update public.staff_guidance_items set category=p_category, title=btrim(p_title), summary_easy=btrim(p_summary_easy), body_easy=btrim(p_body_easy), location_text=nullif(btrim(coalesce(p_location_text, '')), ''), help_contact_label=nullif(btrim(coalesce(p_help_contact_label, '')), ''), help_method_text=nullif(btrim(coalesce(p_help_method_text, '')), ''), related_work_guide_id=p_related_work_guide_id, related_schedule_id=p_related_schedule_id, related_link_url=nullif(btrim(coalesce(p_related_link_url, '')), ''), related_link_label=nullif(btrim(coalesce(p_related_link_label, '')), ''), target_scope=p_target_scope, target_department_id=p_target_department_id, target_work_group_id=p_target_work_group_id, target_profile_id=p_target_profile_id, display_order=p_display_order, is_featured=p_is_featured, status=p_status, effective_from=p_effective_from, effective_until=p_effective_until, change_reason=btrim(p_change_reason), updated_by=auth.uid(), updated_at=now() where id=p_guidance_id returning id into saved_id;
    action_code := case when old_item.status <> 'published' and p_status = 'published' then 'staff_guidance_published' when old_item.status <> 'inactive' and p_status = 'inactive' then 'staff_guidance_inactivated' else 'staff_guidance_updated' end;
  end if;
  perform public.private_append_audit(auth.uid(), action_code, 'staff_guidance', saved_id::text, 'success', p_change_reason,
    jsonb_build_object('previous_status', old_item.status, 'status', p_status, 'category_changed', p_guidance_id is not null and old_item.category is distinct from p_category, 'target_changed', p_guidance_id is not null and (old_item.target_scope is distinct from p_target_scope or old_item.target_department_id is distinct from p_target_department_id or old_item.target_work_group_id is distinct from p_target_work_group_id or old_item.target_profile_id is distinct from p_target_profile_id), 'display_order_changed', p_guidance_id is not null and old_item.display_order is distinct from p_display_order, 'featured_changed', p_guidance_id is not null and old_item.is_featured is distinct from p_is_featured, 'effective_period_changed', p_guidance_id is not null and (old_item.effective_from is distinct from p_effective_from or old_item.effective_until is distinct from p_effective_until), 'related_link_changed', p_guidance_id is not null and old_item.related_link_url is distinct from p_related_link_url, 'related_work_guide_changed', p_guidance_id is not null and old_item.related_work_guide_id is distinct from p_related_work_guide_id));
  return jsonb_build_object('ok', true, 'code', 'STAFF_GUIDANCE_SAVED', 'id', saved_id);
end;
$$;

alter table public.staff_guidance_items enable row level security;
create policy staff_guidance_items_manager_read on public.staff_guidance_items for select to authenticated using (public.current_user_can_manage_today_target(target_scope, target_department_id, target_work_group_id, target_profile_id));

alter function public.private_staff_guidance_is_current(public.staff_guidance_items) owner to postgres;
alter function public.get_my_staff_guidance_list(public.staff_guidance_category, integer) owner to postgres;
alter function public.get_my_staff_guidance_detail(uuid) owner to postgres;
alter function public.list_manageable_staff_guidance(integer) owner to postgres;
alter function public.get_staff_guidance_for_edit(uuid) owner to postgres;
alter function public.save_staff_guidance(uuid, public.staff_guidance_category, text, text, text, text, text, text, uuid, uuid, text, text, public.today_target_scope, uuid, uuid, uuid, integer, boolean, public.board_record_status, date, date, text) owner to postgres;
revoke all on table public.staff_guidance_items from public, anon, authenticated;
revoke execute on function public.private_staff_guidance_is_current(public.staff_guidance_items) from public, anon, authenticated;
revoke execute on function public.get_my_staff_guidance_list(public.staff_guidance_category, integer) from public, anon;
revoke execute on function public.get_my_staff_guidance_detail(uuid) from public, anon;
revoke execute on function public.list_manageable_staff_guidance(integer) from public, anon;
revoke execute on function public.get_staff_guidance_for_edit(uuid) from public, anon;
revoke execute on function public.save_staff_guidance(uuid, public.staff_guidance_category, text, text, text, text, text, text, uuid, uuid, text, text, public.today_target_scope, uuid, uuid, uuid, integer, boolean, public.board_record_status, date, date, text) from public, anon;
grant execute on function public.get_my_staff_guidance_list(public.staff_guidance_category, integer) to authenticated;
grant execute on function public.get_my_staff_guidance_detail(uuid) to authenticated;
grant execute on function public.list_manageable_staff_guidance(integer) to authenticated;
grant execute on function public.get_staff_guidance_for_edit(uuid) to authenticated;
grant execute on function public.save_staff_guidance(uuid, public.staff_guidance_category, text, text, text, text, text, text, uuid, uuid, text, text, public.today_target_scope, uuid, uuid, uuid, integer, boolean, public.board_record_status, date, date, text) to authenticated;

commit;
