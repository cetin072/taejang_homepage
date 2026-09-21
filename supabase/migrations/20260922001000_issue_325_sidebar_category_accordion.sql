-- Issue #325: category accordion preference replaces whole-sidebar collapse.
begin;

alter table public.profile_ui_preferences
  add column if not exists collapsed_sections jsonb not null default '[]'::jsonb;

do $$
begin
  alter table public.profile_ui_preferences
    add constraint profile_ui_preferences_collapsed_sections_array_ck
    check(jsonb_typeof(collapsed_sections)='array');
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.profile_ui_preferences
    add constraint profile_ui_preferences_collapsed_sections_size_ck
    check(jsonb_array_length(collapsed_sections)<=20);
exception when duplicate_object then null;
end;
$$;

-- Whole-sidebar collapse was a mistaken UX interpretation. Keep the old column only
-- for backwards compatibility but reset it and stop using it in the browser.
update public.profile_ui_preferences
set sidebar_collapsed=false
where sidebar_collapsed;

create or replace function public.get_my_ui_preferences(p_role_code text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  actor_id uuid:=(select auth.uid());
  resolved_role text;
  pref public.profile_ui_preferences%rowtype;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode='42501',message='PROFILE_NOT_ACTIVE';
  end if;

  resolved_role:=public.private_resolve_ui_role(p_role_code);
  if resolved_role is null then
    raise exception using errcode='42501',message='UI_ROLE_REQUIRED';
  end if;

  select *
  into pref
  from public.profile_ui_preferences p
  where p.profile_id=actor_id and p.role_code=resolved_role;

  return jsonb_build_object(
    'role_code',resolved_role,
    'sidebar_collapsed',false,
    'collapsed_sections',coalesce(pref.collapsed_sections,'[]'::jsonb),
    'dashboard_order',coalesce(pref.dashboard_order,'[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_ui_preferences(text) from public,anon;
grant execute on function public.get_my_ui_preferences(text) to authenticated;

create or replace function public.save_my_sidebar_sections(
  p_role_code text,
  p_collapsed_sections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor_id uuid:=(select auth.uid());
  resolved_role text;
  clean_sections jsonb;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode='42501',message='PROFILE_NOT_ACTIVE';
  end if;

  resolved_role:=public.private_resolve_ui_role(p_role_code);
  if resolved_role is null then
    raise exception using errcode='42501',message='UI_ROLE_REQUIRED';
  end if;

  if p_collapsed_sections is null
     or jsonb_typeof(p_collapsed_sections)<>'array'
     or jsonb_array_length(p_collapsed_sections)>20 then
    raise exception using errcode='22023',message='INVALID_COLLAPSED_SECTIONS';
  end if;

  if exists(
    select 1
    from jsonb_array_elements(p_collapsed_sections) item
    where jsonb_typeof(item)<>'string'
       or trim(both '"' from item::text) !~ '^[a-z][a-z0-9_.-]{1,79}$'
  ) then
    raise exception using errcode='22023',message='INVALID_COLLAPSED_SECTION_ITEM';
  end if;

  select coalesce(jsonb_agg(to_jsonb(value) order by value),'[]'::jsonb)
  into clean_sections
  from (
    select distinct trim(both '"' from item::text) value
    from jsonb_array_elements(p_collapsed_sections) item
  ) dedup;

  insert into public.profile_ui_preferences(
    profile_id,role_code,sidebar_collapsed,collapsed_sections,dashboard_order,updated_at
  )
  values(actor_id,resolved_role,false,clean_sections,'[]'::jsonb,now())
  on conflict(profile_id,role_code) do update
  set sidebar_collapsed=false,
      collapsed_sections=excluded.collapsed_sections,
      updated_at=now();

  return public.get_my_ui_preferences(resolved_role)||jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.save_my_sidebar_sections(text,jsonb) from public,anon;
grant execute on function public.save_my_sidebar_sections(text,jsonb) to authenticated;

comment on column public.profile_ui_preferences.collapsed_sections is
  'Per-profile, per-role collapsed desktop sidebar category keys. Empty means all categories expanded.';

commit;
