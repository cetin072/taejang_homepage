-- Operations manager may optionally author promotion content without becoming a promotion-team member.
-- Authored content still enters the existing lead-first review chain before public publication.
-- Operations may upload only to their own promotion-media folder.

begin;

drop policy if exists "promotion media upload" on storage.objects;
create policy "promotion media upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'promotion-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (
    (
      public.current_user_is_promotion_member()
      and (
        public.current_user_has_role('promotion_staff')
        or public.current_user_has_role('promotion_lead')
      )
    )
    or public.current_user_has_role('operations_manager')
  )
);

create or replace function public.save_operations_promotion_draft(
  p_content_id uuid default null,
  p_content_type public.promotion_content_type default 'homepage_article',
  p_slug text default null,
  p_title text default null,
  p_summary text default null,
  p_public_body text default null,
  p_external_url text default null,
  p_byline text default null,
  p_byline_kind public.promotion_byline_kind default 'company',
  p_related_organization text default null,
  p_source_reference_url text default null,
  p_hero_image_url text default null,
  p_public_media jsonb default '[]'::jsonb,
  p_people_photo public.promotion_disclosure_answer default 'unsure',
  p_number_or_amount public.promotion_disclosure_answer default 'unsure',
  p_requested_publish_date date default null,
  p_change_reason text default null
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
  promotion_department_id uuid;
  next_revision_no integer;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'OPERATIONS_PROMOTION_DRAFT_FORBIDDEN';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception using errcode = '22023', message = 'PROMOTION_TITLE_REQUIRED';
  end if;
  perform public.promotion_validate_url(p_external_url, 'external_url');
  perform public.promotion_validate_url(p_source_reference_url, 'source_reference_url');
  perform public.promotion_validate_url(p_hero_image_url, 'hero_image_url');
  perform public.promotion_validate_public_media(p_public_media);

  if p_content_id is null then
    select id into promotion_department_id
    from public.departments
    where code = 'promotion' and active;
    if promotion_department_id is null then
      raise exception using errcode = '23514', message = 'PROMOTION_DEPARTMENT_MISSING';
    end if;
    insert into public.promotion_contents (
      department_id, owner_profile_id, assignee_profile_id, content_type
    ) values (
      promotion_department_id, actor_id, actor_id, p_content_type
    ) returning * into content_row;
    next_revision_no := 1;
  else
    select * into content_row
    from public.promotion_contents
    where id = p_content_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
    end if;
    if content_row.owner_profile_id <> actor_id then
      raise exception using errcode = '42501', message = 'OPERATIONS_PROMOTION_DRAFT_NOT_OWNER';
    end if;
    if content_row.lifecycle in ('published', 'hidden', 'archived') then
      raise exception using errcode = '55000', message = 'OPERATIONS_PROMOTION_PUBLISHED_IMMUTABLE';
    end if;

    select * into revision_row
    from public.promotion_content_revisions
    where id = content_row.current_revision_id
    for update;

    if found and revision_row.locked_at is null then
      update public.promotion_content_revisions
      set slug = p_slug,
          title = btrim(p_title),
          summary = nullif(btrim(coalesce(p_summary, '')), ''),
          public_body = nullif(btrim(coalesce(p_public_body, '')), ''),
          external_url = nullif(btrim(coalesce(p_external_url, '')), ''),
          byline = nullif(btrim(coalesce(p_byline, '')), ''),
          byline_kind = p_byline_kind,
          related_organization = nullif(btrim(coalesce(p_related_organization, '')), ''),
          source_reference_url = nullif(btrim(coalesce(p_source_reference_url, '')), ''),
          hero_image_url = nullif(btrim(coalesce(p_hero_image_url, '')), ''),
          public_media = p_public_media,
          people_photo = p_people_photo,
          number_or_amount = p_number_or_amount,
          requested_publish_date = p_requested_publish_date,
          change_reason = nullif(btrim(coalesce(p_change_reason, '')), '')
      where id = revision_row.id;
      update public.promotion_contents
      set content_type = p_content_type,
          lifecycle = 'draft',
          updated_at = now()
      where id = content_row.id;
      perform public.private_append_audit(
        actor_id, 'operations_promotion_draft_updated', 'promotion_content', content_row.id::text,
        'success', '운영총괄 홍보 초안 저장', jsonb_build_object('revision_no', revision_row.revision_no)
      );
      return jsonb_build_object('ok', true, 'code', 'PROMOTION_DRAFT_SAVED', 'content_id', content_row.id, 'revision_id', revision_row.id, 'revision_no', revision_row.revision_no);
    end if;

    select coalesce(max(revision_no), 0) + 1 into next_revision_no
    from public.promotion_content_revisions
    where content_id = content_row.id;
  end if;

  insert into public.promotion_content_revisions (
    content_id, revision_no, author_profile_id, slug, title, summary, public_body,
    external_url, byline, byline_kind, related_organization, source_reference_url,
    hero_image_url, public_media, people_photo, number_or_amount,
    requested_publish_date, change_reason
  ) values (
    content_row.id, next_revision_no, actor_id, p_slug, btrim(p_title),
    nullif(btrim(coalesce(p_summary, '')), ''), nullif(btrim(coalesce(p_public_body, '')), ''),
    nullif(btrim(coalesce(p_external_url, '')), ''), nullif(btrim(coalesce(p_byline, '')), ''),
    p_byline_kind, nullif(btrim(coalesce(p_related_organization, '')), ''),
    nullif(btrim(coalesce(p_source_reference_url, '')), ''), nullif(btrim(coalesce(p_hero_image_url, '')), ''),
    p_public_media, p_people_photo, p_number_or_amount, p_requested_publish_date,
    nullif(btrim(coalesce(p_change_reason, '')), '')
  ) returning * into revision_row;

  update public.promotion_contents
  set content_type = p_content_type,
      current_revision_id = revision_row.id,
      lifecycle = 'draft',
      updated_at = now()
  where id = content_row.id;

  perform public.private_append_audit(
    actor_id, 'operations_promotion_draft_created', 'promotion_content', content_row.id::text,
    'success', '운영총괄 홍보 초안 생성', jsonb_build_object('revision_no', revision_row.revision_no)
  );
  return jsonb_build_object('ok', true, 'code', 'PROMOTION_DRAFT_SAVED', 'content_id', content_row.id, 'revision_id', revision_row.id, 'revision_no', revision_row.revision_no);
end;
$$;

create or replace function public.submit_operations_promotion_revision(p_content_id uuid)
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
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'OPERATIONS_PROMOTION_SUBMIT_FORBIDDEN';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;
  if actor_id <> content_row.owner_profile_id and actor_id <> content_row.assignee_profile_id then
    raise exception using errcode = '42501', message = 'OPERATIONS_PROMOTION_SUBMIT_NOT_ASSIGNED';
  end if;

  select * into revision_row
  from public.promotion_content_revisions
  where id = content_row.current_revision_id
  for update;
  if not found or revision_row.locked_at is not null then
    raise exception using errcode = '55000', message = 'PROMOTION_CURRENT_REVISION_NOT_DRAFT';
  end if;

  required_stage := public.promotion_required_stage(content_row.content_type, revision_row.byline_kind, revision_row.number_or_amount);
  update public.promotion_content_revisions
  set submitted_at = now(), locked_at = now()
  where id = revision_row.id;

  update public.promotion_contents
  set minimum_review_stage = greatest(content_row.minimum_review_stage, required_stage),
      lifecycle = 'review_pending',
      updated_at = now()
  where id = content_row.id;

  insert into public.promotion_review_requests (revision_id, stage, requested_by_profile_id)
  values (revision_row.id, 'lead', actor_id);

  perform public.private_append_audit(
    actor_id, 'operations_promotion_revision_submitted', 'promotion_revision', revision_row.id::text,
    'success', '운영총괄 작성 홍보자료 승인 요청',
    jsonb_build_object('required_stage', greatest(content_row.minimum_review_stage, required_stage)::text)
  );

  return jsonb_build_object('ok', true, 'code', 'PROMOTION_SUBMITTED', 'revision_id', revision_row.id, 'required_stage', greatest(content_row.minimum_review_stage, required_stage)::text);
end;
$$;

revoke all on function public.save_operations_promotion_draft(uuid, public.promotion_content_type, text, text, text, text, text, text, public.promotion_byline_kind, text, text, text, jsonb, public.promotion_disclosure_answer, public.promotion_disclosure_answer, date, text) from public, anon, authenticated;
revoke all on function public.submit_operations_promotion_revision(uuid) from public, anon, authenticated;
grant execute on function public.save_operations_promotion_draft(uuid, public.promotion_content_type, text, text, text, text, text, text, public.promotion_byline_kind, text, text, text, jsonb, public.promotion_disclosure_answer, public.promotion_disclosure_answer, date, text) to authenticated;
grant execute on function public.submit_operations_promotion_revision(uuid) to authenticated;

commit;
