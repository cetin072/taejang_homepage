-- Issue #150: operations-only recovery feed for archived schedule/notice/guidance.
-- Normal manager lists continue excluding inactive records; this dedicated feed
-- is the explicit path back to recoverable archived records.
begin;

create or replace function public.get_archived_recovery_items(
  p_resource_type text,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('audit.target_history.read')
     or not ('operations_manager' = any(public.private_effective_role_codes())) then
    raise exception using errcode='42501', message='RECOVERY_ARCHIVE_READ_FORBIDDEN';
  end if;
  if p_limit not between 1 and 200 then
    raise exception using errcode='22023', message='INVALID_LIMIT';
  end if;
  if p_resource_type not in ('schedule_item','notice','staff_guidance') then
    raise exception using errcode='22023', message='INVALID_RECOVERY_RESOURCE_TYPE';
  end if;

  if p_resource_type = 'schedule_item' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'resource_type','schedule_item',
        'id', item.id,
        'title', item.title,
        'archived_at', item.archived_at,
        'archived_by', item.archived_by,
        'archived_by_name', actor.display_name,
        'archive_reason', item.archive_reason,
        'archive_previous_status', item.archive_previous_status,
        'updated_at', item.updated_at
      ) order by item.archived_at desc)
      from (
        select * from public.schedule_items
        where archived_at is not null
        order by archived_at desc
        limit p_limit
      ) item
      left join public.profiles actor on actor.id = item.archived_by
    ), '[]'::jsonb);
  elsif p_resource_type = 'notice' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'resource_type','notice',
        'id', item.id,
        'title', item.title,
        'archived_at', item.archived_at,
        'archived_by', item.archived_by,
        'archived_by_name', actor.display_name,
        'archive_reason', item.archive_reason,
        'archive_previous_status', item.archive_previous_status,
        'updated_at', item.updated_at
      ) order by item.archived_at desc)
      from (
        select * from public.notices
        where archived_at is not null
        order by archived_at desc
        limit p_limit
      ) item
      left join public.profiles actor on actor.id = item.archived_by
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'resource_type','staff_guidance',
      'id', item.id,
      'title', item.title,
      'archived_at', item.archived_at,
      'archived_by', item.archived_by,
      'archived_by_name', actor.display_name,
      'archive_reason', item.archive_reason,
      'archive_previous_status', item.archive_previous_status,
      'updated_at', item.updated_at
    ) order by item.archived_at desc)
    from (
      select * from public.staff_guidance_items
      where archived_at is not null
      order by archived_at desc
      limit p_limit
    ) item
    left join public.profiles actor on actor.id = item.archived_by
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_archived_recovery_items(text,integer) from public, anon;
grant execute on function public.get_archived_recovery_items(text,integer) to authenticated;

comment on function public.get_archived_recovery_items(text,integer) is
  'Operations-only list of recoverable archived schedule, notice and staff-guidance records.';

commit;
