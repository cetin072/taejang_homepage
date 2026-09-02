-- Phase C follow-up: expose safe editable/review/publication details through the
-- existing guarded workspace RPC. Staging first; no Production side effects.
begin;

create or replace function public.get_my_promotion_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  my_items jsonb := '[]'::jsonb;
  review_items jsonb := '[]'::jsonb;
  publication_items jsonb := '[]'::jsonb;
  workspace_role text;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'PROMOTION_WORKSPACE_FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'content_id', content.id,
    'revision_id', revision.id,
    'revision_no', revision.revision_no,
    'content_type', content.content_type::text,
    'lifecycle', content.lifecycle::text,
    'minimum_review_stage', content.minimum_review_stage::text,
    'slug', revision.slug,
    'title', revision.title,
    'summary', revision.summary,
    'public_body', revision.public_body,
    'external_url', revision.external_url,
    'byline', revision.byline,
    'byline_kind', revision.byline_kind::text,
    'related_organization', revision.related_organization,
    'source_reference_url', revision.source_reference_url,
    'hero_image_url', revision.hero_image_url,
    'public_media', revision.public_media,
    'people_photo', revision.people_photo::text,
    'number_or_amount', revision.number_or_amount::text,
    'requested_publish_date', revision.requested_publish_date,
    'change_reason', revision.change_reason,
    'submitted_at', revision.submitted_at,
    'updated_at', content.updated_at
  ) order by content.updated_at desc), '[]'::jsonb)
  into my_items
  from public.promotion_contents content
  join public.promotion_content_revisions revision on revision.id = content.current_revision_id
  where content.owner_profile_id = actor_id or content.assignee_profile_id = actor_id;

  if public.current_user_is_promotion_lead() then
    workspace_role := 'promotion_lead';
    select coalesce(jsonb_agg(jsonb_build_object(
      'content_id', content.id,
      'revision_id', revision.id,
      'revision_no', revision.revision_no,
      'title', revision.title,
      'summary', revision.summary,
      'public_body', revision.public_body,
      'byline', revision.byline,
      'byline_kind', revision.byline_kind::text,
      'related_organization', revision.related_organization,
      'hero_image_url', revision.hero_image_url,
      'public_media', revision.public_media,
      'people_photo', revision.people_photo::text,
      'number_or_amount', revision.number_or_amount::text,
      'requested_publish_date', revision.requested_publish_date,
      'stage', review.stage::text,
      'lifecycle', content.lifecycle::text,
      'required_stage', content.minimum_review_stage::text,
      'requested_at', review.created_at,
      'people_photo_check_required', revision.people_photo in ('yes', 'unsure')
    ) order by review.created_at), '[]'::jsonb)
    into review_items
    from public.promotion_review_requests review
    join public.promotion_content_revisions revision on revision.id = review.revision_id
    join public.promotion_contents content on content.id = revision.content_id
    where review.decision = 'pending' and review.stage = 'lead';

    select coalesce(jsonb_agg(jsonb_build_object(
      'content_id', content.id,
      'revision_id', revision.id,
      'title', revision.title,
      'summary', revision.summary,
      'slug', revision.slug,
      'hero_image_url', revision.hero_image_url,
      'public_media', revision.public_media,
      'requested_publish_date', revision.requested_publish_date,
      'lifecycle', content.lifecycle::text,
      'queue_status', queue.status::text,
      'scheduled_for', queue.scheduled_for
    ) order by content.updated_at desc), '[]'::jsonb)
    into publication_items
    from public.promotion_contents content
    join public.promotion_content_revisions revision on revision.id = content.current_revision_id
    left join public.promotion_publication_queue queue on queue.revision_id = revision.id
    where content.lifecycle in ('approved', 'scheduled')
      and public.promotion_revision_is_fully_approved(content.id, revision.id);
  elsif public.current_user_has_role('operations_manager') then
    workspace_role := 'operations_manager';
    select coalesce(jsonb_agg(jsonb_build_object(
      'content_id', content.id,
      'revision_id', revision.id,
      'revision_no', revision.revision_no,
      'title', revision.title,
      'summary', revision.summary,
      'public_body', revision.public_body,
      'byline', revision.byline,
      'byline_kind', revision.byline_kind::text,
      'related_organization', revision.related_organization,
      'hero_image_url', revision.hero_image_url,
      'public_media', revision.public_media,
      'people_photo', revision.people_photo::text,
      'number_or_amount', revision.number_or_amount::text,
      'requested_publish_date', revision.requested_publish_date,
      'stage', review.stage::text,
      'required_stage', content.minimum_review_stage::text,
      'requested_at', review.created_at
    ) order by review.created_at), '[]'::jsonb)
    into review_items
    from public.promotion_review_requests review
    join public.promotion_content_revisions revision on revision.id = review.revision_id
    join public.promotion_contents content on content.id = revision.content_id
    where review.decision = 'pending' and review.stage = 'operations';
  elsif public.current_user_has_role('ceo') then
    workspace_role := 'ceo';
    select coalesce(jsonb_agg(jsonb_build_object(
      'content_id', content.id,
      'revision_id', revision.id,
      'revision_no', revision.revision_no,
      'title', revision.title,
      'summary', revision.summary,
      'public_body', revision.public_body,
      'byline', revision.byline,
      'related_organization', revision.related_organization,
      'hero_image_url', revision.hero_image_url,
      'public_media', revision.public_media,
      'requested_publish_date', revision.requested_publish_date,
      'stage', review.stage::text,
      'requested_at', review.created_at
    ) order by review.created_at), '[]'::jsonb)
    into review_items
    from public.promotion_review_requests review
    join public.promotion_content_revisions revision on revision.id = review.revision_id
    join public.promotion_contents content on content.id = revision.content_id
    where review.decision = 'pending' and review.stage = 'ceo';
  elsif public.current_user_is_promotion_member() and public.current_user_has_role('promotion_staff') then
    workspace_role := 'promotion_staff';
  else
    raise exception using errcode = '42501', message = 'PROMOTION_WORKSPACE_FORBIDDEN';
  end if;

  return jsonb_build_object(
    'role', workspace_role,
    'my_items', my_items,
    'review_items', review_items,
    'publication_items', publication_items
  );
end;
$$;

alter function public.get_my_promotion_workspace() owner to postgres;
revoke all on function public.get_my_promotion_workspace() from public, anon, authenticated;
grant execute on function public.get_my_promotion_workspace() to authenticated;

-- These two helpers are only called from SECURITY DEFINER functions. Removing
-- direct client EXECUTE reduces the advisor surface without changing RLS meaning.
revoke execute on function public.current_user_is_promotion_member() from authenticated;
revoke execute on function public.current_user_is_promotion_lead() from authenticated;

comment on function public.get_my_promotion_workspace() is
  'Guarded Phase C workspace RPC for promotion staff, lead, operations manager, and CEO.';
comment on function public.current_user_is_promotion_member() is
  'Internal Phase C authorization helper. Not a client RPC.';
comment on function public.current_user_is_promotion_lead() is
  'Internal Phase C authorization helper. Not a client RPC.';

commit;
