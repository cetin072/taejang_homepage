-- Keep live publication compatible with the existing queue/export contract and
-- make permanent deletion require Taejang's highest-authority combination.

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
      and content.lifecycle in (
        'approved'::public.promotion_lifecycle,
        'published'::public.promotion_lifecycle,
        'scheduled'::public.promotion_lifecycle
      )
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
  actor_is_super_admin boolean;
  items jsonb := '[]'::jsonb;
  requests jsonb := '[]'::jsonb;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'PROMOTION_PUBLICATION_ADMIN_FORBIDDEN';
  end if;

  actor_is_lead := public.current_user_is_promotion_lead();
  actor_is_operations := public.current_user_has_role('operations_manager');
  actor_is_super_admin := public.current_user_has_role('super_admin');
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
    'can_permanently_delete', actor_is_operations and actor_is_super_admin,
    'items', items,
    'deletion_requests', requests
  );
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
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager')
     or not public.current_user_has_role('super_admin') then
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
    jsonb_build_object(
      'title', content_title,
      'previous_lifecycle', content_row.lifecycle::text,
      'revision_id', content_row.current_revision_id,
      'authority', 'operations_manager+super_admin'
    )
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

alter function public.promotion_revision_is_fully_approved(uuid, uuid) owner to postgres;
alter function public.get_promotion_publication_admin() owner to postgres;
alter function public.delete_promotion_content(uuid, text, text) owner to postgres;

revoke all on function
  public.promotion_revision_is_fully_approved(uuid, uuid),
  public.get_promotion_publication_admin(),
  public.delete_promotion_content(uuid, text, text)
from public, anon, authenticated;

grant execute on function
  public.get_promotion_publication_admin(),
  public.delete_promotion_content(uuid, text, text)
to authenticated;

commit;
