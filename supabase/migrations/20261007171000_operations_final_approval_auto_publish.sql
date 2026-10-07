-- User-approved workflow: when operations_manager is the final required reviewer,
-- approval publishes immediately. CEO-gated content still advances to CEO review.
begin;

alter function public.review_promotion_revision(uuid,text,text,date)
  rename to private_review_promotion_revision_before_operations_auto_publish;

revoke all on function public.private_review_promotion_revision_before_operations_auto_publish(uuid,text,text,date)
  from public, anon, authenticated;

create function public.review_promotion_revision(
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
  normalized_action text := lower(btrim(coalesce(p_action, '')));
  result jsonb;
  content_row public.promotion_contents%rowtype;
begin
  result := public.private_review_promotion_revision_before_operations_auto_publish(
    p_content_id,
    p_action,
    p_comment,
    p_revisit_at
  );

  if actor_id is not null
     and normalized_action = 'approve'
     and public.current_user_has_role('operations_manager')
     and coalesce(result ->> 'stage', '') = 'operations' then

    select *
    into content_row
    from public.promotion_contents
    where id = p_content_id
    for update;

    -- The previous review implementation leaves a true final operations
    -- approval in approved. CEO-required content remains review_pending with
    -- a pending CEO review and therefore never enters this branch.
    if found
       and content_row.lifecycle = 'approved'::public.promotion_lifecycle
       and content_row.current_revision_id is not null
       and not exists (
         select 1
         from public.promotion_review_requests pending
         where pending.revision_id = content_row.current_revision_id
           and pending.decision = 'pending'
       )
       and public.promotion_revision_is_fully_approved(
         content_row.id,
         content_row.current_revision_id
       ) then

      update public.promotion_contents
      set lifecycle = 'published',
          published_at = coalesce(published_at, now()),
          updated_at = now()
      where id = content_row.id;

      update public.promotion_publication_queue queue
      set status = 'cancelled',
          updated_at = now()
      where queue.revision_id = content_row.current_revision_id
        and queue.status = 'queued';

      perform public.private_append_audit(
        actor_id,
        'promotion_operations_final_approved_and_published',
        'promotion_content',
        content_row.id::text,
        'success',
        '운영총괄 최종 승인과 동시에 홈페이지 공개',
        jsonb_build_object(
          'revision_id', content_row.current_revision_id,
          'approval_stage', 'operations',
          'publication_mode', 'immediate'
        )
      );

      result := result || jsonb_build_object(
        'published', true,
        'lifecycle', 'published',
        'code', 'PROMOTION_OPERATIONS_FINAL_APPROVED_AND_PUBLISHED'
      );
    end if;
  end if;

  return result;
end;
$$;

alter function public.review_promotion_revision(uuid,text,text,date) owner to postgres;
revoke all on function public.review_promotion_revision(uuid,text,text,date) from public, anon;
grant execute on function public.review_promotion_revision(uuid,text,text,date) to authenticated;

comment on function public.review_promotion_revision(uuid,text,text,date) is
  'Promotion review entrypoint. A final operations approval publishes immediately; CEO-gated content remains in CEO review.';

commit;
