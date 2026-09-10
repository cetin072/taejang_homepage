-- Follow-up for Issue #146: make promotion restore variable/column binding explicit.
-- This safely replaces the previous function definition before application use.
begin;

create or replace function public.restore_promotion_content(
  p_content_id uuid,
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
  snapshot jsonb;
  previous_lifecycle text;
  reason text := nullif(btrim(p_reason), '');
  item jsonb;
  restore_revision_id uuid;
  restore_review_stage public.promotion_review_stage;
  restore_requested_by uuid;
  restore_scheduled_for timestamptz;
  restore_queued_by uuid;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'PROMOTION_RESTORE_FORBIDDEN';
  end if;
  if reason is null then
    raise exception using errcode = '22023', message = 'PROMOTION_RESTORE_REASON_REQUIRED';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;
  if content_row.lifecycle <> 'archived' then
    return jsonb_build_object('ok', true, 'code', 'PROMOTION_CONTENT_NOT_ARCHIVED');
  end if;

  snapshot := coalesce(content_row.archive_snapshot, '{}'::jsonb);
  previous_lifecycle := nullif(snapshot ->> 'previous_lifecycle', '');
  if previous_lifecycle is null or previous_lifecycle = 'archived' then
    raise exception using errcode = '55000', message = 'PROMOTION_RESTORE_SNAPSHOT_INVALID';
  end if;

  -- Restore the content identity first. Revision rows themselves are append-only
  -- and were never removed by archive.
  update public.promotion_contents
  set lifecycle = previous_lifecycle::public.promotion_lifecycle,
      published_at = nullif(snapshot ->> 'published_at', '')::timestamptz,
      archive_snapshot = '{}'::jsonb,
      updated_at = now()
  where id = content_row.id;

  -- Recreate only review work that was pending at archive time.
  for item in
    select value
    from jsonb_array_elements(coalesce(snapshot -> 'pending_reviews', '[]'::jsonb))
  loop
    restore_revision_id := nullif(item ->> 'revision_id', '')::uuid;
    restore_review_stage := nullif(item ->> 'stage', '')::public.promotion_review_stage;
    restore_requested_by := nullif(item ->> 'requested_by_profile_id', '')::uuid;

    if restore_revision_id is not null
       and restore_review_stage is not null
       and restore_requested_by is not null
       and exists (
         select 1
         from public.promotion_content_revisions revision
         where revision.id = restore_revision_id
           and revision.content_id = content_row.id
       )
       and not exists (
         select 1
         from public.promotion_review_requests review
         where review.revision_id = restore_revision_id
           and review.stage = restore_review_stage
           and review.decision = 'pending'
       ) then
      insert into public.promotion_review_requests(
        revision_id,
        stage,
        requested_by_profile_id
      ) values (
        restore_revision_id,
        restore_review_stage,
        restore_requested_by
      );
    end if;
  end loop;

  -- Re-queue only the publication work that was queued at archive time.
  for item in
    select value
    from jsonb_array_elements(coalesce(snapshot -> 'queued_publications', '[]'::jsonb))
  loop
    restore_revision_id := nullif(item ->> 'revision_id', '')::uuid;
    restore_scheduled_for := nullif(item ->> 'scheduled_for', '')::timestamptz;
    restore_queued_by := nullif(item ->> 'queued_by_profile_id', '')::uuid;

    if restore_revision_id is not null
       and restore_queued_by is not null
       and exists (
         select 1
         from public.promotion_content_revisions revision
         where revision.id = restore_revision_id
           and revision.content_id = content_row.id
       ) then
      update public.promotion_publication_queue queue
      set status = 'queued',
          scheduled_for = restore_scheduled_for,
          updated_at = now()
      where queue.revision_id = restore_revision_id;

      if not found then
        insert into public.promotion_publication_queue(
          revision_id,
          queued_by_profile_id,
          scheduled_for,
          status
        ) values (
          restore_revision_id,
          restore_queued_by,
          restore_scheduled_for,
          'queued'
        );
      end if;
    end if;
  end loop;

  perform public.private_append_audit(
    actor_id,
    'promotion_content_restored',
    'promotion_content',
    content_row.id::text,
    'success',
    left(reason, 300),
    jsonb_build_object(
      'restored_lifecycle', previous_lifecycle,
      'revision_id', content_row.current_revision_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PROMOTION_CONTENT_RESTORED',
    'lifecycle', previous_lifecycle
  );
end;
$$;

revoke all on function public.restore_promotion_content(uuid, text) from public, anon;
grant execute on function public.restore_promotion_content(uuid, text) to authenticated;

commit;
