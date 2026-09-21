-- Issue #323: configurable role navigation visibility and personal UI preferences.
begin;

insert into public.platform_capabilities(
  code,capability_kind,operations_manager_auto_grant,description,active
)
values(
  'platform.navigation.manage',
  'operational',
  true,
  '직책·역할별 사이드바 표시 설정을 관리합니다.',
  true
)
on conflict(code) do update
set capability_kind=excluded.capability_kind,
    operations_manager_auto_grant=true,
    description=excluded.description,
    active=true,
    updated_at=now();

create table if not exists public.role_navigation_visibility(
  role_code text not null references public.roles(code) on update cascade on delete cascade,
  menu_key text not null,
  visible boolean not null default true,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key(role_code,menu_key),
  constraint role_navigation_visibility_menu_key_ck
    check(menu_key ~ '^[a-z][a-z0-9_.-]{1,79}$')
);

create table if not exists public.profile_ui_preferences(
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_code text not null references public.roles(code) on update cascade on delete cascade,
  sidebar_collapsed boolean not null default false,
  dashboard_order jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(profile_id,role_code),
  constraint profile_ui_preferences_dashboard_order_array_ck
    check(jsonb_typeof(dashboard_order)='array'),
  constraint profile_ui_preferences_dashboard_order_size_ck
    check(jsonb_array_length(dashboard_order)<=100)
);

alter table public.role_navigation_visibility enable row level security;
alter table public.profile_ui_preferences enable row level security;

revoke all on public.role_navigation_visibility from public,anon,authenticated;
revoke all on public.profile_ui_preferences from public,anon,authenticated;

create or replace function public.private_resolve_ui_role(p_role_code text)
returns text
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  result text;
  effective text[]:=public.private_effective_role_codes();
  actual text[]:=public.private_actual_role_codes();
begin
  if p_role_code is not null and btrim(p_role_code)<>'' then
    result:=btrim(p_role_code);
  elsif coalesce(cardinality(effective),0)>0 then
    result:=effective[1];
  elsif coalesce(cardinality(actual),0)>0 then
    result:=actual[1];
  else
    return null;
  end if;

  if not exists(select 1 from public.roles r where r.code=result and r.active) then
    raise exception using errcode='22023',message='INVALID_UI_ROLE';
  end if;

  if not (result=any(coalesce(effective,array[]::text[])) or result=any(coalesce(actual,array[]::text[]))) then
    raise exception using errcode='42501',message='UI_ROLE_CONTEXT_FORBIDDEN';
  end if;

  return result;
end;
$$;

