-- A user-facing delete removes the article from all public/normal management
-- surfaces but preserves the immutable revision/review history as an archived
-- record. Physical purge is deliberately not exposed to browser roles.

begin;

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
    raise exception using errcode = '42501', message = 'PROMOTION_DELETE_FORBIDDEN';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = '22023', message = 'PROMOTION_DELETE_REASON_REQUIRED';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;
  if content_row.lifecycle not in ('published', 'hidden') then
    raise exception using errcode = '22023', message = 'PROMOTION_DELETE_INVALID_LIFECYCLE';
  end if;

  select title into content_title
  from public.promotion_content_revisions
  where id = content_row.current_revision_id;

  if content_title is null or btrim(coalesce(p_confirm_title, '')) <> content_title then
    raise exception using errcode = '22023', message = 'PROMOTION_DELETE_TITLE_CONFIRMATION_MISMATCH';
  end if;

  update public.promotion_contents
  set lifecycle = 'archived',
      updated_at = now()
  where id = content_row.id;

  update public.promotion_deletion_requests
  set status = 'deleted',
      decided_by_profile_id = actor_id,
      decision_comment = left(btrim(p_reason), 1000),
      decided_at = now()
  where content_id = content_row.id and status = 'pending';

  perform public.private_append_audit(
    actor_id,
    'promotion_content_deleted',
    'promotion_content',
    content_row.id::text,
    'success',
    left(btrim(p_reason), 300),
    jsonb_build_object(
      'title', content_title,
      'previous_lifecycle', content_row.lifecycle::text,
      'new_lifecycle', 'archived',
      'revision_id', content_row.current_revision_id,
      'authority', 'operations_manager+super_admin',
      'recoverable', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PROMOTION_CONTENT_DELETED',
    'recoverable_archive_preserved', true
  );
end;
$$;

alter function public.delete_promotion_content(uuid, text, text) owner to postgres;
revoke all on function public.delete_promotion_content(uuid, text, text) from public, anon, authenticated;
grant execute on function public.delete_promotion_content(uuid, text, text) to authenticated;

commit;
