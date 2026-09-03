-- Phase C field-pilot live publication controls.
-- Approved promotion content becomes publicly readable immediately through a
-- public-safe allow-listed RPC. Promotion leads may hide/restore and request
-- deletion; only operations_manager may permanently delete content.

begin;

alter table public.promotion_contents
  add column if not exists published_at timestamptz;

create table if not exists public.promotion_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  content_id uuid references public.promotion_contents(id) on delete set null,
  content_title text not null check (char_length(content_title) between 1 and 160),
  requested_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (char_length(reason) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending', 'rejected', 'deleted')),
  decided_by_profile_id uuid references public.profiles(id) on delete restrict,
  decision_comment text check (char_length(coalesce(decision_comment, '')) <= 1000),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (
    (status = 'pending' and decided_by_profile_id is null and decided_at is null)
    or (status <> 'pending' and decided_by_profile_id is not null and decided_at is not null)
  )
);

create unique index if not exists promotion_deletion_requests_one_pending_idx
  on public.promotion_deletion_requests (content_id)
  where status = 'pending' and content_id is not null;

create index if not exists promotion_deletion_requests_status_idx
  on public.promotion_deletion_requests (status, created_at desc);

create or replace function public.private_publish_approved_promotion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lifecycle = 'approved'::public.promotion_lifecycle
     and old.lifecycle is distinct from new.lifecycle then
    update public.promotion_contents
    set lifecycle = 'published',
        published_at = coalesce(published_at, now()),
        updated_at = now()
    where id = new.id;

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
  return null;
end;
$$;

drop trigger if exists promotion_contents_publish_after_approval on public.promotion_contents;
create trigger promotion_contents_publish_after_approval
after update of lifecycle on public.promotion_contents
for each row
when (new.lifecycle = 'approved'::public.promotion_lifecycle)
execute function public.private_publish_approved_promotion();

-- Promote any already-final-approved staging rows into the same live lifecycle.
update public.promotion_contents content
set lifecycle = 'published',
    published_at = coalesce(content.published_at, now()),
    updated_at = now()
where content.lifecycle = 'approved'
  and content.current_revision_id is not null
  and exists (
    select 1
    from public.promotion_review_requests review
    where review.revision_id = content.current_revision_id
      and review.stage = 'lead'
      and review.decision = 'approved'
  )
  and (
    content.minimum_review_stage < 'operations'::public.promotion_review_stage
    or exists (
      select 1
      from public.promotion_review_requests review
      where review.revision_id = content.current_revision_id
        and review.stage = 'operations'
        and review.decision = 'approved'
    )
  )
  and (
    content.minimum_review_stage < 'ceo'::public.promotion_review_stage
    or exists (
      select 1
      from public.promotion_review_requests review
      where review.revision_id = content.current_revision_id
        and review.stage = 'ceo'
        and review.decision = 'approved'
    )
  );

create or replace function public.list_public_promotion_feed()
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
  published_at timestamptz,
  published_date text
)
language sql
stable
security definer
set search_path = ''
as $$
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
    content.published_at,
    to_char(content.published_at at time zone 'Asia/Seoul', 'YYYY-MM-DD')
  from public.promotion_contents content
  join public.promotion_content_revisions revision on revision.id = content.current_revision_id
  where content.lifecycle = 'published'
    and content.published_at is not null
  order by content.published_at desc, content.id;
$$;

create or replace function public.get_public_promotion_content(p_content_id uuid)
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
  published_at timestamptz,
  published_date text
)
language sql
stable
security definer
set search_path = ''
as $$
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
    content.published_at,
    to_char(content.published_at at time zone 'Asia/Seoul', 'YYYY-MM-DD')
  from public.promotion_contents content
  join public.promotion_content_revisions revision on revision.id = content.current_revision_id
  where content.id = p_content_id
    and content.lifecycle = 'published'
    and content.published_at is not null
  limit 1;
$$;

