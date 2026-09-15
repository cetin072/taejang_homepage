-- Issue #207 follow-up
-- Fix PL/pgSQL ambiguity reported by `supabase db lint` in
-- review_public_content_change_request(). This is forward-only/additive and
-- preserves the existing authorization and workflow contract.

begin;

create or replace function public.review_public_content_change_request(
  p_request_id uuid,
  p_action text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  request_row public.public_content_change_requests%rowtype;
  content_row public.promotion_contents%rowtype;
  old_revision public.promotion_content_revisions%rowtype;
  new_revision public.promotion_content_revisions%rowtype;
  next_revision_no integer;
  next_status text;
  content_id uuid;
  applied boolean := false;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.private_actor_can('promotion.review_public_change')
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='PUBLIC_CONTENT_CHANGE_REVIEW_FORBIDDEN';
  end if;

  next_status := case p_action
    when 'approve' then 'approved'
    when 'changes_requested' then 'changes_requested'
    when 'reject' then 'rejected'
    else null
  end;
  if next_status is null then
    raise exception using errcode='22023', message='PUBLIC_CONTENT_CHANGE_ACTION_INVALID';
  end if;
  if next_status in ('changes_requested','rejected')
     and nullif(btrim(coalesce(p_comment,'')), '') is null then
    raise exception using errcode='22023', message='PUBLIC_CONTENT_CHANGE_COMMENT_REQUIRED';
  end if;

  select * into request_row
  from public.public_content_change_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception using errcode='P0002', message='PUBLIC_CONTENT_CHANGE_REQUEST_NOT_FOUND';
  end if;
  if request_row.status <> 'pending' then
    raise exception using errcode='55000', message='PUBLIC_CONTENT_CHANGE_REQUEST_ALREADY_DECIDED';
  end if;

  if next_status = 'approved' and request_row.target_kind = 'promotion' then
    content_id := request_row.target_key::uuid;

    select * into content_row
    from public.promotion_contents
    where id = content_id
    for update;
    if not found or content_row.lifecycle not in ('published','hidden') then
      raise exception using errcode='55000', message='PUBLIC_CONTENT_CHANGE_PROMOTION_UNAVAILABLE';
    end if;

    select * into old_revision
    from public.promotion_content_revisions
    where id = content_row.current_revision_id;
    if not found then
      raise exception using errcode='P0002', message='PROMOTION_REVISION_NOT_FOUND';
    end if;

    select coalesce(max(revision.revision_no), 0) + 1
    into next_revision_no
    from public.promotion_content_revisions revision
    where revision.content_id = content_row.id;

    insert into public.promotion_content_revisions(
      content_id, revision_no, author_profile_id, slug, title, summary, public_body,
      external_url, byline, byline_kind, related_organization, source_reference_url,
      hero_image_url, public_media, people_photo, number_or_amount,
      requested_publish_date, change_reason, submitted_at, locked_at
    ) values (
      content_row.id, next_revision_no, actor_id, old_revision.slug,
      coalesce(request_row.proposed_title, old_revision.title),
      coalesce(request_row.proposed_summary, old_revision.summary),
      coalesce(request_row.proposed_body, old_revision.public_body),
      old_revision.external_url, old_revision.byline, old_revision.byline_kind,
      old_revision.related_organization, old_revision.source_reference_url,
      old_revision.hero_image_url, old_revision.public_media, old_revision.people_photo,
      old_revision.number_or_amount, old_revision.requested_publish_date,
      '운영총괄 승인 수정: ' || left(request_row.reason, 700), now(), now()
    ) returning * into new_revision;

    update public.promotion_contents
    set current_revision_id = new_revision.id,
        updated_at = now()
    where id = content_row.id;

    applied := true;
  end if;

  update public.public_content_change_requests
  set status = next_status,
      decided_by_profile_id = actor_id,
      decision_comment = nullif(btrim(coalesce(p_comment,'')), ''),
      decided_at = now(),
      applied_at = case
        when next_status='approved' and request_row.target_kind='promotion' then now()
        else null
      end,
      requires_code_apply = next_status='approved' and request_row.target_kind='archive',
      updated_at = now()
  where id = request_row.id
  returning * into request_row;

  perform public.private_append_audit(
    actor_id,
    'public_content_change_reviewed',
    'public_content_change_request',
    request_row.id::text,
    'success',
    coalesce(left(request_row.decision_comment,300), '운영총괄 공개 콘텐츠 수정 검토'),
    jsonb_build_object(
      'status', request_row.status,
      'target_kind', request_row.target_kind,
      'target_key', request_row.target_key,
      'applied', applied,
      'requires_code_apply', request_row.requires_code_apply
    )
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', request_row.id,
    'status', request_row.status,
    'applied', applied,
    'requires_code_apply', request_row.requires_code_apply
  );
end;
$function$;

commit;