revoke all on function public.private_resolve_ui_role(text) from public,anon,authenticated;

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
    'sidebar_collapsed',coalesce(pref.sidebar_collapsed,false),
    'dashboard_order',coalesce(pref.dashboard_order,'[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_ui_preferences(text) from public,anon;
grant execute on function public.get_my_ui_preferences(text) to authenticated;

create or replace function public.save_my_ui_preferences(
  p_role_code text,
  p_sidebar_collapsed boolean default null,
  p_dashboard_order jsonb default null
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
  final_order jsonb;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode='42501',message='PROFILE_NOT_ACTIVE';
  end if;

  resolved_role:=public.private_resolve_ui_role(p_role_code);
  if resolved_role is null then
    raise exception using errcode='42501',message='UI_ROLE_REQUIRED';
  end if;

  select *
  into current_pref
  from public.profile_ui_preferences p
  where p.profile_id=actor_id and p.role_code=resolved_role;

  final_sidebar:=coalesce(p_sidebar_collapsed,current_pref.sidebar_collapsed,false);
  final_order:=coalesce(p_dashboard_order,current_pref.dashboard_order,'[]'::jsonb);

  if jsonb_typeof(final_order)<>'array' or jsonb_array_length(final_order)>100 then
    raise exception using errcode='22023',message='INVALID_DASHBOARD_ORDER';
  end if;

  if exists(
    select 1
    from jsonb_array_elements(final_order) item
    where jsonb_typeof(item)<>'string'
       or char_length(trim(both '"' from item::text))>100
  ) then
    raise exception using errcode='22023',message='INVALID_DASHBOARD_ORDER_ITEM';
  end if;

  insert into public.profile_ui_preferences(
    profile_id,role_code,sidebar_collapsed,dashboard_order,updated_at
  )
  values(actor_id,resolved_role,final_sidebar,final_order,now())
  on conflict(profile_id,role_code) do update
  set sidebar_collapsed=excluded.sidebar_collapsed,
      dashboard_order=excluded.dashboard_order,
      updated_at=now();

  return public.get_my_ui_preferences(resolved_role)||jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.save_my_ui_preferences(text,boolean,jsonb) from public,anon;
grant execute on function public.save_my_ui_preferences(text,boolean,jsonb) to authenticated;

create or replace function public.get_my_navigation_visibility(p_role_code text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  actor_id uuid:=(select auth.uid());
  resolved_role text;
  hidden_keys jsonb;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode='42501',message='PROFILE_NOT_ACTIVE';
  end if;

  resolved_role:=public.private_resolve_ui_role(p_role_code);
  if resolved_role is null then
    raise exception using errcode='42501',message='UI_ROLE_REQUIRED';
  end if;

  select coalesce(jsonb_agg(v.menu_key order by v.menu_key),'[]'::jsonb)
  into hidden_keys
  from public.role_navigation_visibility v
  where v.role_code=resolved_role and not v.visible;

  return jsonb_build_object(
    'role_code',resolved_role,
    'hidden_menu_keys',hidden_keys
  );
end;
$$;

revoke all on function public.get_my_navigation_visibility(text) from public,anon;
grant execute on function public.get_my_navigation_visibility(text) to authenticated;

create or replace function public.get_platform_navigation_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  actor_id uuid:=(select auth.uid());
  role_rows jsonb;
  visibility_rows jsonb;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.private_actor_can('platform.navigation.manage') then
    raise exception using errcode='42501',message='PLATFORM_NAVIGATION_MANAGE_FORBIDDEN';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('code',r.code,'name',r.name) order by r.sort_order,r.name),
    '[]'::jsonb
  )
  into role_rows
  from public.roles r
  where r.active and r.code<>'general_worker';

  select coalesce(
    jsonb_agg(
      jsonb_build_object('role_code',v.role_code,'menu_key',v.menu_key,'visible',v.visible)
      order by v.role_code,v.menu_key
    ),
    '[]'::jsonb
  )
  into visibility_rows
  from public.role_navigation_visibility v;

  return jsonb_build_object(
    'roles',role_rows,
    'visibility',visibility_rows
  );
end;
$$;

revoke all on function public.get_platform_navigation_settings() from public,anon;
grant execute on function public.get_platform_navigation_settings() to authenticated;

create or replace function public.save_role_navigation_visibility(
  p_role_code text,
  p_visibility jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor_id uuid:=(select auth.uid());
  item record;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.private_actor_can('platform.navigation.manage') then
    raise exception using errcode='42501',message='PLATFORM_NAVIGATION_MANAGE_FORBIDDEN';
  end if;

  if not exists(select 1 from public.roles r where r.code=p_role_code and r.active and r.code<>'general_worker') then
    raise exception using errcode='22023',message='INVALID_NAVIGATION_ROLE';
  end if;

  if p_visibility is null or jsonb_typeof(p_visibility)<>'object' then
    raise exception using errcode='22023',message='INVALID_NAVIGATION_VISIBILITY';
  end if;

  if (select count(*) from jsonb_each(p_visibility))>100 then
    raise exception using errcode='22023',message='TOO_MANY_NAVIGATION_ITEMS';
  end if;

  for item in select key,value from jsonb_each(p_visibility)
  loop
    if item.key !~ '^[a-z][a-z0-9_.-]{1,79}$'
       or jsonb_typeof(item.value)<>'boolean' then
      raise exception using errcode='22023',message='INVALID_NAVIGATION_VISIBILITY_ITEM';
    end if;

    insert into public.role_navigation_visibility(
      role_code,menu_key,visible,updated_by,updated_at
    )
    values(
      p_role_code,item.key,(item.value #>> '{}')::boolean,actor_id,now()
    )
    on conflict(role_code,menu_key) do update
    set visible=excluded.visible,
        updated_by=actor_id,
        updated_at=now();
  end loop;

  perform public.private_append_audit(
    actor_id,
    'role_navigation_visibility_saved',
    'role',
    p_role_code,
    'success',
    '직책·역할별 사이드바 표시 설정 저장',
    jsonb_build_object('role_code',p_role_code,'item_count',(select count(*) from jsonb_each(p_visibility)))
  );

  return jsonb_build_object('ok',true,'role_code',p_role_code);
end;
$$;

revoke all on function public.save_role_navigation_visibility(text,jsonb) from public,anon;
grant execute on function public.save_role_navigation_visibility(text,jsonb) to authenticated;

create or replace function public.reset_role_navigation_visibility(p_role_code text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor_id uuid:=(select auth.uid());
  deleted_count integer;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.private_actor_can('platform.navigation.manage') then
    raise exception using errcode='42501',message='PLATFORM_NAVIGATION_MANAGE_FORBIDDEN';
  end if;

  delete from public.role_navigation_visibility
  where role_code=p_role_code;
  get diagnostics deleted_count=row_count;

  perform public.private_append_audit(
    actor_id,
    'role_navigation_visibility_reset',
    'role',
    p_role_code,
    'success',
    '직책·역할별 사이드바 표시 설정 초기화',
    jsonb_build_object('role_code',p_role_code,'deleted_count',deleted_count)
  );

  return jsonb_build_object('ok',true,'role_code',p_role_code,'deleted_count',deleted_count);
end;
$$;

revoke all on function public.reset_role_navigation_visibility(text) from public,anon;
grant execute on function public.reset_role_navigation_visibility(text) to authenticated;

comment on table public.role_navigation_visibility is
  'Operations-managed display-only role navigation overrides. Does not grant capabilities.';
comment on table public.profile_ui_preferences is
  'Per-profile UI preferences such as desktop sidebar collapse and dashboard card order.';

commit;
