-- Editorial selection changes placement only, never publication or approval.
begin;
alter table public.promotion_contents add column editorial_slot smallint
  check (editorial_slot between 1 and 4);
create unique index promotion_editorial_slot_unique on public.promotion_contents(editorial_slot)
  where editorial_slot is not null;

create function public.private_clear_inactive_editorial_slot()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.lifecycle <> 'published' then new.editorial_slot := null; end if;
  return new;
end; $$;
revoke all on function public.private_clear_inactive_editorial_slot() from public,anon,authenticated;
create trigger promotion_clear_inactive_editorial_slot before update of lifecycle
  on public.promotion_contents for each row execute function public.private_clear_inactive_editorial_slot();

create function public.set_promotion_editorial_slot(
  p_content_id uuid, p_slot integer, p_expected_slot integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor_id uuid := auth.uid(); c public.promotion_contents%rowtype;
  occupant_id uuid; external_link text; old_slot integer;
begin
  if actor_id is null or not public.current_profile_is_active()
    or not public.current_user_has_role('operations_manager')
    or not public.private_actor_can('promotion.review_operations') then
    raise exception using errcode='42501',message='PROMOTION_EDITORIAL_FORBIDDEN';
  end if;
  if p_slot is not null and p_slot not between 1 and 4 then
    raise exception using errcode='22023',message='PROMOTION_EDITORIAL_INVALID_SLOT';
  end if;
  -- Serialize selection/reordering across administrators; the unique index is
  -- also an independent database limit of four positions.
  perform pg_catalog.pg_advisory_xact_lock(673,4);
  select * into c from public.promotion_contents where id=p_content_id for update;
  if not found then raise exception using errcode='P0002',message='PROMOTION_CONTENT_NOT_FOUND'; end if;
  if c.editorial_slot is distinct from p_expected_slot then
    raise exception using errcode='40001',message='PROMOTION_EDITORIAL_CONFLICT';
  end if;
  select r.external_url into external_link from public.promotion_content_revisions r
    where r.id=c.current_revision_id and r.content_id=c.id;
  if p_slot is not null and (not found or c.lifecycle <> 'published' or c.published_at is null
    or c.content_type <> 'homepage_article' or nullif(btrim(external_link),'') is not null) then
    raise exception using errcode='22023',message='PROMOTION_EDITORIAL_NOT_PUBLIC_ARTICLE';
  end if;
  old_slot := c.editorial_slot;
  if old_slot is not distinct from p_slot then
    return jsonb_build_object('ok',true,'content_id',c.id,'editorial_slot',old_slot);
  end if;
  select id into occupant_id from public.promotion_contents where editorial_slot=p_slot for update;
  if occupant_id is not null and old_slot is null then
    raise exception using errcode='23505',message='PROMOTION_EDITORIAL_SLOT_OCCUPIED';
  end if;
  -- Temporarily clear the moving article inside this transaction so swaps
  -- satisfy the immediate unique index without exposing an intermediate state.
  update public.promotion_contents set editorial_slot=null where id=c.id;
  if occupant_id is not null then
    update public.promotion_contents set editorial_slot=old_slot,updated_at=now() where id=occupant_id;
  end if;
  update public.promotion_contents set editorial_slot=p_slot,updated_at=now() where id=c.id;
  perform public.private_append_audit(actor_id,'promotion_editorial_slot_changed','promotion_content',c.id::text,
    'success','기획기사 상단 고정·순서 변경',jsonb_build_object('from_slot',old_slot,'to_slot',p_slot,'swapped_content_id',occupant_id));
  return jsonb_build_object('ok',true,'content_id',c.id,'editorial_slot',p_slot,'swapped_content_id',occupant_id);
end; $$;
alter function public.set_promotion_editorial_slot(uuid,integer,integer) owner to postgres;
revoke all on function public.set_promotion_editorial_slot(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.set_promotion_editorial_slot(uuid,integer,integer) to authenticated;

-- Reuse the existing guarded admin listing and its text-edit permissions.
create or replace function public.get_promotion_publication_admin()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; items jsonb;
begin
  result:=public.private_get_promotion_publication_admin_before_text_edit();
  select coalesce(jsonb_agg(item || jsonb_build_object(
    'can_operations_edit_text',public.private_can_operations_edit_public_promotion((item->>'content_id')::uuid),
    'editorial_slot',c.editorial_slot,
    'can_manage_editorial',auth.uid() is not null and public.current_profile_is_active()
      and public.current_user_has_role('operations_manager') and public.private_actor_can('promotion.review_operations')
      and c.lifecycle='published' and c.content_type='homepage_article' and c.published_at is not null
      and nullif(btrim(item->>'external_url'),'') is null
  ) order by ord),'[]'::jsonb) into items
  from jsonb_array_elements(result->'items') with ordinality as source(item,ord)
  join public.promotion_contents c on c.id=(item->>'content_id')::uuid;
  return jsonb_set(result,'{items}',items);
end; $$;
alter function public.get_promotion_publication_admin() owner to postgres;
revoke all on function public.get_promotion_publication_admin() from public,anon;
grant execute on function public.get_promotion_publication_admin() to authenticated;

drop function public.list_public_promotion_feed();
create function public.list_public_promotion_feed()
returns table(content_id uuid,content_type text,slug text,title text,summary text,external_url text,
  byline text,related_organization text,hero_image_url text,public_media jsonb,link_source_type text,
  published_at timestamptz,published_date text,editorial_slot smallint)
language plpgsql security definer set search_path='' as $$
begin
  perform public.private_publish_due_promotions();
  return query select c.id,c.content_type::text,r.slug,r.title,r.summary,r.external_url,r.byline,
    r.related_organization,r.hero_image_url,r.public_media,c.link_source_type,c.published_at,
    to_char(c.published_at at time zone 'Asia/Seoul','YYYY-MM-DD'),
    case when c.content_type='homepage_article' and nullif(btrim(r.external_url),'') is null
      then c.editorial_slot else null::smallint end
  from public.promotion_contents c join public.promotion_content_revisions r on r.id=c.current_revision_id
  where c.lifecycle='published' and c.published_at is not null
  order by c.published_at desc,c.id;
end; $$;
alter function public.list_public_promotion_feed() owner to postgres;
revoke all on function public.list_public_promotion_feed() from public,anon,authenticated;
grant execute on function public.list_public_promotion_feed() to anon,authenticated;

-- Preserve the user's already-selected original when the migration is released.
-- No synthetic content is inserted and no publication state is changed.
update public.promotion_contents c set editorial_slot=1
where c.id='e584c9eb-21bb-4777-8752-f0d36d79cd8d' and c.lifecycle='published'
  and c.published_at is not null and c.content_type='homepage_article'
  and exists(select 1 from public.promotion_content_revisions r where r.id=c.current_revision_id
    and r.content_id=c.id and nullif(btrim(r.external_url),'') is null);
commit;
