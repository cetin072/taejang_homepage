-- Issue #146: operations-manager draft superset and safe public-history recovery.
begin;

create or replace function public.save_operations_promotion_draft(
  p_content_id uuid default null, p_content_type public.promotion_content_type default 'homepage_article',
  p_slug text default null, p_title text default null, p_summary text default null,
  p_public_body text default null, p_external_url text default null, p_byline text default null,
  p_byline_kind public.promotion_byline_kind default 'company', p_related_organization text default null,
  p_source_reference_url text default null, p_hero_image_url text default null,
  p_public_media jsonb default '[]'::jsonb, p_people_photo public.promotion_disclosure_answer default 'unsure',
  p_number_or_amount public.promotion_disclosure_answer default 'unsure', p_requested_publish_date date default null,
  p_change_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid(); content_row public.promotion_contents%rowtype;
  revision_row public.promotion_content_revisions%rowtype; promotion_department_id uuid;
  next_revision_no integer; editing_other_owner boolean := false;
begin
  if actor_id is null or not public.current_profile_is_active() or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'OPERATIONS_PROMOTION_DRAFT_FORBIDDEN';
  end if;
  if p_title is null or btrim(p_title) = '' then raise exception using errcode = '22023', message = 'PROMOTION_TITLE_REQUIRED'; end if;
  perform public.promotion_validate_url(p_external_url, 'external_url');
  perform public.promotion_validate_url(p_source_reference_url, 'source_reference_url');
  perform public.promotion_validate_url(p_hero_image_url, 'hero_image_url');
  perform public.promotion_validate_public_media(p_public_media);
  if p_content_id is null then
    select id into promotion_department_id from public.departments where code = 'promotion' and active;
    if promotion_department_id is null then raise exception using errcode = '23514', message = 'PROMOTION_DEPARTMENT_MISSING'; end if;
    insert into public.promotion_contents(department_id, owner_profile_id, assignee_profile_id, content_type)
    values (promotion_department_id, actor_id, actor_id, p_content_type) returning * into content_row;
    next_revision_no := 1;
  else
    select * into content_row from public.promotion_contents where id = p_content_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND'; end if;
    if content_row.lifecycle in ('published', 'hidden', 'archived') then
      raise exception using errcode = '55000', message = 'OPERATIONS_PROMOTION_PUBLISHED_IMMUTABLE';
    end if;
    editing_other_owner := content_row.owner_profile_id <> actor_id;
    select * into revision_row from public.promotion_content_revisions where id = content_row.current_revision_id for update;
    if not editing_other_owner and found and revision_row.locked_at is null then
      update public.promotion_content_revisions set slug=p_slug, title=btrim(p_title), summary=nullif(btrim(coalesce(p_summary,'')),''),
        public_body=nullif(btrim(coalesce(p_public_body,'')),''), external_url=nullif(btrim(coalesce(p_external_url,'')),''),
        byline=nullif(btrim(coalesce(p_byline,'')),''), byline_kind=p_byline_kind,
        related_organization=nullif(btrim(coalesce(p_related_organization,'')),''),
        source_reference_url=nullif(btrim(coalesce(p_source_reference_url,'')),''), hero_image_url=nullif(btrim(coalesce(p_hero_image_url,'')),''),
        public_media=p_public_media, people_photo=p_people_photo, number_or_amount=p_number_or_amount,
        requested_publish_date=p_requested_publish_date, change_reason=nullif(btrim(coalesce(p_change_reason,'')),'')
      where id=revision_row.id;
      update public.promotion_contents set content_type=p_content_type, lifecycle='draft', updated_at=now() where id=content_row.id;
      perform public.private_append_audit(actor_id,'operations_promotion_draft_updated','promotion_content',content_row.id::text,'success','운영총괄 홍보 초안 저장',jsonb_build_object('revision_no',revision_row.revision_no));
      return jsonb_build_object('ok',true,'code','PROMOTION_DRAFT_SAVED','content_id',content_row.id,'revision_id',revision_row.id,'revision_no',revision_row.revision_no);
    end if;
    select coalesce(max(revision_no),0)+1 into next_revision_no from public.promotion_content_revisions where content_id=content_row.id;
  end if;
  insert into public.promotion_content_revisions(content_id,revision_no,author_profile_id,slug,title,summary,public_body,external_url,byline,byline_kind,related_organization,source_reference_url,hero_image_url,public_media,people_photo,number_or_amount,requested_publish_date,change_reason)
  values(content_row.id,next_revision_no,actor_id,p_slug,btrim(p_title),nullif(btrim(coalesce(p_summary,'')),''),nullif(btrim(coalesce(p_public_body,'')),''),nullif(btrim(coalesce(p_external_url,'')),''),nullif(btrim(coalesce(p_byline,'')),''),p_byline_kind,nullif(btrim(coalesce(p_related_organization,'')),''),nullif(btrim(coalesce(p_source_reference_url,'')),''),nullif(btrim(coalesce(p_hero_image_url,'')),''),p_public_media,p_people_photo,p_number_or_amount,p_requested_publish_date,nullif(btrim(coalesce(p_change_reason,'')),'')) returning * into revision_row;
  update public.promotion_contents set content_type=p_content_type,current_revision_id=revision_row.id,lifecycle='draft',updated_at=now() where id=content_row.id;
  perform public.private_append_audit(actor_id,case when editing_other_owner then 'operations_promotion_draft_edited_for_owner' else 'operations_promotion_draft_created' end,'promotion_content',content_row.id::text,'success','운영총괄 홍보 초안 저장',jsonb_build_object('revision_no',revision_row.revision_no,'owner_profile_id',content_row.owner_profile_id,'editor_profile_id',actor_id));
  return jsonb_build_object('ok',true,'code','PROMOTION_DRAFT_SAVED','content_id',content_row.id,'revision_id',revision_row.id,'revision_no',revision_row.revision_no);
end;
$$;

create or replace function public.restore_promotion_content(p_content_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 actor_id uuid := auth.uid(); content_row public.promotion_contents%rowtype; snapshot jsonb;
 previous_lifecycle text; restored_lifecycle public.promotion_lifecycle; normalized_reason text := nullif(btrim(p_reason),'');
 item jsonb; restore_revision_id uuid; restore_review_stage public.promotion_review_stage;
 restore_requested_by uuid; restore_scheduled_for timestamptz; restore_queued_by uuid;
begin
 if actor_id is null or not public.current_profile_is_active() or not public.current_user_has_role('operations_manager') then raise exception using errcode='42501',message='PROMOTION_RESTORE_FORBIDDEN'; end if;
 if normalized_reason is null then raise exception using errcode='22023',message='PROMOTION_RESTORE_REASON_REQUIRED'; end if;
 select * into content_row from public.promotion_contents where id=p_content_id for update;
 if not found then raise exception using errcode='P0002',message='PROMOTION_CONTENT_NOT_FOUND'; end if;
 if content_row.lifecycle <> 'archived' then return jsonb_build_object('ok',true,'code','PROMOTION_CONTENT_NOT_ARCHIVED'); end if;
 snapshot:=coalesce(content_row.archive_snapshot,'{}'::jsonb); previous_lifecycle:=nullif(snapshot->>'previous_lifecycle','');
 if previous_lifecycle is null or previous_lifecycle='archived' then raise exception using errcode='55000',message='PROMOTION_RESTORE_SNAPSHOT_INVALID'; end if;
 restored_lifecycle := case when previous_lifecycle in ('published','hidden') then 'hidden'::public.promotion_lifecycle else previous_lifecycle::public.promotion_lifecycle end;
 update public.promotion_contents set lifecycle=restored_lifecycle,published_at=nullif(snapshot->>'published_at','')::timestamptz,archive_snapshot='{}'::jsonb,updated_at=now() where id=content_row.id;
 for item in select value from jsonb_array_elements(coalesce(snapshot->'pending_reviews','[]'::jsonb)) loop
   restore_revision_id:=nullif(item->>'revision_id','')::uuid; restore_review_stage:=nullif(item->>'stage','')::public.promotion_review_stage; restore_requested_by:=nullif(item->>'requested_by_profile_id','')::uuid;
   if restore_revision_id is not null and restore_review_stage is not null and restore_requested_by is not null
      and exists(select 1 from public.promotion_content_revisions revision where revision.id=restore_revision_id and revision.content_id=content_row.id)
      and not exists(select 1 from public.promotion_review_requests review where review.revision_id=restore_revision_id and review.stage=restore_review_stage and review.decision='pending') then
      insert into public.promotion_review_requests(revision_id,stage,requested_by_profile_id) values(restore_revision_id,restore_review_stage,restore_requested_by);
   end if;
 end loop;
 for item in select value from jsonb_array_elements(coalesce(snapshot->'queued_publications','[]'::jsonb)) loop
   restore_revision_id:=nullif(item->>'revision_id','')::uuid; restore_scheduled_for:=nullif(item->>'scheduled_for','')::timestamptz; restore_queued_by:=nullif(item->>'queued_by_profile_id','')::uuid;
   if restore_revision_id is not null and restore_queued_by is not null and exists(select 1 from public.promotion_content_revisions revision where revision.id=restore_revision_id and revision.content_id=content_row.id) then
      update public.promotion_publication_queue queue set status='queued',scheduled_for=restore_scheduled_for,updated_at=now() where queue.revision_id=restore_revision_id;
      if not found then insert into public.promotion_publication_queue(revision_id,queued_by_profile_id,scheduled_for,status) values(restore_revision_id,restore_queued_by,restore_scheduled_for,'queued'); end if;
   end if;
 end loop;
 perform public.private_append_audit(actor_id,'promotion_content_restored','promotion_content',content_row.id::text,'success',left(normalized_reason,300),jsonb_build_object('previous_lifecycle',previous_lifecycle,'restored_lifecycle',restored_lifecycle::text,'revision_id',content_row.current_revision_id,'explicit_republish_required',previous_lifecycle='published'));
 return jsonb_build_object('ok',true,'code','PROMOTION_CONTENT_RESTORED','lifecycle',restored_lifecycle::text,'explicit_republish_required',previous_lifecycle='published');
end;
$$;

revoke all on function public.save_operations_promotion_draft(uuid,public.promotion_content_type,text,text,text,text,text,text,public.promotion_byline_kind,text,text,text,jsonb,public.promotion_disclosure_answer,public.promotion_disclosure_answer,date,text) from public, anon;
revoke all on function public.restore_promotion_content(uuid,text) from public, anon;
grant execute on function public.save_operations_promotion_draft(uuid,public.promotion_content_type,text,text,text,text,text,text,public.promotion_byline_kind,text,text,text,jsonb,public.promotion_disclosure_answer,public.promotion_disclosure_answer,date,text) to authenticated;
grant execute on function public.restore_promotion_content(uuid,text) to authenticated;
commit;
