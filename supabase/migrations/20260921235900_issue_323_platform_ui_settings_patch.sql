-- Issue #323 follow-up: align settings RPC with the current roles schema.
begin;

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
    jsonb_agg(jsonb_build_object('code',r.code,'name',r.name) order by r.name,r.code),
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

  return jsonb_build_object('roles',role_rows,'visibility',visibility_rows);
end;
$$;

revoke all on function public.get_platform_navigation_settings() from public,anon;
grant execute on function public.get_platform_navigation_settings() to authenticated;

commit;
