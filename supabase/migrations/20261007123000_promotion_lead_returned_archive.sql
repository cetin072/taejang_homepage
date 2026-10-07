-- Promotion lead may recoverably archive only a promotion returned by
-- operations with an explicit changes_requested handoff. Other upper-review
-- history remains locked to operations-manager handling.
begin;

create or replace function public.archive_unpublished_promotion_content(
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
  reason text := nullif(btrim(p_reason), '');
  has_upper_review_history boolean := false;
  has_ceo_review_history boolean := false;
  returned_from_operations boolean := false;
  pending_reviews jsonb := '[]'::jsonb;
  queued_publications jsonb := '[]'::jsonb;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_is_promotion_lead() then
    raise exception using errcode = '42501', message = 'PROMOTION_UNPUBLISHED_ARCHIVE_FORBIDDEN';
  end if;
  if reason is null then
    raise exception using errcode = '22023', message = 'PROMOTION_UNPUBLISHED_ARCHIVE_REASON_REQUIRED';
  end if;

  select *
  into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;

  if content_row.published_at is not null
     or content_row.lifecycle in ('published', 'hidden', 'archived') then
    raise exception using errcode = '22023', message = 'PROMOTION_UNPUBLISHED_ARCHIVE_REQUIRES_NO_PUBLIC_HISTORY';
  end if;

  select exists (
    select 1
    from public.promotion_content_revisions revision
    join public.promotion_review_requests review
      on review.revision_id = revision.id
    where revision.content_id = content_row.id
      and review.stage in ('operations', 'ceo')
  )
  into has_upper_review_history;

  select exists (
    select 1
    from public.promotion_content_revisions revision
    join public.promotion_review_requests review
      on review.revision_id = revision.id
    where revision.content_id = content_row.id
      and review.stage = 'ceo'
  )
  into has_ceo_review_history;

  -- Narrow exception: the current revision was explicitly returned by
  -- operations and is waiting in the lead handoff lane. A pending operations
  -- or CEO review is never deletable by the promotion lead.
  select exists (
    select 1
    from public.promotion_review_requests operations_review
    where operations_review.id = (
      select latest_operations.id
      from public.promotion_review_requests latest_operations
      where latest_operations.revision_id = content_row.current_revision_id
        and latest_operations.stage = 'operations'
      order by latest_operations.created_at desc, latest_operations.id desc
      limit 1
    )
      and operations_review.decision = 'changes_requested'
      and exists (
        select 1
        from public.promotion_review_requests lead_review
        where lead_review.revision_id = content_row.current_revision_id
          and lead_review.stage = 'lead'
          and lead_review.decision = 'pending'
          and lead_review.created_at >= coalesce(operations_review.decided_at, operations_review.created_at)
      )
      and not exists (
        select 1
        from public.promotion_review_requests upper_pending
        where upper_pending.revision_id = content_row.current_revision_id
          and upper_pending.stage in ('operations', 'ceo')
          and upper_pending.decision = 'pending'
      )
  )
  into returned_from_operations;

  if has_upper_review_history
     and not (
       returned_from_operations
       and content_row.lifecycle = 'review_pending'
       and not has_ceo_review_history
     ) then
    raise exception using errcode = '42501', message = 'PROMOTION_UNPUBLISHED_ARCHIVE_UPPER_REVIEW_LOCKED';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'revision_id', review.revision_id,
    'stage', review.stage::text,
    'requested_by_profile_id', review.requested_by_profile_id
  ) order by review.created_at), '[]'::jsonb)
  into pending_reviews
  from public.promotion_review_requests review
  where review.revision_id in (
    select revision.id
    from public.promotion_content_revisions revision
    where revision.content_id = content_row.id
  )
    and review.decision = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object(
    'revision_id', queue.revision_id,
    'scheduled_for', queue.scheduled_for,
    'queued_by_profile_id', queue.queued_by_profile_id
  ) order by queue.created_at), '[]'::jsonb)
  into queued_publications
  from public.promotion_publication_queue queue
  where queue.revision_id in (
    select revision.id
    from public.promotion_content_revisions revision
    where revision.content_id = content_row.id
  )
    and queue.status = 'queued';

  update public.promotion_contents
  set lifecycle = 'archived',
      archive_snapshot = jsonb_build_object(
        'previous_lifecycle', content_row.lifecycle::text,
        'published_at', content_row.published_at,
        'current_revision_id', content_row.current_revision_id,
        'pending_reviews', pending_reviews,
        'queued_publications', queued_publications,
        'archive_kind', case
          when returned_from_operations then 'returned_from_operations'
          else 'unpublished'
        end
      ),
      updated_at = now()
  where id = content_row.id;

  update public.promotion_review_requests
  set decision = 'withdrawn',
      decided_by_profile_id = actor_id,
      decision_comment = left(reason, 1000),
      decided_at = now()
  where revision_id in (
    select id
    from public.promotion_content_revisions
    where content_id = content_row.id
  )
    and decision = 'pending';

  update public.promotion_publication_queue
  set status = 'cancelled',
      updated_at = now()
  where revision_id in (
    select id
    from public.promotion_content_revisions
    where content_id = content_row.id
  )
    and status = 'queued';

  perform public.private_append_audit(
    actor_id,
    'promotion_unpublished_archived',
    'promotion_content',
    content_row.id::text,
    'success',
    left(reason, 300),
    jsonb_build_object(
      'recoverable', true,
      'previous_lifecycle', content_row.lifecycle::text,
      'upper_review_history', has_upper_review_history,
      'returned_from_operations', returned_from_operations,
      'archive_kind', case
        when returned_from_operations then 'returned_from_operations'
        else 'unpublished'
      end
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PROMOTION_UNPUBLISHED_ARCHIVED',
    'recoverable_archive_preserved', true,
    'returned_from_operations', returned_from_operations
  );
end;
$$;

alter function public.archive_unpublished_promotion_content(uuid, text) owner to postgres;
revoke all on function public.archive_unpublished_promotion_content(uuid, text) from public, anon, authenticated;
grant execute on function public.archive_unpublished_promotion_content(uuid, text) to authenticated;

comment on function public.archive_unpublished_promotion_content(uuid, text) is
  'Promotion lead recoverable archive. Upper review remains locked except the current operations changes_requested handoff returned to the lead; CEO history is never deletable by lead.';

commit;
