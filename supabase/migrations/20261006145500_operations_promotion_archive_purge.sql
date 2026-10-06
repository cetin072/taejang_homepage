-- Operations-manager promotion content cleanup authority.
-- Recoverable archive is available for any promotion lifecycle, including
-- approved/scheduled/published content. Permanent deletion is allowed only
-- after archive and preserves audit/deletion-request tombstones.
begin;

create or replace function public.archive_promotion_content(
  p_content_id uuid,
  p_confirm_title text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager')
     or not public.private_actor_can('promotion.archive') then
    raise exception using errcode = '42501', message = 'PROMOTION_ARCHIVE_FORBIDDEN';
  end if;

  -- Reuse the established recoverable archive implementation. It snapshots
  -- previous lifecycle/published_at/pending review/publication queue state.
  return public.private_delete_promotion_content_pre148(
    p_content_id,
    p_confirm_title,
    p_reason
  );
end;
$;


create or replace function public.private_promotion_media_delete_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $
  select (select auth.uid()) is not null
    and public.current_profile_is_active()
    and public.current_user_has_role('operations_manager')
    and public.private_actor_can('promotion.archive');
$;

create or replace function public.get_archived_promotion_media_paths(
  p_content_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  paths jsonb := '[]'::jsonb;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager')
     or not public.private_actor_can('promotion.archive') then
    raise exception using errcode = '42501', message = 'PROMOTION_MEDIA_CLEANUP_FORBIDDEN';
  end if;

  select *
  into content_row
  from public.promotion_contents
  where id = p_content_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;

  if content_row.lifecycle <> 'archived'::public.promotion_lifecycle then
    raise exception using errcode = '42501', message = 'PROMOTION_MEDIA_CLEANUP_REQUIRES_ARCHIVED';
  end if;

  with media_urls as (
    select distinct media_url
    from (
      select revision.hero_image_url as media_url
      from public.promotion_content_revisions revision
      where revision.content_id = content_row.id

      union all

      select media_item.value ->> 'url' as media_url
      from public.promotion_content_revisions revision
      cross join lateral jsonb_array_elements(coalesce(revision.public_media, '[]'::jsonb)) media_item
      where revision.content_id = content_row.id
    ) source
    where nullif(btrim(coalesce(media_url, '')), '') is not null
      and position('/storage/v1/object/public/promotion-media/' in media_url) > 0
  ),
  candidates as (
    select
      media_url,
      split_part(media_url, '/storage/v1/object/public/promotion-media/', 2) as storage_path
    from media_urls
  ),
  exclusive_paths as (
    select distinct candidate.storage_path
    from candidates candidate
    where nullif(candidate.storage_path, '') is not null
      and not exists (
        select 1
        from public.promotion_content_revisions other_revision
        where other_revision.content_id <> content_row.id
          and (
            other_revision.hero_image_url = candidate.media_url
            or exists (
              select 1
              from jsonb_array_elements(coalesce(other_revision.public_media, '[]'::jsonb)) other_media
              where other_media.value ->> 'url' = candidate.media_url
            )
          )
      )
      and not exists (
        select 1
        from public.homepage_change_requests request
        where request.proposed_image_url = candidate.media_url
      )
      and not exists (
        select 1
        from public.homepage_live_overrides override_row
        where override_row.image_url = candidate.media_url
      )
  )
  select coalesce(jsonb_agg(storage_path order by storage_path), '[]'::jsonb)
  into paths
  from exclusive_paths;

  return paths;
end;
$;

alter function public.private_promotion_media_delete_allowed() owner to postgres;
alter function public.get_archived_promotion_media_paths(uuid) owner to postgres;

revoke all on function public.private_promotion_media_delete_allowed() from public, anon;
revoke all on function public.get_archived_promotion_media_paths(uuid) from public, anon;
grant execute on function public.private_promotion_media_delete_allowed() to authenticated;
grant execute on function public.get_archived_promotion_media_paths(uuid) to authenticated;

drop policy if exists "promotion media operations delete" on storage.objects;
create policy "promotion media operations delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'promotion-media'
  and public.private_promotion_media_delete_allowed()
);

create or replace function public.permanently_delete_archived_promotion_content(
  p_content_id uuid,
  p_confirm_title text,
  p_confirmation text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  content_title text;
  normalized_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  revision_count integer := 0;
  published_at_value timestamptz;
  archive_kind text;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager')
     or not public.private_actor_can('promotion.archive') then
    raise exception using errcode = '42501', message = 'PROMOTION_PERMANENT_DELETE_FORBIDDEN';
  end if;

  if normalized_reason is null then
    raise exception using errcode = '22023', message = 'PROMOTION_PERMANENT_DELETE_REASON_REQUIRED';
  end if;

  if btrim(coalesce(p_confirmation, '')) <> '영구삭제' then
    raise exception using errcode = '22023', message = 'PROMOTION_PERMANENT_DELETE_CONFIRMATION_REQUIRED';
  end if;

  select *
  into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;

  if content_row.lifecycle <> 'archived'::public.promotion_lifecycle then
    raise exception using errcode = '42501', message = 'PROMOTION_PERMANENT_DELETE_REQUIRES_ARCHIVED';
  end if;

  select revision.title
  into content_title
  from public.promotion_content_revisions revision
  where revision.id = content_row.current_revision_id;

  if content_title is null
     or btrim(coalesce(p_confirm_title, '')) <> content_title then
    raise exception using errcode = '22023', message = 'PROMOTION_PERMANENT_DELETE_TITLE_CONFIRMATION_MISMATCH';
  end if;

  select count(*)::integer
  into revision_count
  from public.promotion_content_revisions revision
  where revision.content_id = content_row.id;

  published_at_value := content_row.published_at;
  archive_kind := content_row.archive_snapshot ->> 'archive_kind';

  perform public.private_append_audit(
    actor_id,
    'promotion_content_permanently_deleted',
    'promotion_content',
    content_row.id::text,
    'success',
    left(normalized_reason, 300),
    jsonb_build_object(
      'title', content_title,
      'revision_count', revision_count,
      'published_at', published_at_value,
      'archive_kind', archive_kind,
      'authority', 'operations_manager',
      'recoverable', false
    )
  );

  -- Break the deferrable current-revision pointer before deleting revision rows.
  update public.promotion_contents
  set current_revision_id = null,
      updated_at = now()
  where id = content_row.id;

  delete from public.promotion_publication_queue queue
  where queue.revision_id in (
    select revision.id
    from public.promotion_content_revisions revision
    where revision.content_id = content_row.id
  );

  delete from public.promotion_review_requests review
  where review.revision_id in (
    select revision.id
    from public.promotion_content_revisions revision
    where revision.content_id = content_row.id
  );

  delete from public.promotion_content_revisions revision
  where revision.content_id = content_row.id;

  -- promotion_deletion_requests.content_id uses ON DELETE SET NULL so those
  -- request/audit tombstones remain after the content identity is removed.
  delete from public.promotion_contents content
  where content.id = content_row.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'PROMOTION_CONTENT_PERMANENTLY_DELETED',
    'content_id', content_row.id,
    'revision_count', revision_count,
    'audit_preserved', true,
    'recoverable', false
  );
end;
$$;

alter function public.archive_promotion_content(uuid,text,text) owner to postgres;
alter function public.permanently_delete_archived_promotion_content(uuid,text,text,text) owner to postgres;

revoke all on function public.archive_promotion_content(uuid,text,text) from public, anon;
revoke all on function public.permanently_delete_archived_promotion_content(uuid,text,text,text) from public, anon;
grant execute on function public.archive_promotion_content(uuid,text,text) to authenticated;
grant execute on function public.permanently_delete_archived_promotion_content(uuid,text,text,text) to authenticated;

comment on function public.archive_promotion_content(uuid,text,text) is
  'Operations-manager recoverable archive for promotion content in any lifecycle, including approved and published content.';

comment on function public.get_archived_promotion_media_paths(uuid) is
  'Returns promotion-media object paths used exclusively by one archived promotion content item; shared homepage/promotion media are excluded.';

comment on function public.permanently_delete_archived_promotion_content(uuid,text,text,text) is
  'Operations-manager irreversible database deletion for already archived promotion content. Audit/deletion-request tombstones remain. Exclusive promotion-media objects are deleted by the authenticated operations UI before this RPC.';

commit;
