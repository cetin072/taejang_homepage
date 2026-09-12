-- Issue #181: source-aware promotion links and date-based publication.
-- Ordinary promotion content remains promotion-lead final. A future requested
-- publish date schedules the approved revision for 00:00 Asia/Seoul; no future
-- date means final approval publishes immediately.

begin;

alter table public.promotion_contents
  add column if not exists link_source_type text not null default 'none';

alter table public.promotion_contents
  drop constraint if exists promotion_contents_link_source_type_check;

alter table public.promotion_contents
  add constraint promotion_contents_link_source_type_check
  check (link_source_type in ('none', 'taejang_homepage', 'taejang_blog', 'taejang_youtube', 'external'));

create or replace function public.set_promotion_link_source(
  p_content_id uuid,
  p_link_source_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  revision_external_url text;
  normalized_type text := lower(btrim(coalesce(p_link_source_type, 'none')));
  can_edit boolean := false;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'PROMOTION_LINK_SOURCE_FORBIDDEN';
  end if;
  if normalized_type not in ('none', 'taejang_homepage', 'taejang_blog', 'taejang_youtube', 'external') then
    raise exception using errcode = '22023', message = 'PROMOTION_LINK_SOURCE_INVALID';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;
  if content_row.lifecycle in ('published', 'hidden', 'archived') then
    raise exception using errcode = '55000', message = 'PROMOTION_LINK_SOURCE_PUBLISHED_LOCKED';
  end if;

  select revision.external_url into revision_external_url
  from public.promotion_content_revisions revision
  where revision.id = content_row.current_revision_id;

  can_edit := (
      public.private_actor_can('promotion.edit_own')
      and (content_row.owner_profile_id = actor_id or content_row.assignee_profile_id = actor_id)
    )
    or public.private_actor_can('promotion.edit_any_unpublished')
    or (
      public.private_actor_can('promotion.review_lead')
      and public.current_user_is_promotion_lead()
    );
  if not can_edit then
    raise exception using errcode = '42501', message = 'PROMOTION_LINK_SOURCE_FORBIDDEN';
  end if;

  if revision_external_url is null and normalized_type <> 'none' then
    raise exception using errcode = '22023', message = 'PROMOTION_LINK_SOURCE_REQUIRES_URL';
  end if;
  if revision_external_url is not null and normalized_type = 'none' then
    raise exception using errcode = '22023', message = 'PROMOTION_LINK_SOURCE_REQUIRED';
  end if;

  update public.promotion_contents
  set link_source_type = normalized_type,
      updated_at = now()
  where id = content_row.id;

  perform public.private_append_audit(
    actor_id,
    'promotion_link_source_changed',
    'promotion_content',
    content_row.id::text,
    'success',
    '홍보 연결 자료 분류 변경',
    jsonb_build_object('from', content_row.link_source_type, 'to', normalized_type)
  );

  return jsonb_build_object('ok', true, 'code', 'PROMOTION_LINK_SOURCE_UPDATED', 'link_source_type', normalized_type);
end;
$$;

create or replace function public.get_promotion_link_source(p_content_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  value text;
begin
  if auth.uid() is null or not public.promotion_can_view_content(p_content_id) then
    raise exception using errcode = '42501', message = 'PROMOTION_LINK_SOURCE_FORBIDDEN';
  end if;
  select content.link_source_type into value
  from public.promotion_contents content
  where content.id = p_content_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;
  return value;
end;
$$;

-- A scheduled content row is still fully approved. This keeps the existing queue
-- contract usable after the approval trigger moves the lifecycle to scheduled.
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

create or replace function public.private_publish_approved_promotion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_date date;
  scheduled_at timestamptz;
  queue_id uuid;
begin
  if new.lifecycle = 'approved'::public.promotion_lifecycle
     and old.lifecycle is distinct from new.lifecycle then
    select revision.requested_publish_date into requested_date
    from public.promotion_content_revisions revision
    where revision.id = new.current_revision_id;

    if requested_date is not null
       and requested_date > (now() at time zone 'Asia/Seoul')::date then
      scheduled_at := requested_date::timestamp at time zone 'Asia/Seoul';

      insert into public.promotion_publication_queue (
        revision_id, queued_by_profile_id, scheduled_for, status
      ) values (
        new.current_revision_id, auth.uid(), scheduled_at, 'queued'
      )
      on conflict (revision_id) do update
      set queued_by_profile_id = excluded.queued_by_profile_id,
          scheduled_for = excluded.scheduled_for,
          status = 'queued',
          updated_at = now()
      returning id into queue_id;

      update public.promotion_contents
      set lifecycle = 'scheduled',
          published_at = null,
          updated_at = now()
      where id = new.id;

      if auth.uid() is not null then
        perform public.private_append_audit(
          auth.uid(),
          'promotion_scheduled',
          'promotion_content',
          new.id::text,
          'success',
          '최종 승인 후 지정일 예약 공개',
          jsonb_build_object(
            'revision_id', new.current_revision_id,
            'queue_id', queue_id,
            'scheduled_for', scheduled_at,
            'requested_publish_date', requested_date
          )
        );
      end if;
    else
      update public.promotion_contents
      set lifecycle = 'published',
          published_at = coalesce(published_at, now()),
          updated_at = now()
      where id = new.id;

      update public.promotion_publication_queue queue
      set status = 'cancelled', updated_at = now()
      where queue.revision_id = new.current_revision_id and queue.status = 'queued';

      if auth.uid() is not null then
        perform public.private_append_audit(
          auth.uid(),
          'promotion_published',
          'promotion_content',
          new.id::text,
          'success',
          '최종 승인 후 홈페이지 즉시 공개',
          jsonb_build_object('revision_id', new.current_revision_id)
        );
      end if;
    end if;
  end if;
  return null;
end;
$$;

-- Publish due scheduled rows deterministically when the public feed/detail is read.
-- This avoids a separate paid scheduler while preserving lifecycle/public-history
-- semantics: a future item stays scheduled and unpublished until its due time.
create or replace function public.private_publish_due_promotions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due_row record;
  published_count integer := 0;
begin
  for due_row in
    select
      queue.id as queue_id,
      queue.revision_id,
      queue.queued_by_profile_id,
      queue.scheduled_for,
      content.id as content_id
    from public.promotion_publication_queue queue
    join public.promotion_content_revisions revision on revision.id = queue.revision_id
    join public.promotion_contents content on content.id = revision.content_id
    where queue.status = 'queued'
      and queue.scheduled_for is not null
      and queue.scheduled_for <= now()
      and content.lifecycle = 'scheduled'
      and content.current_revision_id = revision.id
    order by queue.scheduled_for, queue.id
    for update of queue skip locked
  loop
    if not public.promotion_revision_is_fully_approved(due_row.content_id, due_row.revision_id) then
      continue;
    end if;

    update public.promotion_contents
    set lifecycle = 'published',
        published_at = coalesce(published_at, due_row.scheduled_for, now()),
        updated_at = now()
    where id = due_row.content_id
      and lifecycle = 'scheduled'
      and current_revision_id = due_row.revision_id;

    if found then
      update public.promotion_publication_queue
      set status = 'exported', updated_at = now()
      where id = due_row.queue_id;

      if due_row.queued_by_profile_id is not null then
        perform public.private_append_audit(
          due_row.queued_by_profile_id,
          'promotion_scheduled_published',
          'promotion_content',
          due_row.content_id::text,
          'success',
          '예약일 도달 후 홈페이지 공개',
          jsonb_build_object('revision_id', due_row.revision_id, 'scheduled_for', due_row.scheduled_for)
        );
      end if;
      published_count := published_count + 1;
    end if;
  end loop;

  return published_count;
end;
$$;

-- Service-role export must never surface a future scheduled item early.
create or replace function public.list_promotion_public_export_candidates()
returns table (
  revision_id uuid,
  content_id uuid,
  content_type text,
  slug text,
  title text,
  summary text,
  public_body text,
  external_url text,
  byline text,
  related_organization text,
  hero_image_url text,
  public_media jsonb,
  requested_publish_date date,
  queue_id uuid,
  scheduled_for timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    revision.id,
    content.id,
    content.content_type::text,
    revision.slug,
    revision.title,
    revision.summary,
    revision.public_body,
    revision.external_url,
    revision.byline,
    revision.related_organization,
    revision.hero_image_url,
    revision.public_media,
    revision.requested_publish_date,
    queue.id,
    queue.scheduled_for
  from public.promotion_publication_queue queue
  join public.promotion_content_revisions revision on revision.id = queue.revision_id
  join public.promotion_contents content on content.id = revision.content_id
  where queue.status = 'queued'
    and (queue.scheduled_for is null or queue.scheduled_for <= now())
    and content.lifecycle = 'scheduled'
    and content.current_revision_id = revision.id
    and public.promotion_revision_is_fully_approved(content.id, revision.id)
  order by coalesce(queue.scheduled_for, queue.created_at), revision.created_at, revision.id;
$$;

-- Return shapes gain link_source_type so the public adapter can label official
-- homepage/blog/YouTube links differently from third-party articles.
drop function if exists public.list_public_promotion_feed();
create function public.list_public_promotion_feed()
returns table (
  content_id uuid,
  content_type text,
  slug text,
  title text,
  summary text,
  external_url text,
  byline text,
  related_organization text,
  hero_image_url text,
  public_media jsonb,
  link_source_type text,
  published_at timestamptz,
  published_date text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.private_publish_due_promotions();
  return query
  select
    content.id,
    content.content_type::text,
    revision.slug,
    revision.title,
    revision.summary,
    revision.external_url,
    revision.byline,
    revision.related_organization,
    revision.hero_image_url,
    revision.public_media,
    content.link_source_type,
    content.published_at,
    to_char(content.published_at at time zone 'Asia/Seoul', 'YYYY-MM-DD')
  from public.promotion_contents content
  join public.promotion_content_revisions revision on revision.id = content.current_revision_id
  where content.lifecycle = 'published'
    and content.published_at is not null
  order by content.published_at desc, content.id;
end;
$$;

drop function if exists public.get_public_promotion_content(uuid);
create function public.get_public_promotion_content(p_content_id uuid)
returns table (
  content_id uuid,
  content_type text,
  slug text,
  title text,
  summary text,
  public_body text,
  external_url text,
  byline text,
  related_organization text,
  hero_image_url text,
  public_media jsonb,
  link_source_type text,
  published_at timestamptz,
  published_date text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.private_publish_due_promotions();
  return query
  select
    content.id,
    content.content_type::text,
    revision.slug,
    revision.title,
    revision.summary,
    revision.public_body,
    revision.external_url,
    revision.byline,
    revision.related_organization,
    revision.hero_image_url,
    revision.public_media,
    content.link_source_type,
    content.published_at,
    to_char(content.published_at at time zone 'Asia/Seoul', 'YYYY-MM-DD')
  from public.promotion_contents content
  join public.promotion_content_revisions revision on revision.id = content.current_revision_id
  where content.id = p_content_id
    and content.lifecycle = 'published'
    and content.published_at is not null
  limit 1;
end;
$$;

alter function public.set_promotion_link_source(uuid, text) owner to postgres;
alter function public.get_promotion_link_source(uuid) owner to postgres;
alter function public.promotion_revision_is_fully_approved(uuid, uuid) owner to postgres;
alter function public.private_publish_approved_promotion() owner to postgres;
alter function public.private_publish_due_promotions() owner to postgres;
alter function public.list_promotion_public_export_candidates() owner to postgres;
alter function public.list_public_promotion_feed() owner to postgres;
alter function public.get_public_promotion_content(uuid) owner to postgres;

revoke all on function public.set_promotion_link_source(uuid, text) from public, anon, authenticated;
revoke all on function public.get_promotion_link_source(uuid) from public, anon, authenticated;
revoke all on function public.private_publish_due_promotions() from public, anon, authenticated;
revoke all on function public.list_public_promotion_feed() from public, anon, authenticated;
revoke all on function public.get_public_promotion_content(uuid) from public, anon, authenticated;

grant execute on function public.set_promotion_link_source(uuid, text) to authenticated;
grant execute on function public.get_promotion_link_source(uuid) to authenticated;
grant execute on function public.list_public_promotion_feed() to anon, authenticated;
grant execute on function public.get_public_promotion_content(uuid) to anon, authenticated;

commit;
