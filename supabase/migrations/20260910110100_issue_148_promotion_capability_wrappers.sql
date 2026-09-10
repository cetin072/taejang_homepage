-- Issue #148 A: capability entrypoints preserve the established workflow
-- implementations (stage, lock, media validation and audit remain there).
begin;

alter function public.get_my_promotion_workspace() rename to private_get_my_promotion_workspace_pre148;
alter function public.submit_promotion_revision(uuid) rename to private_submit_promotion_revision_pre148;
alter function public.review_promotion_revision(uuid,text,text,date) rename to private_review_promotion_revision_pre148;
alter function public.queue_promotion_revision(uuid,timestamptz) rename to private_queue_promotion_revision_pre148;

revoke all on function public.private_get_my_promotion_workspace_pre148() from public, anon, authenticated;
revoke all on function public.private_submit_promotion_revision_pre148(uuid) from public, anon, authenticated;
revoke all on function public.private_review_promotion_revision_pre148(uuid,text,text,date) from public, anon, authenticated;
revoke all on function public.private_queue_promotion_revision_pre148(uuid,timestamptz) from public, anon, authenticated;

create function public.get_my_promotion_workspace() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not (public.private_actor_can('promotion.write') or public.private_actor_can('promotion.review_lead') or public.private_actor_can('promotion.review_operations') or public.private_actor_can('promotion.review_ceo')) then
    raise exception using errcode='42501', message='PROMOTION_WORKSPACE_FORBIDDEN';
  end if;
  return public.private_get_my_promotion_workspace_pre148();
end; $$;

create function public.submit_promotion_revision(p_content_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.private_actor_can('promotion.edit_own') then raise exception using errcode='42501', message='PROMOTION_SUBMIT_FORBIDDEN'; end if;
  return public.private_submit_promotion_revision_pre148(p_content_id);
end; $$;

create function public.review_promotion_revision(p_content_id uuid,p_action text,p_comment text default null,p_revisit_at date default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not (public.private_actor_can('promotion.review_lead') or public.private_actor_can('promotion.review_operations') or public.private_actor_can('promotion.review_ceo')) then raise exception using errcode='42501', message='PROMOTION_REVIEW_FORBIDDEN'; end if;
  return public.private_review_promotion_revision_pre148(p_content_id,p_action,p_comment,p_revisit_at);
end; $$;

create function public.queue_promotion_revision(p_content_id uuid,p_scheduled_for timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.private_actor_can('promotion.queue_publication') then raise exception using errcode='42501', message='PROMOTION_QUEUE_FORBIDDEN'; end if;
  return public.private_queue_promotion_revision_pre148(p_content_id,p_scheduled_for);
end; $$;

grant execute on function public.get_my_promotion_workspace() to authenticated;
grant execute on function public.submit_promotion_revision(uuid) to authenticated;
grant execute on function public.review_promotion_revision(uuid,text,text,date) to authenticated;
grant execute on function public.queue_promotion_revision(uuid,timestamptz) to authenticated;
commit;
