-- Promotion lead authoring flow:
-- 1) a promotion lead does not receive a manual lead-review task for their own submission;
-- 2) the lead stage is recorded as system-satisfied for downstream approval invariants;
-- 3) required upper review still starts at operations and publication remains explicit.
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
  effective_stage := greatest(content_row.minimum_review_stage, required_stage);

  update public.promotion_content_revisions
  set submitted_at = now(),
      locked_at = now()
  where id = revision_row.id;

  -- Preserve the existing "fully approved" invariant without making the
  -- promotion lead manually review their own submission. This row is created
  -- already decided and is never exposed as a pending review task.
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
    actor_id,
    actor_id,
    '운영팀장 직접 작성: lead 수동 검토 단계 자동 충족',
    now()
  );

  if effective_stage = 'lead'::public.promotion_review_stage then
    update public.promotion_contents
    set minimum_review_stage = effective_stage,
        lifecycle = 'approved'
    where id = content_row.id;
  else
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
  end if;

  perform public.private_append_audit(
    actor_id,
    'promotion_revision_submitted',
    'promotion_revision',
    revision_row.id::text,
    'success',
    '운영팀장 작성 홍보 승인 요청',
    jsonb_build_object(
      'required_stage', effective_stage::text,
      'lead_stage_auto_satisfied', true,
      'next_stage', case when effective_stage = 'lead'::public.promotion_review_stage then null else 'operations' end,
      'lead_people_photo_check', revision_row.people_photo in ('yes', 'unsure')
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PROMOTION_SUBMITTED',
    'revision_id', revision_row.id,
    'required_stage', effective_stage::text,
    'lead_stage_auto_satisfied', true,
    'next_stage', case when effective_stage = 'lead'::public.promotion_review_stage then null else 'operations' end
  );
end;
$$;

alter function public.submit_promotion_revision(uuid) owner to postgres;
revoke all on function public.submit_promotion_revision(uuid) from public, anon;
grant execute on function public.submit_promotion_revision(uuid) to authenticated;

comment on function public.submit_promotion_revision(uuid) is
  'Submit own promotion revision. Promotion-lead authored revisions auto-satisfy the lead stage without a pending self-review; required upper review remains enforced.';

commit;
