-- Issue #207 follow-up correction.
-- Preserve the established rule: promotion leads may directly archive only within
-- 24 hours; after 24 hours they may request deletion from operations manager.
-- Also expose the original content owner alongside the current review submitter.

begin;

create or replace function public.request_promotion_deletion(p_content_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.private_actor_can('promotion.archive') then
    raise exception using errcode='42501', message='PROMOTION_DELETE_REQUEST_FORBIDDEN';
  end if;
  return public.private_request_promotion_deletion_pre148(p_content_id, p_reason);
end;
$function$;

-- Operations manager retains final recoverable-delete authority. The 24-hour
-- restriction applies to promotion-lead direct archive, not to final operations review.
create or replace function public.delete_promotion_content(p_content_id uuid, p_confirm_title text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.private_actor_can('promotion.archive') then
    raise exception using errcode='42501', message='PROMOTION_DELETE_FORBIDDEN';
  end if;
  return public.private_delete_promotion_content_pre148(p_content_id, p_confirm_title, p_reason);
end;
$function$;

create or replace function public.get_promotion_review_submitter(p_content_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  review_row public.promotion_review_requests%rowtype;
  owner_name text;
  submitter_name text;
  author_name text;
  revision_author_id uuid;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (
       public.private_actor_can('promotion.review_lead')
       or public.private_actor_can('promotion.review_operations')
       or public.private_actor_can('promotion.review_ceo')
     ) then
    raise exception using errcode='42501', message='PROMOTION_REVIEW_SUBMITTER_FORBIDDEN';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id;
  if not found then
    raise exception using errcode='P0002', message='PROMOTION_CONTENT_NOT_FOUND';
  end if;

  select profile.display_name into owner_name
  from public.profiles profile
  where profile.id = content_row.owner_profile_id;

  select revision.author_profile_id into revision_author_id
  from public.promotion_content_revisions revision
  where revision.id = content_row.current_revision_id;

  select profile.display_name into author_name
  from public.profiles profile
  where profile.id = revision_author_id;

  select * into review_row
  from public.promotion_review_requests review
  where review.revision_id = content_row.current_revision_id
    and review.decision = 'pending'
  order by review.created_at
  limit 1;

  if review_row.id is not null then
    select profile.display_name into submitter_name
    from public.profiles profile
    where profile.id = review_row.requested_by_profile_id;
  end if;

  return jsonb_build_object(
    'content_id', p_content_id,
    'owner_profile_id', content_row.owner_profile_id,
    'owner_name', owner_name,
    'revision_author_profile_id', revision_author_id,
    'revision_author_name', author_name,
    'submitted_by_profile_id', review_row.requested_by_profile_id,
    'submitted_by_name', submitter_name,
    'requested_at', review_row.created_at
  );
end;
$function$;

revoke all on function public.get_promotion_review_submitter(uuid) from public;
revoke all on function public.request_promotion_deletion(uuid,text) from public;
revoke all on function public.delete_promotion_content(uuid,text,text) from public;

grant execute on function public.get_promotion_review_submitter(uuid) to authenticated;
grant execute on function public.request_promotion_deletion(uuid,text) to authenticated;
grant execute on function public.delete_promotion_content(uuid,text,text) to authenticated;

commit;
