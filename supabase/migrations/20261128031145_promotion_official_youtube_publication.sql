begin;

alter table public.promotion_contents add column official_youtube_published_on date;

-- Server-only RPC. The Edge handler verifies the caller with Supabase Auth and
-- supplies the title/date from the official public YouTube watch page.
-- Null source fields request an authorization and duplicate check without a write.
create function public.publish_official_youtube_link(
  p_actor_id uuid, p_video_id text, p_title text default null, p_source_published_on date default null
) returns jsonb
language plpgsql security definer
set search_path = ''
set "request.jwt.claim.sub" = ''
as $$
declare
  saved jsonb;
  content_id uuid;
  revision_id uuid;
  video_url text;
begin
  if p_actor_id is null then
    raise exception using errcode='42501', message='PROMOTION_YOUTUBE_FORBIDDEN';
  end if;
  -- Scoped to this function. Reuse the existing Auth-based permissions,
  -- draft writer and audit identity with the actor verified by the server.
  perform pg_catalog.set_config('request.jwt.claim.sub',p_actor_id::text,true);
  if not public.current_profile_is_active()
    or not public.current_user_is_promotion_lead()
    or not ('promotion_lead' = any(public.private_actual_role_codes()))
    or not public.private_actor_can('promotion.queue_publication') then
    raise exception using errcode='42501', message='PROMOTION_YOUTUBE_FORBIDDEN';
  end if;
  if p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception using errcode='22023', message='PROMOTION_YOUTUBE_INVALID_ID';
  end if;
  video_url := 'https://www.youtube.com/watch?v=' || p_video_id;

  if p_title is not null or p_source_published_on is not null then
    if nullif(btrim(p_title),'') is null or char_length(p_title)>160
      or p_source_published_on is null or p_source_published_on>(now() at time zone 'Asia/Seoul')::date then
      raise exception using errcode='22023', message='PROMOTION_YOUTUBE_INVALID_METADATA';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(video_url,0));
  end if;
  if exists (
    select 1 from public.promotion_contents c
    join public.promotion_content_revisions r on r.id=c.current_revision_id and r.content_id=c.id
    where c.lifecycle in ('review_pending','approved','scheduled','published','hidden')
      and (
        r.external_url ~ ('^https?://((www|m)[.])?youtube[.]com/watch[?]([^#]*&)?v=' || p_video_id || '([&#]|$)')
        or r.external_url ~ ('^https?://(((www|m)[.])?youtube[.]com/(shorts|live|embed)/|youtu[.]be/)' || p_video_id || '/?([?#]|$)')
      )
  ) then
    raise exception using errcode='23505', message='PROMOTION_YOUTUBE_DUPLICATE';
  end if;
  if p_title is null and p_source_published_on is null then
    return jsonb_build_object('ok',true);
  end if;

  saved := public.save_promotion_draft(
    p_content_id => null, p_content_type => 'external_content',
    p_slug => 'taejang-youtube-' || encode(convert_to(p_video_id,'UTF8'),'hex') || '-' || replace(gen_random_uuid()::text,'-',''),
    p_title => p_title,
    p_summary => '태장 공식 유튜브에 게시된 「' || left(p_title,100) || '」 영상입니다.',
    p_external_url => video_url, p_source_reference_url => video_url,
    p_people_photo => 'no', p_number_or_amount => 'no',
    p_change_reason => '태장 공식 유튜브 영상 게시'
  );
  content_id := (saved->>'content_id')::uuid;
  revision_id := (saved->>'revision_id')::uuid;
  update public.promotion_content_revisions set locked_at=now() where id=revision_id;
  update public.promotion_contents
  set lifecycle='published', link_source_type='taejang_youtube', official_youtube_published_on=p_source_published_on,
      published_at=now(), updated_at=now()
  where id=content_id;
  perform public.private_append_audit(
    p_actor_id,'promotion_official_youtube_link_published','promotion_content',content_id::text,
    'success','운영팀장 태장 공식 유튜브 영상 게시',
    jsonb_build_object('revision_id',revision_id,'video_id',p_video_id,'source_published_on',p_source_published_on)
  );
  return jsonb_build_object('ok',true,'content_id',content_id);
end;
$$;
alter function public.publish_official_youtube_link(uuid,text,text,date) owner to postgres;
revoke all on function public.publish_official_youtube_link(uuid,text,text,date) from public,anon,authenticated;
grant execute on function public.publish_official_youtube_link(uuid,text,text,date) to service_role;

drop function public.list_public_promotion_feed();
create function public.list_public_promotion_feed()
returns table(content_id uuid,content_type text,slug text,title text,summary text,external_url text,
  byline text,related_organization text,hero_image_url text,public_media jsonb,link_source_type text,
  published_at timestamptz,published_date text,editorial_slot smallint,official_youtube_published_on date)
language plpgsql security definer set search_path='' as $$
begin
  perform public.private_publish_due_promotions();
  return query select c.id,c.content_type::text,r.slug,r.title,r.summary,r.external_url,r.byline,
    r.related_organization,r.hero_image_url,r.public_media,c.link_source_type,c.published_at,
    to_char(c.published_at at time zone 'Asia/Seoul','YYYY-MM-DD'),
    case when c.content_type='homepage_article' and nullif(btrim(r.external_url),'') is null
      then c.editorial_slot else null::smallint end,c.official_youtube_published_on
  from public.promotion_contents c join public.promotion_content_revisions r on r.id=c.current_revision_id
  where c.lifecycle='published' and c.published_at is not null
  order by c.published_at desc,c.id;
end; $$;
alter function public.list_public_promotion_feed() owner to postgres;
revoke all on function public.list_public_promotion_feed() from public,anon,authenticated;
grant execute on function public.list_public_promotion_feed() to anon,authenticated;

commit;
