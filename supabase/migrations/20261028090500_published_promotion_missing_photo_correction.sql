-- Issue #542: one-time, approval-preserving correction for already-published posts
-- whose approved media list is empty. No update to previous revisions or review rows.
-- This is a candidate migration: DO NOT apply to live/production data without approval.
begin;

create function public.private_can_operations_add_missing_promotion_photo(p_content_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and public.current_profile_is_active()
    and public.current_user_has_role('operations_manager')
    and public.private_actor_can('promotion.review_public_change')
    and exists (
      select 1
      from public.promotion_contents c
      join public.promotion_content_revisions r on r.id=c.current_revision_id and r.content_id=c.id
      where c.id=p_content_id
        and c.lifecycle='published'
        and c.published_at is not null
        and jsonb_typeof(r.public_media)='array'
        and jsonb_array_length(r.public_media)=0
        and greatest(c.minimum_review_stage,
          public.promotion_required_stage(c.content_type,r.byline_kind,r.number_or_amount))
          < 'ceo'::public.promotion_review_stage
        and not exists (
          select 1 from public.promotion_review_requests q
          join public.promotion_content_revisions qr on qr.id=q.revision_id
          where qr.content_id=c.id and q.stage='ceo'
        )
    );
$$;
revoke all on function public.private_can_operations_add_missing_promotion_photo(uuid) from public,anon,authenticated;

create function public.get_operations_missing_promotion_photo(p_content_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare details jsonb;
begin
  if not public.private_can_operations_add_missing_promotion_photo(p_content_id) then
    raise exception using errcode='42501',message='PROMOTION_MISSING_PHOTO_EDIT_FORBIDDEN';
  end if;
  select jsonb_build_object(
    'content_id',c.id,'revision_id',r.id,'title',r.title,
    'external_url',r.external_url,'link_source_type',c.link_source_type,
    'published_at',c.published_at,'public_media_count',jsonb_array_length(r.public_media)
  ) into details
  from public.promotion_contents c
  join public.promotion_content_revisions r on r.id=c.current_revision_id and r.content_id=c.id
  where c.id=p_content_id;
  return details;
end; $$;

create function public.operations_add_missing_promotion_photo(
  p_content_id uuid, p_expected_revision_id uuid,
  p_photo_url text, p_photo_alt text, p_reason text, p_confirm_source boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor_id uuid:=auth.uid();
  c public.promotion_contents%rowtype;
  old_r public.promotion_content_revisions%rowtype;
  new_r public.promotion_content_revisions%rowtype;
  next_no integer;
  photo_url text:=btrim(coalesce(p_photo_url,''));
  photo_alt text:=coalesce(nullif(btrim(p_photo_alt),''),'태장 홍보글 사진');
  reason text:=nullif(btrim(p_reason),'');
  storage_path text;
  media jsonb;
begin
  if actor_id is null or not public.current_profile_is_active()
      or not public.current_user_has_role('operations_manager')
      or not public.private_actor_can('promotion.review_public_change') then
    raise exception using errcode='42501',message='PROMOTION_MISSING_PHOTO_EDIT_FORBIDDEN';
  end if;
  if p_confirm_source is distinct from true then
    raise exception using errcode='22023',message='PROMOTION_PHOTO_SOURCE_CONFIRM_REQUIRED';
  end if;
  if reason is null or length(reason)>300 then
    raise exception using errcode='22023',message='PROMOTION_PHOTO_CHANGE_REASON_REQUIRED';
  end if;
  if length(photo_alt)>300 or photo_url='' or length(photo_url)>1500 then
    raise exception using errcode='22023',message='PROMOTION_PHOTO_INVALID_INPUT';
  end if;

  select * into c from public.promotion_contents where id=p_content_id for update;
  if not found then
    raise exception using errcode='P0002',message='PROMOTION_CONTENT_NOT_FOUND';
  end if;
  if p_expected_revision_id is null or c.current_revision_id is distinct from p_expected_revision_id then
    raise exception using errcode='40001',message='PROMOTION_PUBLIC_EDIT_REVISION_CONFLICT';
  end if;
  if not public.private_can_operations_add_missing_promotion_photo(c.id) then
    raise exception using errcode='42501',message='PROMOTION_MISSING_PHOTO_EDIT_FORBIDDEN';
  end if;

  select * into old_r from public.promotion_content_revisions
    where id=c.current_revision_id and content_id=c.id for update;
  if not found then
    raise exception using errcode='P0002',message='PROMOTION_REVISION_NOT_FOUND';
  end if;

  -- The pre-reviewed first-store opening ceremony asset is limited to that
  -- specific existing story. Other corrections require an authenticated
  -- promotion-media upload owned by the operations manager.
  if photo_url='https://taejang.co.kr/assets/images/archive/opening-ceremony.webp'
      and c.id='76000275-af2c-4484-802a-bb84fec2956c'::uuid then
    null; -- existing approved public asset, no third-party hotlink
  else
    storage_path:=substring(photo_url from
      '^https://jgsxpdflgkqroecfjzxq[.]supabase[.]co/storage/v1/object/public/promotion-media/(.+)$');
    if storage_path is null
       or storage_path !~ '^[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[A-Za-z0-9-]+[.](jpg|jpeg|png|webp)$'
       or split_part(storage_path,'/',1)<>actor_id::text
       or not exists (
         select 1 from storage.objects o
         where o.bucket_id='promotion-media' and o.name=storage_path
           and o.metadata->>'mimetype' in ('image/jpeg','image/png','image/webp')
           and coalesce((o.metadata->>'size')::bigint,0)>0
           and coalesce((o.metadata->>'size')::bigint,0)<=8388608
       ) then
      raise exception using errcode='22023',message='PROMOTION_PHOTO_NOT_APPROVED_STORAGE';
    end if;
  end if;
  media:=jsonb_build_array(jsonb_build_object('url',photo_url,'kind','selected','alt',photo_alt));
  perform public.promotion_validate_public_media(media);
  select coalesce(max(revision_no),0)+1 into next_no
    from public.promotion_content_revisions where content_id=c.id;
  insert into public.promotion_content_revisions (
    content_id,revision_no,author_profile_id,slug,title,summary,public_body,
    external_url,byline,byline_kind,related_organization,source_reference_url,
    hero_image_url,public_media,people_photo,number_or_amount,
    requested_publish_date,change_reason,submitted_at,locked_at,operations_owned_publication
  ) values (
    c.id,next_no,actor_id,old_r.slug,old_r.title,old_r.summary,old_r.public_body,
    old_r.external_url,old_r.byline,old_r.byline_kind,old_r.related_organization,old_r.source_reference_url,
    photo_url,media,'unsure'::public.promotion_disclosure_answer,old_r.number_or_amount,
    old_r.requested_publish_date,left(reason,300),now(),now(),old_r.operations_owned_publication
  ) returning * into new_r;
  update public.promotion_contents
    set current_revision_id=new_r.id,updated_at=now()
    where id=c.id;
  perform public.private_append_audit(
    actor_id,'promotion_missing_photo_corrected','promotion_content',c.id::text,
    'success',left(reason,300),
    jsonb_build_object(
      'from_revision_id',old_r.id,'to_revision_id',new_r.id,
      'photo_url',photo_url,'source_confirmed',true,
      'published_at',c.published_at,'lifecycle',c.lifecycle
    )
  );
  return jsonb_build_object('ok',true,'content_id',c.id,
    'revision_id',new_r.id,'photo_url',photo_url,'published_at',c.published_at);
end; $$;

-- Keep the existing canonical publication-admin RPC and its permission boundary.
-- Add only the button eligibility bit to the existing payload.
create or replace function public.get_promotion_publication_admin()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; items jsonb;
begin
  result:=public.private_get_promotion_publication_admin_before_text_edit();
  select coalesce(jsonb_agg(item || jsonb_build_object(
    'can_operations_edit_text',
      public.private_can_operations_edit_public_promotion((item->>'content_id')::uuid),
    'can_operations_add_missing_photo',
      public.private_can_operations_add_missing_promotion_photo((item->>'content_id')::uuid)
  ) order by ord),'[]'::jsonb) into items
  from jsonb_array_elements(result->'items') with ordinality as source(item,ord);
  return jsonb_set(result,'{items}',items);
end; $$;

revoke all on function public.get_operations_missing_promotion_photo(uuid),
  public.operations_add_missing_promotion_photo(uuid,uuid,text,text,text,boolean),
  public.get_promotion_publication_admin() from public,anon;
grant execute on function public.get_operations_missing_promotion_photo(uuid),
  public.operations_add_missing_promotion_photo(uuid,uuid,text,text,text,boolean),
  public.get_promotion_publication_admin() to authenticated;

commit;
