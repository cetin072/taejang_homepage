-- Phase C pilot UX follow-up.
-- Adds safe review-detail reads, employee withdrawal, lead direct-edit revisions,
-- and employee-visible feedback without weakening submitted-revision immutability.
begin;

create or replace function public.withdraw_promotion_submission(p_content_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  old_revision public.promotion_content_revisions%rowtype;
  new_revision public.promotion_content_revisions%rowtype;
  pending_review public.promotion_review_requests%rowtype;
  next_revision_no integer;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.current_user_is_promotion_member()
     or not (public.current_user_has_role('promotion_staff') or public.current_user_has_role('promotion_lead')) then
    raise exception using errcode = '42501', message = 'PROMOTION_WITHDRAW_FORBIDDEN';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND'; end if;
  if actor_id <> content_row.owner_profile_id and actor_id <> content_row.assignee_profile_id then
    raise exception using errcode = '42501', message = 'PROMOTION_WITHDRAW_NOT_ASSIGNED';
  end if;
  if content_row.lifecycle <> 'review_pending' then
    raise exception using errcode = '55000', message = 'PROMOTION_WITHDRAW_NOT_PENDING';
  end if;

  select * into old_revision
  from public.promotion_content_revisions
  where id = content_row.current_revision_id;
  if not found or old_revision.locked_at is null then
    raise exception using errcode = '55000', message = 'PROMOTION_WITHDRAW_REVISION_INVALID';
  end if;

  select * into pending_review
  from public.promotion_review_requests
  where revision_id = old_revision.id
    and stage = 'lead'
    and decision = 'pending'
  order by created_at desc
  limit 1
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'PROMOTION_WITHDRAW_ALREADY_REVIEWED';
  end if;

  update public.promotion_review_requests
  set decision = 'withdrawn',
      decided_by_profile_id = actor_id,
      decision_comment = '작성자가 승인 요청을 취소하고 수정본 작성을 시작함',
      decided_at = now()
  where id = pending_review.id;

  select coalesce(max(revision_no), 0) + 1
  into next_revision_no
  from public.promotion_content_revisions
  where content_id = content_row.id;

  insert into public.promotion_content_revisions (
    content_id, revision_no, author_profile_id, slug, title, summary, public_body,
    external_url, byline, byline_kind, related_organization, source_reference_url,
    hero_image_url, public_media, people_photo, number_or_amount,
    requested_publish_date, change_reason
  ) values (
    content_row.id, next_revision_no, actor_id, old_revision.slug, old_revision.title,
    old_revision.summary, old_revision.public_body, old_revision.external_url,
    old_revision.byline, old_revision.byline_kind, old_revision.related_organization,
    old_revision.source_reference_url, old_revision.hero_image_url, old_revision.public_media,
    old_revision.people_photo, old_revision.number_or_amount, old_revision.requested_publish_date,
    '승인 요청 취소 후 수정'
  ) returning * into new_revision;

  update public.promotion_contents
  set current_revision_id = new_revision.id,
      lifecycle = 'draft'
  where id = content_row.id;

  perform public.private_append_audit(
    actor_id, 'promotion_submission_withdrawn', 'promotion_content', content_row.id::text,
    'success', '홍보 승인 요청 취소',
    jsonb_build_object('from_revision_id', old_revision.id, 'to_revision_id', new_revision.id)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PROMOTION_SUBMISSION_WITHDRAWN',
    'content_id', content_row.id,
    'revision_id', new_revision.id
  );
end;
$$;

create or replace function public.lead_replace_promotion_revision(
  p_content_id uuid,
  p_title text,
  p_public_body text default null,
  p_external_url text default null,
  p_requested_publish_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  old_revision public.promotion_content_revisions%rowtype;
  new_revision public.promotion_content_revisions%rowtype;
  pending_review public.promotion_review_requests%rowtype;
  next_revision_no integer;
  next_summary text;
  required_stage public.promotion_review_stage;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.current_user_is_promotion_lead() then
    raise exception using errcode = '42501', message = 'PROMOTION_LEAD_EDIT_FORBIDDEN';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception using errcode = '22023', message = 'PROMOTION_TITLE_REQUIRED';
  end if;
  perform public.promotion_validate_url(nullif(btrim(coalesce(p_external_url, '')), ''), 'external_url');

  select * into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND'; end if;
  if content_row.lifecycle <> 'review_pending' then
    raise exception using errcode = '55000', message = 'PROMOTION_LEAD_EDIT_NOT_PENDING';
  end if;

  select * into old_revision
  from public.promotion_content_revisions
  where id = content_row.current_revision_id;
  if not found or old_revision.locked_at is null then
    raise exception using errcode = '55000', message = 'PROMOTION_LEAD_EDIT_REVISION_INVALID';
  end if;

  select * into pending_review
  from public.promotion_review_requests
  where revision_id = old_revision.id
    and stage = 'lead'
    and decision = 'pending'
  order by created_at desc
  limit 1
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'PROMOTION_LEAD_EDIT_STAGE_INVALID';
  end if;

  update public.promotion_review_requests
  set decision = 'withdrawn',
      decided_by_profile_id = actor_id,
      decision_comment = '홍보팀장 직접 수정으로 새 수정본 생성',
      decided_at = now()
  where id = pending_review.id;

  select coalesce(max(revision_no), 0) + 1
  into next_revision_no
  from public.promotion_content_revisions
  where content_id = content_row.id;

  next_summary := nullif(left(regexp_replace(btrim(coalesce(p_public_body, '')), '\s+', ' ', 'g'), 220), '');

  insert into public.promotion_content_revisions (
    content_id, revision_no, author_profile_id, slug, title, summary, public_body,
    external_url, byline, byline_kind, related_organization, source_reference_url,
    hero_image_url, public_media, people_photo, number_or_amount,
    requested_publish_date, change_reason, submitted_at, locked_at
  ) values (
    content_row.id, next_revision_no, actor_id, old_revision.slug, btrim(p_title), next_summary,
    nullif(btrim(coalesce(p_public_body, '')), ''),
    nullif(btrim(coalesce(p_external_url, '')), ''),
    old_revision.byline, old_revision.byline_kind, old_revision.related_organization,
    old_revision.source_reference_url, old_revision.hero_image_url, old_revision.public_media,
    old_revision.people_photo, old_revision.number_or_amount, p_requested_publish_date,
    '홍보팀장 직접 수정', now(), now()
  ) returning * into new_revision;

  required_stage := public.promotion_required_stage(
    content_row.content_type,
    new_revision.byline_kind,
    new_revision.number_or_amount
  );

  update public.promotion_contents
  set current_revision_id = new_revision.id,
      minimum_review_stage = greatest(content_row.minimum_review_stage, required_stage),
      lifecycle = 'review_pending'
  where id = content_row.id;

  insert into public.promotion_review_requests (revision_id, stage, requested_by_profile_id)
  values (new_revision.id, 'lead', actor_id);

  perform public.private_append_audit(
    actor_id, 'promotion_lead_revision_replaced', 'promotion_content', content_row.id::text,
    'success', '홍보팀장 직접 수정본 생성',
    jsonb_build_object('from_revision_id', old_revision.id, 'to_revision_id', new_revision.id)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PROMOTION_LEAD_REVISION_REPLACED',
    'content_id', content_row.id,
    'revision_id', new_revision.id,
    'required_stage', greatest(content_row.minimum_review_stage, required_stage)::text
  );
end;
$$;

create or replace function public.get_promotion_review_detail(p_content_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  revision_row public.promotion_content_revisions%rowtype;
  pending_review public.promotion_review_requests%rowtype;
  previous_comment text;
  previous_decided_at timestamptz;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'PROMOTION_REVIEW_DETAIL_FORBIDDEN';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id;
  if not found then raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND'; end if;

  select * into revision_row
  from public.promotion_content_revisions
  where id = content_row.current_revision_id;
  if not found then raise exception using errcode = 'P0002', message = 'PROMOTION_REVISION_NOT_FOUND'; end if;

  select * into pending_review
  from public.promotion_review_requests
  where revision_id = revision_row.id
    and decision = 'pending'
  order by created_at
  limit 1;
  if not found then raise exception using errcode = '55000', message = 'PROMOTION_REVIEW_NOT_PENDING'; end if;

  if (pending_review.stage = 'lead' and not public.current_user_is_promotion_lead())
     or (pending_review.stage = 'operations' and not public.current_user_has_role('operations_manager'))
     or (pending_review.stage = 'ceo' and not public.current_user_has_role('ceo')) then
    raise exception using errcode = '42501', message = 'PROMOTION_REVIEW_DETAIL_FORBIDDEN';
  end if;

  if pending_review.stage = 'operations' then
    select decision_comment, decided_at
    into previous_comment, previous_decided_at
    from public.promotion_review_requests
    where revision_id = revision_row.id
      and stage = 'lead'
      and decision = 'approved'
    order by decided_at desc nulls last
    limit 1;
  elsif pending_review.stage = 'ceo' then
    select decision_comment, decided_at
    into previous_comment, previous_decided_at
    from public.promotion_review_requests
    where revision_id = revision_row.id
      and stage = 'operations'
      and decision = 'approved'
    order by decided_at desc nulls last
    limit 1;
  end if;

  return jsonb_build_object(
    'content_id', content_row.id,
    'revision_id', revision_row.id,
    'revision_no', revision_row.revision_no,
    'content_type', content_row.content_type::text,
    'minimum_review_stage', content_row.minimum_review_stage::text,
    'stage', pending_review.stage::text,
    'title', revision_row.title,
    'summary', revision_row.summary,
    'public_body', revision_row.public_body,
    'external_url', revision_row.external_url,
    'byline', revision_row.byline,
    'byline_kind', revision_row.byline_kind::text,
    'related_organization', revision_row.related_organization,
    'hero_image_url', revision_row.hero_image_url,
    'public_media', revision_row.public_media,
    'people_photo', revision_row.people_photo::text,
    'number_or_amount', revision_row.number_or_amount::text,
    'requested_publish_date', revision_row.requested_publish_date,
    'previous_stage_comment', previous_comment,
    'previous_stage_decided_at', previous_decided_at
  );
end;
$$;

create or replace function public.get_my_promotion_feedback(p_content_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  feedback public.promotion_review_requests%rowtype;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'PROMOTION_FEEDBACK_FORBIDDEN';
  end if;
  select * into content_row
  from public.promotion_contents
  where id = p_content_id;
  if not found then raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND'; end if;
  if actor_id <> content_row.owner_profile_id and actor_id <> content_row.assignee_profile_id then
    raise exception using errcode = '42501', message = 'PROMOTION_FEEDBACK_FORBIDDEN';
  end if;

  select review.* into feedback
  from public.promotion_review_requests review
  where review.revision_id = content_row.current_revision_id
    and review.decision in ('changes_requested', 'rejected')
  order by review.decided_at desc nulls last
  limit 1;

  if not found then return null; end if;
  return jsonb_build_object(
    'stage', feedback.stage::text,
    'decision', feedback.decision::text,
    'comment', feedback.decision_comment,
    'decided_at', feedback.decided_at
  );
end;
$$;

alter function public.withdraw_promotion_submission(uuid) owner to postgres;
alter function public.lead_replace_promotion_revision(uuid, text, text, text, date) owner to postgres;
alter function public.get_promotion_review_detail(uuid) owner to postgres;
alter function public.get_my_promotion_feedback(uuid) owner to postgres;

revoke all on function public.withdraw_promotion_submission(uuid) from public, anon, authenticated;
revoke all on function public.lead_replace_promotion_revision(uuid, text, text, text, date) from public, anon, authenticated;
revoke all on function public.get_promotion_review_detail(uuid) from public, anon, authenticated;
revoke all on function public.get_my_promotion_feedback(uuid) from public, anon, authenticated;

grant execute on function public.withdraw_promotion_submission(uuid) to authenticated;
grant execute on function public.lead_replace_promotion_revision(uuid, text, text, text, date) to authenticated;
grant execute on function public.get_promotion_review_detail(uuid) to authenticated;
grant execute on function public.get_my_promotion_feedback(uuid) to authenticated;

comment on function public.withdraw_promotion_submission(uuid) is
  'Staff/assigned author may withdraw only an untouched lead-pending submission; immutable submitted revision stays in history.';
comment on function public.lead_replace_promotion_revision(uuid, text, text, text, date) is
  'Promotion lead direct edit creates a new locked revision and a fresh lead review request; it never overwrites submitted revision data.';
comment on function public.get_promotion_review_detail(uuid) is
  'Returns current review detail only to the role that owns the active review stage, including prior-stage escalation comment.';
comment on function public.get_my_promotion_feedback(uuid) is
  'Returns latest change/rejection feedback only to the content owner or assignee.';

commit;
