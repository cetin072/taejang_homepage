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
as $$
declare
  promotion_department_id uuid;
  content_id uuid;
  revision_id uuid;
  video_url text;
begin
  select d.id into promotion_department_id
  from public.profiles p
  join public.departments d on d.id=p.department_id and d.code='promotion' and d.active
  join public.profile_roles a on a.profile_id=p.id and a.revoked_at is null
  join public.roles r on r.id=a.role_id and r.code='promotion_lead' and r.active
  join public.role_capability_grants g on g.role_id=r.id and g.capability_code='promotion.queue_publication'
  join public.platform_capabilities k on k.code=g.capability_code and k.active
  where p.id=p_actor_id and p.account_status='active'
    and not exists (
      select 1 from public.role_simulation_modes s
      where s.profile_id=p.id and s.expires_at>now()
    );
  if promotion_department_id is null then
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

  insert into public.promotion_contents (department_id,owner_profile_id,assignee_profile_id,content_type)
  values (promotion_department_id,p_actor_id,p_actor_id,'external_content')
  returning id into content_id;
  insert into public.promotion_content_revisions (
    content_id,revision_no,author_profile_id,slug,title,summary,external_url,source_reference_url,
    people_photo,number_or_amount,change_reason,locked_at
  ) values (
    content_id,1,p_actor_id,'taejang-youtube-' || replace(content_id::text,'-',''),btrim(p_title),
    '태장 공식 유튜브에 게시된 「' || left(btrim(p_title),100) || '」 영상입니다.',video_url,video_url,
    'no','no','태장 공식 유튜브 영상 게시',now()
  ) returning id into revision_id;
  update public.promotion_contents
  set current_revision_id=revision_id, lifecycle='published',
      link_source_type='taejang_youtube', official_youtube_published_on=p_source_published_on,
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
