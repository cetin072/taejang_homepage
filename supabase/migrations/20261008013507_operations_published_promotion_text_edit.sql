-- Issue #414: guarded text-only edits preserve publication and all original reviews.
begin;
create function public.private_can_operations_edit_public_promotion(p_content_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.current_profile_is_active()
 and public.current_user_has_role('operations_manager')
 and public.private_actor_can('promotion.review_public_change')
 and exists (
  select 1 from public.promotion_contents c
  join public.promotion_content_revisions r on r.id=c.current_revision_id and r.content_id=c.id
  where c.id=p_content_id and c.lifecycle in ('published','hidden') and c.published_at is not null
  and greatest(c.minimum_review_stage,public.promotion_required_stage(c.content_type,r.byline_kind,r.number_or_amount)) < 'ceo'::public.promotion_review_stage
  and not exists (select 1 from public.promotion_review_requests q join public.promotion_content_revisions qr on qr.id=q.revision_id where qr.content_id=c.id and q.stage='ceo')
  and (c.owner_profile_id=auth.uid() or
    (select q.decided_by_profile_id from public.promotion_review_requests q
     join public.promotion_content_revisions qr on qr.id=q.revision_id
     where qr.content_id=c.id and q.stage='operations' and q.decision='approved'
     order by q.decided_at desc,q.created_at desc,q.id desc limit 1)=auth.uid())
 );
$$;
revoke all on function public.private_can_operations_edit_public_promotion(uuid) from public,anon,authenticated;

create function public.get_operations_public_promotion_edit(p_content_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.private_can_operations_edit_public_promotion(p_content_id) then
  raise exception using errcode='42501',message='PROMOTION_OPERATIONS_PUBLIC_EDIT_FORBIDDEN';
 end if;
 select jsonb_build_object('content_id',c.id,'revision_id',r.id,'title',r.title,'summary',r.summary,'public_body',r.public_body)
 into result from public.promotion_contents c join public.promotion_content_revisions r on r.id=c.current_revision_id where c.id=p_content_id;
 return result;
end; $$;

create function public.operations_update_public_promotion_text(
 p_content_id uuid,p_expected_revision_id uuid,p_title text,p_summary text,p_public_body text,p_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor_id uuid:=auth.uid();
 c public.promotion_contents%rowtype;
 old_r public.promotion_content_revisions%rowtype;
 new_r public.promotion_content_revisions%rowtype;
 next_no integer;
 reason text:=coalesce(nullif(btrim(p_reason),''),'게시 후 문구 정정');
begin
 if actor_id is null or not public.current_profile_is_active()
  or not public.current_user_has_role('operations_manager')
  or not public.private_actor_can('promotion.review_public_change') then
  raise exception using errcode='42501',message='PROMOTION_OPERATIONS_PUBLIC_EDIT_FORBIDDEN';
 end if;
 select * into c from public.promotion_contents where id=p_content_id for update;
 if not found then raise exception using errcode='P0002',message='PROMOTION_CONTENT_NOT_FOUND'; end if;
 if p_expected_revision_id is null or c.current_revision_id is distinct from p_expected_revision_id then
  raise exception using errcode='40001',message='PROMOTION_PUBLIC_EDIT_REVISION_CONFLICT';
 end if;
 if not public.private_can_operations_edit_public_promotion(c.id) then
  raise exception using errcode='42501',message='PROMOTION_OPERATIONS_PUBLIC_EDIT_FORBIDDEN';
 end if;
 if nullif(btrim(p_title),'') is null then
  raise exception using errcode='22023',message='PROMOTION_TITLE_REQUIRED';
 end if;
 select * into old_r from public.promotion_content_revisions where id=c.current_revision_id and content_id=c.id for update;
 select coalesce(max(revision_no),0)+1 into next_no from public.promotion_content_revisions where content_id=c.id;
 insert into public.promotion_content_revisions (
  content_id,revision_no,author_profile_id,slug,title,summary,public_body,
  external_url,byline,byline_kind,related_organization,source_reference_url,hero_image_url,public_media,
  people_photo,number_or_amount,requested_publish_date,change_reason,submitted_at,locked_at,operations_owned_publication
 ) values (
  c.id,next_no,actor_id,old_r.slug,btrim(p_title),nullif(btrim(p_summary),''),nullif(btrim(p_public_body),''),
  old_r.external_url,old_r.byline,old_r.byline_kind,old_r.related_organization,old_r.source_reference_url,
  old_r.hero_image_url,old_r.public_media,old_r.people_photo,old_r.number_or_amount,old_r.requested_publish_date,
  left(reason,300),now(),now(),old_r.operations_owned_publication
 ) returning * into new_r;
 -- Publication/export reads the current locked revision. The prepublication
 -- fully-approved predicate deliberately remains unchanged; no approval is forged.
 update public.promotion_contents set current_revision_id=new_r.id,updated_at=now() where id=c.id;
 perform public.private_append_audit(actor_id,'promotion_operations_public_text_updated','promotion_content',c.id::text,
  'success',left(reason,300),jsonb_build_object('from_revision_id',old_r.id,'to_revision_id',new_r.id,
  'published_at',c.published_at,'lifecycle',c.lifecycle,'changed_fields',jsonb_build_array('title','summary','public_body')));
 return jsonb_build_object('ok',true,'content_id',c.id,'revision_id',new_r.id,'published_at',c.published_at);
end; $$;

alter function public.get_promotion_publication_admin() rename to private_get_promotion_publication_admin_before_text_edit;
revoke all on function public.private_get_promotion_publication_admin_before_text_edit() from public,anon,authenticated;
create function public.get_promotion_publication_admin()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; items jsonb;
begin
 result:=public.private_get_promotion_publication_admin_before_text_edit();
 select coalesce(jsonb_agg(item || jsonb_build_object(
  'can_operations_edit_text',public.private_can_operations_edit_public_promotion((item->>'content_id')::uuid)
 ) order by ord),'[]'::jsonb) into items
 from jsonb_array_elements(result->'items') with ordinality as source(item,ord);
 return jsonb_set(result,'{items}',items);
end; $$;

revoke all on function public.get_operations_public_promotion_edit(uuid),
 public.operations_update_public_promotion_text(uuid,uuid,text,text,text,text),
 public.get_promotion_publication_admin() from public,anon;
grant execute on function public.get_operations_public_promotion_edit(uuid),
 public.operations_update_public_promotion_text(uuid,uuid,text,text,text,text),
 public.get_promotion_publication_admin() to authenticated;
commit;
