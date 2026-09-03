-- Keep the approval predicate usable after queueing changes the staff-facing
-- lifecycle to scheduled. The current revision and every required approval
-- remain mandatory, so this does not broaden the export audience.
begin;

create or replace function public.promotion_revision_is_fully_approved(
  p_content_id uuid,
  p_revision_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.promotion_contents content
    where content.id = p_content_id
      and content.current_revision_id = p_revision_id
      and content.lifecycle in ('approved', 'scheduled')
      and exists (
        select 1 from public.promotion_review_requests lead_review
        where lead_review.revision_id = p_revision_id
          and lead_review.stage = 'lead'
          and lead_review.decision = 'approved'
      )
      and (
        content.minimum_review_stage < 'operations'::public.promotion_review_stage
        or exists (
          select 1 from public.promotion_review_requests operations_review
          where operations_review.revision_id = p_revision_id
            and operations_review.stage = 'operations'
            and operations_review.decision = 'approved'
        )
      )
      and (
        content.minimum_review_stage < 'ceo'::public.promotion_review_stage
        or exists (
          select 1 from public.promotion_review_requests ceo_review
          where ceo_review.revision_id = p_revision_id
            and ceo_review.stage = 'ceo'
            and ceo_review.decision = 'approved'
        )
      )
  );
$$;

alter function public.promotion_revision_is_fully_approved(uuid, uuid) owner to postgres;
revoke all on function public.promotion_revision_is_fully_approved(uuid, uuid) from public, anon, authenticated;

commit;