create or replace function public.get_promotion_publication_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_lead boolean;
  actor_is_operations boolean;
  items jsonb := '[]'::jsonb;
  requests jsonb := '[]'::jsonb;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'PROMOTION_PUBLICATION_ADMIN_FORBIDDEN';
  end if;

  actor_is_lead := public.current_user_is_promotion_lead();
  actor_is_operations := public.current_user_has_role('operations_manager');
  if not actor_is_lead and not actor_is_operations then
    raise exception using errcode = '42501', message = 'PROMOTION_PUBLICATION_ADMIN_FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'content_id', content.id,
    'title', revision.title,
    'content_type', content.content_type::text,
    'lifecycle', content.lifecycle::text,
    'published_at', content.published_at,
    'hero_image_url', revision.hero_image_url,
    'external_url', revision.external_url,
    'pending_delete_request', exists (
      select 1 from public.promotion_deletion_requests request
      where request.content_id = content.id and request.status = 'pending'
    )
  ) order by content.published_at desc nulls last, content.updated_at desc), '[]'::jsonb)
  into items
  from public.promotion_contents content
  join public.promotion_content_revisions revision on revision.id = content.current_revision_id
  where content.lifecycle in ('published', 'hidden');

  select coalesce(jsonb_agg(jsonb_build_object(
    'request_id', request.id,
    'content_id', request.content_id,
    'content_title', request.content_title,
    'reason', request.reason,
    'status', request.status,
    'created_at', request.created_at,
    'decision_comment', request.decision_comment
  ) order by request.created_at desc), '[]'::jsonb)
  into requests
  from public.promotion_deletion_requests request
  where (actor_is_operations and request.status = 'pending')
     or (actor_is_lead and request.requested_by_profile_id = actor_id and request.status in ('pending', 'rejected'));

  return jsonb_build_object(
    'role', case when actor_is_operations then 'operations_manager' else 'promotion_lead' end,
    'items', items,
    'deletion_requests', requests
  );
end;
$$;

