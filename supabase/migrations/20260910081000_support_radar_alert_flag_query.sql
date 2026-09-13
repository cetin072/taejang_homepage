-- Support Radar Phase 1 priority-flag read helper for the notice detail UI.

begin;

create or replace function public.support_get_notice_priority_flags(p_notice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  item public.support_notice_priority_flags%rowtype;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.support_can_view_notice(p_notice_id) then
    raise exception using errcode='42501', message='SUPPORT_PRIORITY_FLAG_READ_FORBIDDEN';
  end if;

  select * into item
  from public.support_notice_priority_flags
  where notice_id=p_notice_id;

  return jsonb_build_object(
    'ok',true,
    'notice_id',p_notice_id,
    'rare_national_opportunity',coalesce(item.rare_national_opportunity,false),
    'force_alert',coalesce(item.force_alert,false),
    'note',item.note,
    'updated_at',item.updated_at
  );
end;
$$;

revoke all on function public.support_get_notice_priority_flags(uuid) from public, anon;
grant execute on function public.support_get_notice_priority_flags(uuid) to authenticated;

commit;
