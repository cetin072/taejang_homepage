-- Goal #327: persist lightweight, per-profile inline navigation ordering.
begin;

alter table public.profile_ui_preferences
  add column if not exists sidebar_section_order jsonb not null default '[]'::jsonb,
  add column if not exists sidebar_menu_order jsonb not null default '[]'::jsonb;

do $$
begin
  alter table public.profile_ui_preferences
    add constraint profile_ui_preferences_sidebar_section_order_array_ck
    check(jsonb_typeof(sidebar_section_order)='array');
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.profile_ui_preferences
    add constraint profile_ui_preferences_sidebar_menu_order_array_ck
    check(jsonb_typeof(sidebar_menu_order)='array');
exception when duplicate_object then null;
end;
$$;

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

  select * into pref
  from public.profile_ui_preferences p
  where p.profile_id=actor_id and p.role_code=resolved_role;

  return jsonb_build_object(
    'role_code',resolved_role,
    'sidebar_collapsed',false,
    'collapsed_sections',coalesce(pref.collapsed_sections,'[]'::jsonb),
    'sidebar_section_order',coalesce(pref.sidebar_section_order,'[]'::jsonb),
    'sidebar_menu_order',coalesce(pref.sidebar_menu_order,'[]'::jsonb),
    'dashboard_order',coalesce(pref.dashboard_order,'[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_ui_preferences(text) from public,anon;
grant execute on function public.get_my_ui_preferences(text) to authenticated;

-- PostgREST resolves RPC names by signature. Replace the earlier three-argument
-- form instead of leaving an ambiguous overload with default arguments.
drop function if exists public.save_my_ui_preferences(text,boolean,jsonb);

create function public.save_my_ui_preferences(
  p_role_code text,
  p_sidebar_collapsed boolean default null,
  p_dashboard_order jsonb default null,
  p_sidebar_section_order jsonb default null,
  p_sidebar_menu_order jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor_id uuid:=(select auth.uid());
  resolved_role text;
  current_pref public.profile_ui_preferences%rowtype;
  final_sidebar boolean;
  final_dashboard_order jsonb;
  final_section_order jsonb;
  final_menu_order jsonb;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode='42501',message='PROFILE_NOT_ACTIVE';
  end if;

  resolved_role:=public.private_resolve_ui_role(p_role_code);
  if resolved_role is null then
    raise exception using errcode='42501',message='UI_ROLE_REQUIRED';
  end if;

  select * into current_pref
  from public.profile_ui_preferences p
  where p.profile_id=actor_id and p.role_code=resolved_role;

  final_sidebar:=coalesce(p_sidebar_collapsed,current_pref.sidebar_collapsed,false);
  final_dashboard_order:=coalesce(p_dashboard_order,current_pref.dashboard_order,'[]'::jsonb);
  final_section_order:=coalesce(p_sidebar_section_order,current_pref.sidebar_section_order,'[]'::jsonb);
  final_menu_order:=coalesce(p_sidebar_menu_order,current_pref.sidebar_menu_order,'[]'::jsonb);

  if jsonb_typeof(final_dashboard_order)<>'array' or jsonb_array_length(final_dashboard_order)>100
     or exists(select 1 from jsonb_array_elements(final_dashboard_order) item where jsonb_typeof(item)<>'string' or char_length(trim(both '"' from item::text))>100)
     or (select count(*) from jsonb_array_elements_text(final_dashboard_order)) <> (select count(distinct value) from jsonb_array_elements_text(final_dashboard_order) value) then
    raise exception using errcode='22023',message='INVALID_DASHBOARD_ORDER';
  end if;

  if jsonb_typeof(final_section_order)<>'array' or jsonb_array_length(final_section_order)>20
     or exists(select 1 from jsonb_array_elements(final_section_order) item where jsonb_typeof(item)<>'string' or trim(both '"' from item::text) !~ '^[a-z][a-z0-9_.-]{1,79}$')
     or (select count(*) from jsonb_array_elements_text(final_section_order)) <> (select count(distinct value) from jsonb_array_elements_text(final_section_order) value) then
    raise exception using errcode='22023',message='INVALID_SIDEBAR_SECTION_ORDER';
  end if;

  if jsonb_typeof(final_menu_order)<>'array' or jsonb_array_length(final_menu_order)>100
     or exists(select 1 from jsonb_array_elements(final_menu_order) item where jsonb_typeof(item)<>'string' or trim(both '"' from item::text) !~ '^[a-z][a-z0-9_.-]{1,79}$')
     or (select count(*) from jsonb_array_elements_text(final_menu_order)) <> (select count(distinct value) from jsonb_array_elements_text(final_menu_order) value) then
    raise exception using errcode='22023',message='INVALID_SIDEBAR_MENU_ORDER';
  end if;

  insert into public.profile_ui_preferences(
    profile_id,role_code,sidebar_collapsed,collapsed_sections,dashboard_order,sidebar_section_order,sidebar_menu_order,updated_at
  )
  values(
    actor_id,resolved_role,final_sidebar,coalesce(current_pref.collapsed_sections,'[]'::jsonb),final_dashboard_order,final_section_order,final_menu_order,now()
  )
  on conflict(profile_id,role_code) do update
  set sidebar_collapsed=excluded.sidebar_collapsed,
      dashboard_order=excluded.dashboard_order,
      sidebar_section_order=excluded.sidebar_section_order,
      sidebar_menu_order=excluded.sidebar_menu_order,
      updated_at=now();

  return public.get_my_ui_preferences(resolved_role)||jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.save_my_ui_preferences(text,boolean,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.save_my_ui_preferences(text,boolean,jsonb,jsonb,jsonb) to authenticated;

comment on column public.profile_ui_preferences.sidebar_section_order is
  'Per-profile, per-role sidebar category keys in the user-selected order.';
comment on column public.profile_ui_preferences.sidebar_menu_order is
  'Per-profile, per-role sidebar menu keys in the user-selected order. Unknown keys are ignored in the browser.';

commit;