create or replace function public.set_promotion_visibility(
  p_content_id uuid,
  p_visible boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  target_lifecycle public.promotion_lifecycle;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (public.current_user_is_promotion_lead() or public.current_user_has_role('operations_manager')) then
    raise exception using errcode = '42501', message = 'PROMOTION_VISIBILITY_FORBIDDEN';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = '22023', message = 'PROMOTION_VISIBILITY_REASON_REQUIRED';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;

  if p_visible then
    if content_row.lifecycle <> 'hidden' then
      raise exception using errcode = '22023', message = 'PROMOTION_RESTORE_REQUIRES_HIDDEN';
    end if;
    target_lifecycle := 'published';
  else
    if content_row.lifecycle <> 'published' then
      raise exception using errcode = '22023', message = 'PROMOTION_HIDE_REQUIRES_PUBLISHED';
    end if;
    target_lifecycle := 'hidden';
  end if;

  update public.promotion_contents
  set lifecycle = target_lifecycle,
      published_at = coalesce(published_at, now()),
      updated_at = now()
  where id = content_row.id;

  perform public.private_append_audit(
    actor_id,
    case when p_visible then 'promotion_restored' else 'promotion_hidden' end,
    'promotion_content',
    content_row.id::text,
    'success',
    left(btrim(p_reason), 300),
    jsonb_build_object('from_lifecycle', content_row.lifecycle::text, 'to_lifecycle', target_lifecycle::text)
  );

  return jsonb_build_object('ok', true, 'code', case when p_visible then 'PROMOTION_RESTORED' else 'PROMOTION_HIDDEN' end, 'lifecycle', target_lifecycle::text);
end;
$$;

create or replace function public.request_promotion_deletion(
  p_content_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  content_title text;
  request_id uuid;
begin
  if actor_id is null or not public.current_user_is_promotion_lead() then
    raise exception using errcode = '42501', message = 'PROMOTION_DELETE_REQUEST_FORBIDDEN';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = '22023', message = 'PROMOTION_DELETE_REQUEST_REASON_REQUIRED';
  end if;

  select * into content_row from public.promotion_contents where id = p_content_id for update;
  if not found or content_row.lifecycle not in ('published', 'hidden') then
    raise exception using errcode = '22023', message = 'PROMOTION_DELETE_REQUEST_INVALID_CONTENT';
  end if;
  select title into content_title from public.promotion_content_revisions where id = content_row.current_revision_id;

  insert into public.promotion_deletion_requests (
    content_id, content_title, requested_by_profile_id, reason
  ) values (
    content_row.id, content_title, actor_id, left(btrim(p_reason), 1000)
  ) returning id into request_id;

  perform public.private_append_audit(
    actor_id, 'promotion_deletion_requested', 'promotion_content', content_row.id::text,
    'success', left(btrim(p_reason), 300), jsonb_build_object('request_id', request_id)
  );

  return jsonb_build_object('ok', true, 'code', 'PROMOTION_DELETION_REQUESTED', 'request_id', request_id);
end;
$$;

create or replace function public.reject_promotion_deletion_request(
  p_request_id uuid,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  request_row public.promotion_deletion_requests%rowtype;
begin
  if actor_id is null or not public.current_profile_is_active() or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'PROMOTION_DELETE_REQUEST_DECISION_FORBIDDEN';
  end if;
  if p_comment is null or btrim(p_comment) = '' then
    raise exception using errcode = '22023', message = 'PROMOTION_DELETE_REQUEST_COMMENT_REQUIRED';
  end if;

  select * into request_row
  from public.promotion_deletion_requests
  where id = p_request_id and status = 'pending'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_DELETE_REQUEST_NOT_FOUND';
  end if;

  update public.promotion_deletion_requests
  set status = 'rejected',
      decided_by_profile_id = actor_id,
      decision_comment = left(btrim(p_comment), 1000),
      decided_at = now()
  where id = request_row.id;

  perform public.private_append_audit(
    actor_id, 'promotion_deletion_request_rejected', 'promotion_deletion_request', request_row.id::text,
    'success', left(btrim(p_comment), 300), jsonb_build_object('content_id', request_row.content_id)
  );

  return jsonb_build_object('ok', true, 'code', 'PROMOTION_DELETION_REQUEST_REJECTED');
end;
$$;

create or replace function public.delete_promotion_content(
  p_content_id uuid,
  p_confirm_title text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  content_title text;
begin
  if actor_id is null or not public.current_profile_is_active() or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'PROMOTION_PERMANENT_DELETE_FORBIDDEN';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = '22023', message = 'PROMOTION_PERMANENT_DELETE_REASON_REQUIRED';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;

  select title into content_title
  from public.promotion_content_revisions
  where id = content_row.current_revision_id;

  if content_title is null or btrim(coalesce(p_confirm_title, '')) <> content_title then
    raise exception using errcode = '22023', message = 'PROMOTION_PERMANENT_DELETE_TITLE_CONFIRMATION_MISMATCH';
  end if;

  perform public.private_append_audit(
    actor_id, 'promotion_content_permanently_deleted', 'promotion_content', content_row.id::text,
    'success', left(btrim(p_reason), 300),
    jsonb_build_object('title', content_title, 'previous_lifecycle', content_row.lifecycle::text, 'revision_id', content_row.current_revision_id)
  );

  update public.promotion_deletion_requests
  set status = 'deleted',
      decided_by_profile_id = actor_id,
      decision_comment = left(btrim(p_reason), 1000),
      decided_at = now()
  where content_id = content_row.id and status = 'pending';

  delete from public.promotion_publication_queue
  where revision_id in (select id from public.promotion_content_revisions where content_id = content_row.id);

  delete from public.promotion_review_requests
  where revision_id in (select id from public.promotion_content_revisions where content_id = content_row.id);

  update public.promotion_contents set current_revision_id = null where id = content_row.id;
  delete from public.promotion_content_revisions where content_id = content_row.id;
  delete from public.promotion_contents where id = content_row.id;

  return jsonb_build_object('ok', true, 'code', 'PROMOTION_CONTENT_PERMANENTLY_DELETED');
end;
$$;

alter table public.promotion_deletion_requests enable row level security;

alter function public.private_publish_approved_promotion() owner to postgres;
alter function public.list_public_promotion_feed() owner to postgres;
alter function public.get_public_promotion_content(uuid) owner to postgres;
alter function public.get_promotion_publication_admin() owner to postgres;
alter function public.set_promotion_visibility(uuid, boolean, text) owner to postgres;
alter function public.request_promotion_deletion(uuid, text) owner to postgres;
alter function public.reject_promotion_deletion_request(uuid, text) owner to postgres;
alter function public.delete_promotion_content(uuid, text, text) owner to postgres;

revoke all on table public.promotion_deletion_requests from public, anon, authenticated;

revoke all on function
  public.private_publish_approved_promotion(),
  public.list_public_promotion_feed(),
  public.get_public_promotion_content(uuid),
  public.get_promotion_publication_admin(),
  public.set_promotion_visibility(uuid, boolean, text),
  public.request_promotion_deletion(uuid, text),
  public.reject_promotion_deletion_request(uuid, text),
  public.delete_promotion_content(uuid, text, text)
from public, anon, authenticated;

grant execute on function
  public.list_public_promotion_feed(),
  public.get_public_promotion_content(uuid)
to anon, authenticated;

grant execute on function
  public.get_promotion_publication_admin(),
  public.set_promotion_visibility(uuid, boolean, text),
  public.request_promotion_deletion(uuid, text),
  public.reject_promotion_deletion_request(uuid, text),
  public.delete_promotion_content(uuid, text, text)
to authenticated;

commit;
