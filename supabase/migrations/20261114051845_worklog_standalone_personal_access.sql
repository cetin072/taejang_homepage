create or replace function worklog_private.can_access_workspace(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from worklog.workspaces w
    join public.profiles p on p.id = auth.uid()
    where w.id = p_workspace_id
      and (
        (p.account_status = 'active' and (
          w.owner_user_id = p.id or exists (
            select 1 from worklog.workspace_members m
            where m.workspace_id = w.id and m.user_id = p.id
          )
        ))
        or (p.account_status = 'pending' and w.kind = 'personal'
          and w.owner_user_id = p.id
          and w.metadata @> '{"worklog_standalone_access":true}'::jsonb
          and exists (
            select 1 from worklog.workspace_members m
            where m.workspace_id = w.id and m.user_id = p.id and m.role = 'owner'
          )
        )
      )
  );
$$;

create or replace function worklog_private.is_workspace_owner(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from worklog.workspaces w
    where w.id = p_workspace_id and w.owner_user_id = auth.uid()
      and worklog_private.can_access_workspace(w.id)
  );
$$;

create or replace function worklog_private.ensure_current_user_personal_workspace()
returns table(workspace_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  return query
    select w.id
    from worklog.workspaces w
    join worklog.workspace_members m
      on m.workspace_id = w.id and m.user_id = auth.uid() and m.role = 'owner'
    where w.kind = 'personal' and w.owner_user_id = auth.uid()
      and worklog_private.is_workspace_owner(w.id);
  if not found then raise exception 'WORKLOG_ACCESS_NOT_PROVISIONED'; end if;
end;
$$;
