-- Promotion lead authoring flow:
-- 1) promotion_lead-authored homepage/public promotion content always goes to operations review;
-- 2) the author cannot review/approve their own revision;
-- 3) operations approval supplies the lead-stage approval record required by the existing
--    fully-approved/publication invariant, with operations as the decision maker;
-- 4) publication remains an explicit promotion_lead action after approval.
begin;

create or replace function public.submit_promotion_revision(p_content_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  revision_row public.promotion_content_revisions%rowtype;
  required_stage public.promotion_review_stage;
  effective_stage public.promotion_review_stage;
  is_promotion_lead boolean := public.current_user_has_role('promotion_lead');
begin
  if actor_id is null
     or not public.private_actor_can('promotion.edit_own') then
    raise exception using errcode = '42501', message = 'PROMOTION_SUBMIT_FORBIDDEN';
  end if;

  if not is_promotion_lead then
    return public.private_submit_promotion_revision_pre148(p_content_id);
  end if;

  select *
  into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;

  if actor_id <> content_row.owner_profile_id
     and actor_id <> content_row.assignee_profile_id then
    raise exception using errcode = '42501', message = 'PROMOTION_SUBMIT_NOT_ASSIGNED';
  end if;

  select *
  into revision_row
  from public.promotion_content_revisions
  where id = content_row.current_revision_id
  for update;

  if not found or revision_row.locked_at is not null then
    raise exception using errcode = '55000', message = 'PROMOTION_CURRENT_REVISION_NOT_DRAFT';
  end if;

  required_stage := public.promotion_required_stage(
    content_row.content_type,
    revision_row.byline_kind,
    revision_row.number_or_amount
  );

  -- A promotion lead never approves their own authored content.
  -- Operations review is the minimum approval boundary for this authoring lane.
  effective_stage := greatest(
    content_row.minimum_review_stage,
    required_stage,
    'operations'::public.promotion_review_stage
  );

  update public.promotion_content_revisions
  set submitted_at = now(),
      locked_at = now()
  where id = revision_row.id;

  update public.promotion_contents
  set minimum_review_stage = effective_stage,
      lifecycle = 'review_pending'
  where id = content_row.id;

  insert into public.promotion_review_requests (
    revision_id,
    stage,
    requested_by_profile_id
  )
  values (
    revision_row.id,
    'operations',
    actor_id
  );

  perform public.private_append_audit(
    actor_id,
    'promotion_revision_submitted',
    'promotion_revision',
    revision_row.id::text,
    'success',
    '운영팀장 작성 홍보 운영총괄 승인 요청',
    jsonb_build_object(
      'required_stage', effective_stage::text,
      'self_review_forbidden', true,
      'next_stage', 'operations',
      'lead_people_photo_check', revision_row.people_photo in ('yes', 'unsure')
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PROMOTION_SUBMITTED',
    'revision_id', revision_row.id,
    'required_stage', effective_stage::text,
    'self_review_forbidden', true,
    'next_stage', 'operations'
  );
end;
$$;

create or replace function public.review_promotion_revision(
  p_content_id uuid,
  p_action text,
  p_comment text default null,
  p_revisit_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  revision_row public.promotion_content_revisions%rowtype;
  pending_stage public.promotion_review_stage;
  normalized_action text := lower(btrim(coalesce(p_action, '')));
  result jsonb;
begin
  if actor_id is null
     or not (
       public.private_actor_can('promotion.review_lead')
       or public.private_actor_can('promotion.review_operations')
       or public.private_actor_can('promotion.review_ceo')
     ) then
    raise exception using errcode = '42501', message = 'PROMOTION_REVIEW_FORBIDDEN';
  end if;

  select *
  into content_row
  from public.promotion_contents
  where id = p_content_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;

  select *
  into revision_row
  from public.promotion_content_revisions
  where id = content_row.current_revision_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_REVISION_NOT_FOUND';
  end if;

  select review.stage
  into pending_stage
  from public.promotion_review_requests review
  where review.revision_id = revision_row.id
    and review.decision = 'pending'
  order by review.created_at
  limit 1;

  -- Defense in depth for legacy/stale lead-review rows:
  -- an author can never review their own current revision.
  if actor_id = revision_row.author_profile_id
     and normalized_action in (
       'approve',
       'changes_requested',
       'rejected',
       'on_hold',
       'escalate_to_operations',
       'escalate_to_ceo'
     ) then
    raise exception using errcode = '42501', message = 'PROMOTION_SELF_REVIEW_FORBIDDEN';
  end if;

  result := public.private_review_promotion_revision_pre148(
    p_content_id,
    p_action,
    p_comment,
    p_revisit_at
  );

  -- Promotion-lead-authored submissions start directly at operations.
  -- When operations approves them, record that operations performed the review
  -- that satisfies the historical lead-stage invariant. The promotion lead is
  -- never the decider on this compatibility row.
  if pending_stage = 'operations'::public.promotion_review_stage
     and normalized_action = 'approve'
     and public.current_user_has_role('operations_manager')
     and not exists (
       select 1
       from public.promotion_review_requests lead_review
       where lead_review.revision_id = revision_row.id
         and lead_review.stage = 'lead'
     ) then
    insert into public.promotion_review_requests (
      revision_id,
      stage,
      decision,
      requested_by_profile_id,
      decided_by_profile_id,
      decision_comment,
      decided_at
    )
    values (
      revision_row.id,
      'lead',
      'approved',
      revision_row.author_profile_id,
      actor_id,
      '운영총괄 승인으로 작성자 자체검토 없이 lead 검토 충족',
      now()
    );
  end if;

  return result;
end;
$$;

alter function public.submit_promotion_revision(uuid) owner to postgres;
alter function public.review_promotion_revision(uuid,text,text,date) owner to postgres;

revoke all on function public.submit_promotion_revision(uuid) from public, anon;
revoke all on function public.review_promotion_revision(uuid,text,text,date) from public, anon;
grant execute on function public.submit_promotion_revision(uuid) to authenticated;
grant execute on function public.review_promotion_revision(uuid,text,text,date) to authenticated;

comment on function public.submit_promotion_revision(uuid) is
  'Submit own promotion revision. Promotion-lead-authored content always enters operations review and cannot be self-approved.';

comment on function public.review_promotion_revision(uuid,text,text,date) is
  'Review promotion revision with server-side self-review prohibition. Operations approval supplies the compatibility lead-approval record when a promotion-lead-authored revision started directly at operations.';

commit;
