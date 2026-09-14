-- Issue #207 correction.
-- Expose original content owner alongside the current review submitter.
-- Deletion policy is finalized by the later 20260914073000 migration.

begin;

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
grant execute on function public.get_promotion_review_submitter(uuid) to authenticated;

commit;