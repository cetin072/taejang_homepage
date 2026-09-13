-- Issue #192: promotion leads must not archive content that has already entered
-- an upper approval line. Operations/CEO review history is authoritative even
-- when the content is handed back to the promotion lead for correction.
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
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_is_promotion_lead() then
    raise exception using errcode = '42501', message = 'PROMOTION_UNPUBLISHED_ARCHIVE_FORBIDDEN';
  end if;
  if reason is null then
    raise exception using errcode = '22023', message = 'PROMOTION_UNPUBLISHED_ARCHIVE_REASON_REQUIRED';
  end if;

  select * into content_row
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
  ) into has_upper_review_history;

  if has_upper_review_history then
    raise exception using errcode = '42501', message = 'PROMOTION_UNPUBLISHED_ARCHIVE_UPPER_REVIEW_LOCKED';
  end if;

  update public.promotion_contents
  set lifecycle = 'archived',
      updated_at = now()
  where id = content_row.id;

  update public.promotion_review_requests
  set decision = 'withdrawn',
      decided_by_profile_id = actor_id,
      decision_comment = left(reason, 1000),
      decided_at = now()
  where revision_id in (
      select id from public.promotion_content_revisions where content_id = content_row.id
    )
    and decision = 'pending';

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
      'upper_review_history', false
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PROMOTION_UNPUBLISHED_ARCHIVED',
    'recoverable_archive_preserved', true
  );
end;
$$;

alter function public.archive_unpublished_promotion_content(uuid, text) owner to postgres;
revoke all on function public.archive_unpublished_promotion_content(uuid, text) from public, anon, authenticated;
grant execute on function public.archive_unpublished_promotion_content(uuid, text) to authenticated;

comment on function public.archive_unpublished_promotion_content(uuid, text) is
  'Promotion lead recoverable archive for never-public content that has never entered operations/CEO review; upper-review history locks deletion to operations-manager handling.';

commit;
