-- Promotion review hold UX:
-- - holding a review no longer requires a revisit date or comment;
-- - held reviews are returned separately so reviewers can resume them explicitly.
begin;

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
  pending_review public.promotion_review_requests%rowtype;
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

  select review.*
  into pending_review
  from public.promotion_review_requests review
  where review.revision_id = revision_row.id
    and review.decision = 'pending'
  order by review.created_at
  limit 1;

  if actor_id = revision_row.author_profile_id
     and public.current_user_has_role('promotion_lead')
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

  if normalized_action = 'on_hold' then
    if pending_review.id is null then
      raise exception using errcode = '55000', message = 'PROMOTION_REVIEW_NOT_PENDING';
    end if;

    if pending_review.stage = 'lead'
       and not public.current_user_is_promotion_lead() then
      raise exception using errcode = '42501', message = 'PROMOTION_LEAD_REVIEW_FORBIDDEN';
    elsif pending_review.stage = 'operations'
       and not public.current_user_has_role('operations_manager') then
      raise exception using errcode = '42501', message = 'PROMOTION_OPERATIONS_REVIEW_FORBIDDEN';
    elsif pending_review.stage = 'ceo'
       and not public.current_user_has_role('ceo') then
      raise exception using errcode = '42501', message = 'PROMOTION_CEO_REVIEW_FORBIDDEN';
    end if;

    update public.promotion_review_requests
    set decision = 'on_hold',
        decided_by_profile_id = actor_id,
        decision_comment = nullif(btrim(coalesce(p_comment, '')), ''),
        revisit_at = p_revisit_at,
        decided_at = now()
    where id = pending_review.id;

    perform public.private_append_audit(
      actor_id,
      'promotion_review_on_hold',
      'promotion_revision',
      revision_row.id::text,
      'success',
      '홍보 검토 보류',
      jsonb_build_object(
        'stage', pending_review.stage::text,
        'action', normalized_action,
        'revisit_at', p_revisit_at
      )
    );

    return jsonb_build_object(
      'ok', true,
      'code', 'PROMOTION_REVIEW_ON_HOLD',
      'stage', pending_review.stage::text
    );
  end if;

  result := public.private_review_promotion_revision_pre148(
    p_content_id,
    p_action,
    p_comment,
    p_revisit_at
  );

  -- Promotion-lead-authored submissions start directly at operations.
  -- Preserve the compatibility lead approval row when operations approves.
  if pending_review.stage = 'operations'::public.promotion_review_stage
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

alter function public.review_promotion_revision(uuid,text,text,date) owner to postgres;
revoke all on function public.review_promotion_revision(uuid,text,text,date) from public, anon;
grant execute on function public.review_promotion_revision(uuid,text,text,date) to authenticated;

comment on function public.review_promotion_revision(uuid,text,text,date) is
  'Review promotion revision. on_hold is immediate and may omit revisit date/comment; held items can be resumed explicitly.';

create or replace function public.get_my_promotion_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  result jsonb;
  enriched_items jsonb := '[]'::jsonb;
  held_items jsonb := '[]'::jsonb;
  workspace_role text;
  held_stage public.promotion_review_stage;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not (
       public.private_actor_can('promotion.write')
       or public.private_actor_can('promotion.review_lead')
       or public.private_actor_can('promotion.review_operations')
       or public.private_actor_can('promotion.review_ceo')
     ) then
    raise exception using errcode = '42501', message = 'PROMOTION_WORKSPACE_FORBIDDEN';
  end if;

  result := public.private_get_my_promotion_workspace_pre148();
  workspace_role := result ->> 'role';

  select coalesce(
    jsonb_agg(
      item || jsonb_build_object(
        'is_owner',
          coalesce((
            select content.owner_profile_id = actor_id
            from public.promotion_contents content
            where content.id = nullif(item ->> 'content_id', '')::uuid
          ), false),
        'is_assignee',
          coalesce((
            select content.assignee_profile_id = actor_id
            from public.promotion_contents content
            where content.id = nullif(item ->> 'content_id', '')::uuid
          ), false)
      )
      order by ordinality
    ),
    '[]'::jsonb
  )
  into enriched_items
  from jsonb_array_elements(coalesce(result -> 'my_items', '[]'::jsonb))
       with ordinality as entries(item, ordinality);

  held_stage := case workspace_role
    when 'promotion_lead' then 'lead'::public.promotion_review_stage
    when 'operations_manager' then 'operations'::public.promotion_review_stage
    when 'ceo' then 'ceo'::public.promotion_review_stage
    else null
  end;

  if held_stage is not null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'content_id', held.content_id,
          'revision_id', held.revision_id,
          'title', held.title,
          'stage', held.stage::text,
          'required_stage', held.minimum_review_stage::text,
          'decision_comment', held.decision_comment,
          'revisit_at', held.revisit_at,
          'held_at', held.decided_at
        )
        order by held.decided_at desc
      ),
      '[]'::jsonb
    )
    into held_items
    from (
      select distinct on (review.revision_id)
        content.id as content_id,
        revision.id as revision_id,
        revision.title,
        review.stage,
        content.minimum_review_stage,
        review.decision_comment,
        review.revisit_at,
        review.decided_at
      from public.promotion_review_requests review
      join public.promotion_content_revisions revision
        on revision.id = review.revision_id
      join public.promotion_contents content
        on content.id = revision.content_id
       and content.current_revision_id = revision.id
      where review.decision = 'on_hold'
        and review.stage = held_stage
        and not exists (
          select 1
          from public.promotion_review_requests pending
          where pending.revision_id = review.revision_id
            and pending.decision = 'pending'
        )
      order by review.revision_id, review.decided_at desc
    ) held;
  end if;

  result := jsonb_set(result, '{my_items}', enriched_items, true);
  return jsonb_set(result, '{held_items}', held_items, true);
end;
$$;

alter function public.get_my_promotion_workspace() owner to postgres;
revoke all on function public.get_my_promotion_workspace() from public, anon, authenticated;
grant execute on function public.get_my_promotion_workspace() to authenticated;

comment on function public.get_my_promotion_workspace() is
  'Capability-guarded promotion workspace with owner/assignee annotations and resumable held review items.';

commit;
