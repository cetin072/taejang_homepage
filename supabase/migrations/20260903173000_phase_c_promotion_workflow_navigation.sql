-- Phase C workflow refinement: route operations change requests through the promotion lead,
-- expose a guarded publication overview to lead/operations, and expose handoff context.
-- Staging/preview first. This migration does not publish the public site.

begin;

create or replace function public.request_promotion_changes_via_lead(
  p_content_id uuid,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  pending_review public.promotion_review_requests%rowtype;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'PROMOTION_OPERATIONS_HANDOFF_FORBIDDEN';
  end if;
  if p_comment is null or btrim(p_comment) = '' then
    raise exception using errcode = '22023', message = 'PROMOTION_CHANGE_COMMENT_REQUIRED';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;

  select review.* into pending_review
  from public.promotion_review_requests review
  where review.revision_id = content_row.current_revision_id
    and review.stage = 'operations'
    and review.decision = 'pending'
  order by review.created_at desc
  limit 1
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'PROMOTION_OPERATIONS_REVIEW_NOT_PENDING';
  end if;

  update public.promotion_review_requests
  set decision = 'changes_requested',
      decided_by_profile_id = actor_id,
      decision_comment = left(btrim(p_comment), 2000),
      decided_at = now()
  where id = pending_review.id;

  insert into public.promotion_review_requests (
    revision_id,
    stage,
    requested_by_profile_id
  ) values (
    content_row.current_revision_id,
    'lead',
    actor_id
  );

  -- The employee does not receive the request directly. The lead owns the handoff first.
  update public.promotion_contents
  set lifecycle = 'review_pending'
  where id = content_row.id;

  perform public.private_append_audit(
    actor_id,
    'promotion_operations_changes_handed_to_lead',
    'promotion_revision',
    content_row.current_revision_id::text,
    'success',
    '운영총괄 보완 요청을 홍보팀장 검토로 전달',
    jsonb_build_object('content_id', content_row.id)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PROMOTION_OPERATIONS_CHANGES_HANDED_TO_LEAD',
    'content_id', content_row.id,
    'revision_id', content_row.current_revision_id
  );
end;
$$;

create or replace function public.get_promotion_review_handoff(p_content_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  pending_lead public.promotion_review_requests%rowtype;
  operations_feedback public.promotion_review_requests%rowtype;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_is_promotion_lead() then
    raise exception using errcode = '42501', message = 'PROMOTION_HANDOFF_READ_FORBIDDEN';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;

  select review.* into pending_lead
  from public.promotion_review_requests review
  where review.revision_id = content_row.current_revision_id
    and review.stage = 'lead'
    and review.decision = 'pending'
  order by review.created_at desc
  limit 1;
  if not found then return null; end if;

  select review.* into operations_feedback
  from public.promotion_review_requests review
  where review.revision_id = content_row.current_revision_id
    and review.stage = 'operations'
    and review.decision = 'changes_requested'
    and review.decided_at <= pending_lead.created_at
  order by review.decided_at desc nulls last
  limit 1;
  if not found then return null; end if;

  return jsonb_build_object(
    'source', 'operations_changes_requested',
    'comment', operations_feedback.decision_comment,
    'decided_at', operations_feedback.decided_at
  );
end;
$$;

create or replace function public.get_promotion_publication_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  result jsonb;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not (
       public.current_user_is_promotion_lead()
       or public.current_user_has_role('operations_manager')
     ) then
    raise exception using errcode = '42501', message = 'PROMOTION_PUBLICATION_OVERVIEW_FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(item order by sort_key desc), '[]'::jsonb)
  into result
  from (
    select
      jsonb_build_object(
        'content_id', content.id,
        'revision_id', revision.id,
        'title', revision.title,
        'summary', revision.summary,
        'content_type', content.content_type::text,
        'requested_publish_date', revision.requested_publish_date,
        'hero_image_url', revision.hero_image_url,
        'lifecycle', content.lifecycle::text,
        'queue_status', queue.status::text,
        'scheduled_for', queue.scheduled_for,
        'queued_at', queue.created_at
      ) as item,
      greatest(content.updated_at, coalesce(queue.updated_at, content.updated_at)) as sort_key
    from public.promotion_contents content
    join public.promotion_content_revisions revision
      on revision.id = content.current_revision_id
    left join public.promotion_publication_queue queue
      on queue.revision_id = revision.id
    where content.lifecycle in ('approved', 'scheduled')
      and public.promotion_revision_is_fully_approved(content.id, revision.id)
  ) rows;

  return result;
end;
$$;

alter function public.request_promotion_changes_via_lead(uuid, text) owner to postgres;
alter function public.get_promotion_review_handoff(uuid) owner to postgres;
alter function public.get_promotion_publication_overview() owner to postgres;

revoke all on function public.request_promotion_changes_via_lead(uuid, text) from public, anon, authenticated;
revoke all on function public.get_promotion_review_handoff(uuid) from public, anon, authenticated;
revoke all on function public.get_promotion_publication_overview() from public, anon, authenticated;

grant execute on function public.request_promotion_changes_via_lead(uuid, text) to authenticated;
grant execute on function public.get_promotion_review_handoff(uuid) to authenticated;
grant execute on function public.get_promotion_publication_overview() to authenticated;

comment on function public.request_promotion_changes_via_lead(uuid, text) is
  'Operations manager change requests return to the promotion lead first; the employee is not directly moved to needs_revision.';
comment on function public.get_promotion_review_handoff(uuid) is
  'Promotion lead-only context for an operations change request handed back to the lead.';
comment on function public.get_promotion_publication_overview() is
  'Promotion lead/operations read-only overview of fully approved content waiting for or already in the publication queue.';

commit;
