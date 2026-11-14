-- The existing standalone Worklog policy also applies to its personal calendar.
-- Company schedules and notices still require an active ERP profile.
create or replace function private.calendar_actor()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null
    or exists (
      select 1 from public.role_simulation_modes
      where profile_id = v_actor and expires_at > now()
    )
    or (
      not public.current_profile_is_active()
      and not exists (
        select 1 from worklog.workspaces w
        where w.kind = 'personal' and w.owner_user_id = v_actor
          and worklog_private.is_workspace_owner(w.id)
      )
    )
  then
    raise exception using errcode = '42501', message = 'CALENDAR_FORBIDDEN';
  end if;
  return v_actor;
end $$;
