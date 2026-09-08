-- UI support contracts for Issue #146.
begin;

-- Keep the already-shipped #147 UI access-level name while preserving the
-- corrected server behavior implemented in the preceding migration.
alter function public.get_employee_management_context()
  rename to private_issue146_employee_management_context;

revoke all on function public.private_issue146_employee_management_context()
  from public, anon, authenticated;

create or replace function public.get_employee_management_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  result := public.private_issue146_employee_management_context();
  if result ->> 'access_level' = 'promotion_lead_global_create' then
    result := jsonb_set(result, '{access_level}', to_jsonb('promotion_lead_global'::text), false);
  end if;
  return result;
end;
$$;

revoke all on function public.get_employee_management_context() from public, anon;
grant execute on function public.get_employee_management_context() to authenticated;

-- A dedicated archive-candidate feed avoids title matching or DOM scraping in
-- the browser. Promotion lead may archive any content that has never been public;
-- operations manager has the same lower-role capability by superset rule.
create or replace function public.get_unpublished_promotion_archive_candidates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_profile_is_active()
     or not (
       public.current_user_has_role('promotion_lead')
       or public.current_user_has_role('operations_manager')
     ) then
    raise exception using errcode = '42501', message = 'PROMOTION_UNPUBLISHED_ARCHIVE_READ_FORBIDDEN';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'content_id', content.id,
      'title', revision.title,
      'content_type', content.content_type::text,
      'lifecycle', content.lifecycle::text,
      'requested_publish_date', revision.requested_publish_date,
      'owner_profile_id', content.owner_profile_id,
      'owner_name', owner_profile.display_name,
      'assignee_profile_id', content.assignee_profile_id,
      'assignee_name', assignee_profile.display_name,
      'current_revision_id', content.current_revision_id,
      'updated_at', content.updated_at
    ) order by content.updated_at desc)
    from public.promotion_contents content
    join public.promotion_content_revisions revision on revision.id = content.current_revision_id
    join public.profiles owner_profile on owner_profile.id = content.owner_profile_id
    left join public.profiles assignee_profile on assignee_profile.id = content.assignee_profile_id
    where content.published_at is null
      and content.lifecycle <> 'archived'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_unpublished_promotion_archive_candidates() from public, anon;
grant execute on function public.get_unpublished_promotion_archive_candidates() to authenticated;

commit;
