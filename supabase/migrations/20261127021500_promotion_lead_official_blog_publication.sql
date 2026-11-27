begin;

create function public.publish_official_blog_link(
  p_blog_post_id text,
  p_title text,
  p_cover_url text default null,
  p_draft_id uuid default null,
  p_draft_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  blog_url text;
  draft public.promotion_contents%rowtype;
  revision public.promotion_content_revisions%rowtype;
  cover_path text;
  media jsonb := '[]'::jsonb;
  saved jsonb;
  published_content_id uuid;
  published_revision_id uuid;
begin
  if actor_id is null or not public.current_user_is_promotion_lead()
      or not ('promotion_lead' = any(public.private_actual_role_codes()))
      or not public.private_actor_can('promotion.queue_publication') then
    raise exception using errcode = '42501', message = 'PROMOTION_BLOG_PUBLISH_FORBIDDEN';
  end if;
  if p_blog_post_id is null or p_blog_post_id !~ '^[0-9]{10,14}$' then
    raise exception using errcode = '22023', message = 'PROMOTION_BLOG_POST_INVALID';
  end if;
  blog_url := 'https://blog.naver.com/taejang-official/' || p_blog_post_id;

  -- Serialize attempts for the same original post, including retries after a lost response.
  perform pg_advisory_xact_lock(hashtextextended(blog_url, 0));
  if p_draft_id is not null then
    select * into draft from public.promotion_contents where id = p_draft_id for update;
    if not found or draft.owner_profile_id <> actor_id then
      raise exception using errcode = '42501', message = 'PROMOTION_BLOG_PUBLISH_FORBIDDEN';
    end if;
    if draft.updated_at is distinct from p_draft_updated_at then
      raise exception using errcode = '40001', message = 'PROMOTION_BLOG_DRAFT_CHANGED';
    end if;
    select * into revision from public.promotion_content_revisions
      where id = draft.current_revision_id and content_id = draft.id for update;
    if not found or revision.author_profile_id <> actor_id
        or draft.lifecycle <> 'draft' or draft.published_at is not null
        or draft.content_type not in ('homepage_article', 'external_content')
        or draft.minimum_review_stage <> 'lead'
        or revision.revision_no <> 1 or revision.locked_at is not null
        or nullif(btrim(revision.public_body), '') is not null
        or revision.byline_kind <> 'company' or revision.number_or_amount <> 'no'
        or revision.requested_publish_date is not null
        or exists (select 1 from public.promotion_review_requests q where q.revision_id = revision.id) then
      raise exception using errcode = '42501', message = 'PROMOTION_BLOG_REQUIRES_REVIEW';
    end if;
  end if;

  if exists (
    select 1 from public.promotion_contents c
    join public.promotion_content_revisions r on r.id = c.current_revision_id
    where c.lifecycle in ('review_pending', 'approved', 'scheduled', 'published', 'hidden')
      and (
        r.external_url ~ ('^https://(m[.])?blog[.]naver[.]com/taejang-official/' || p_blog_post_id || '/?([?#]|$)')
        or (r.external_url ~ '^https://(m[.])?blog[.]naver[.]com/PostView[.]naver[?]'
          and split_part(r.external_url, '#', 1) ~ '[?&]blogId=taejang-official(&|$)'
          and split_part(r.external_url, '#', 1) ~ ('[?&]logNo=' || p_blog_post_id || '(&|$)'))
      )
  ) then
    raise exception using errcode = '23505', message = 'PROMOTION_BLOG_DUPLICATE';
  end if;

  if p_cover_url is not null then
    -- Accept only a single existing promotion-media image, uploaded by this account
    -- under the official import path for this specific post.
    cover_path := substring(p_cover_url from
      '^https://[a-z0-9]+[.]supabase[.]co/storage/v1/object/public/promotion-media/(.+)$');
    if cover_path is null
        or cover_path !~ ('^' || actor_id::text || '/[0-9]{4}-[0-9]{2}-[0-9]{2}/official-blog-'
          || p_blog_post_id || '-[0-9a-f-]{36}[.](jpg|png|webp)$')
        or not exists (
          select 1 from storage.objects o
          where o.bucket_id = 'promotion-media' and o.name = cover_path and o.owner_id = actor_id::text
            and o.metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
        ) then
      raise exception using errcode = '22023', message = 'PROMOTION_BLOG_COVER_INVALID';
    end if;
    media := jsonb_build_array(jsonb_build_object(
      'url', p_cover_url, 'kind', 'selected', 'alt', left(btrim(p_title), 160)
    ));
  end if;

  -- The card links to the official source. The RPC does not take a homepage body.
  saved := public.save_promotion_draft(
    p_content_id => p_draft_id,
    p_content_type => 'external_content',
    p_slug => coalesce(revision.slug, 'taejang-blog-' || p_blog_post_id),
    p_title => p_title,
    p_external_url => blog_url,
    p_source_reference_url => blog_url,
    p_hero_image_url => p_cover_url,
    p_public_media => media,
    p_people_photo => case when p_cover_url is null then 'no'::public.promotion_disclosure_answer
      else 'unsure'::public.promotion_disclosure_answer end,
    p_number_or_amount => 'no',
    p_change_reason => '태장 공식 블로그 링크 즉시 게시'
  );
  published_content_id := (saved->>'content_id')::uuid;
  published_revision_id := (saved->>'revision_id')::uuid;

  update public.promotion_content_revisions set locked_at = now() where id = published_revision_id;
  update public.promotion_contents
  set lifecycle = 'published', link_source_type = 'taejang_blog', published_at = now(), updated_at = now()
  where id = published_content_id;
  perform public.private_append_audit(
    actor_id, 'promotion_official_blog_link_published', 'promotion_content', published_content_id::text,
    'success', '운영팀장 태장 공식 블로그 링크 즉시 게시',
    jsonb_build_object('revision_id', published_revision_id, 'blog_post_id', p_blog_post_id)
  );
  return jsonb_build_object('ok', true, 'content_id', published_content_id,
    'revision_id', published_revision_id, 'lifecycle', 'published');
end;
$$;

alter function public.publish_official_blog_link(text,text,text,uuid,timestamptz) owner to postgres;
revoke all on function public.publish_official_blog_link(text,text,text,uuid,timestamptz) from public, anon;
grant execute on function public.publish_official_blog_link(text,text,text,uuid,timestamptz) to authenticated;

commit;
