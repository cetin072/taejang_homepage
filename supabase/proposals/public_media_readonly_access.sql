-- PROPOSAL ONLY: not in migrations, not applied to any hosted database.
-- Generate the versioned migration with `supabase migration new` after CLI recovery.
-- Dedicated unexposed schema: do not grant anonymous access to the existing private schema.
begin;
create schema if not exists public_media_private authorization postgres;
revoke all on schema public_media_private from public, anon, authenticated;
grant usage on schema public_media_private to anon, authenticated;

-- Anonymous callers are intentional: only an exact currently public attachment
-- membership boolean is exposed. No private row, body, metadata or employee data.
-- No publication scheduler, RLS helper or other user function is called.
create or replace function public_media_private.is_current_attachment(p_content_id uuid, p_source_url text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.promotion_contents as content
    join public.promotion_content_revisions as revision
      on revision.id = content.current_revision_id and revision.content_id = content.id
    where content.id = p_content_id
      and content.lifecycle = 'published'
      and content.published_at is not null
      and length(p_source_url) between 1 and 2048
      and revision.public_media @> jsonb_build_array(jsonb_build_object('url', p_source_url))
  );
$$;
alter function public_media_private.is_current_attachment(uuid, text) owner to postgres;
revoke all on function public_media_private.is_current_attachment(uuid, text) from public, anon, authenticated;
grant execute on function public_media_private.is_current_attachment(uuid, text) to anon, authenticated;

-- Public PostgREST entrypoint is invoker, STABLE and GET-capable. Boolean only.
create or replace function public.is_public_promotion_media(p_content_id uuid, p_source_url text)
returns boolean
language sql stable
security invoker
set search_path = ''
as $$
  select public_media_private.is_current_attachment(p_content_id, p_source_url);
$$;
alter function public.is_public_promotion_media(uuid, text) owner to postgres;
revoke all on function public.is_public_promotion_media(uuid, text) from public, anon, authenticated;
grant execute on function public.is_public_promotion_media(uuid, text) to anon, authenticated;
comment on function public.is_public_promotion_media(uuid, text) is
  'Read-only current public attachment membership. Never publishes scheduled content. No permission caching.';
notify pgrst, 'reload schema';
commit;
