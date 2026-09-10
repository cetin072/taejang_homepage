-- Issue #148 A: capability gates for the remaining promotion management RPCs.
begin;

alter function public.save_promotion_draft(uuid, public.promotion_content_type, text, text, text, text, text, text, public.promotion_byline_kind, text, text, text, jsonb, public.promotion_disclosure_answer, public.promotion_disclosure_answer, date, text) rename to private_save_promotion_draft_pre148;
alter function public.save_operations_promotion_draft(uuid, public.promotion_content_type, text, text, text, text, text, text, public.promotion_byline_kind, text, text, text, jsonb, public.promotion_disclosure_answer, public.promotion_disclosure_answer, date, text) rename to private_save_operations_promotion_draft_pre148;
alter function public.submit_operations_promotion_revision(uuid) rename to private_submit_operations_promotion_revision_pre148;
alter function public.get_promotion_publication_admin() rename to private_get_promotion_publication_admin_pre148;
alter function public.set_promotion_visibility(uuid, boolean, text) rename to private_set_promotion_visibility_pre148;
alter function public.request_promotion_deletion(uuid, text) rename to private_request_promotion_deletion_pre148;
alter function public.reject_promotion_deletion_request(uuid, text) rename to private_reject_promotion_deletion_request_pre148;
alter function public.archive_unpublished_promotion_content(uuid, text) rename to private_archive_unpublished_promotion_content_pre148;
alter function public.delete_promotion_content(uuid, text, text) rename to private_delete_promotion_content_pre148;
alter function public.restore_promotion_content(uuid, text) rename to private_restore_promotion_content_pre148;

revoke all on function public.private_save_promotion_draft_pre148(uuid, public.promotion_content_type, text, text, text, text, text, text, public.promotion_byline_kind, text, text, text, jsonb, public.promotion_disclosure_answer, public.promotion_disclosure_answer, date, text) from public, anon, authenticated;
revoke all on function public.private_save_operations_promotion_draft_pre148(uuid, public.promotion_content_type, text, text, text, text, text, text, public.promotion_byline_kind, text, text, text, jsonb, public.promotion_disclosure_answer, public.promotion_disclosure_answer, date, text) from public, anon, authenticated;
revoke all on function public.private_submit_operations_promotion_revision_pre148(uuid) from public, anon, authenticated;
revoke all on function public.private_get_promotion_publication_admin_pre148() from public, anon, authenticated;
revoke all on function public.private_set_promotion_visibility_pre148(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.private_request_promotion_deletion_pre148(uuid, text) from public, anon, authenticated;
revoke all on function public.private_reject_promotion_deletion_request_pre148(uuid, text) from public, anon, authenticated;
revoke all on function public.private_archive_unpublished_promotion_content_pre148(uuid, text) from public, anon, authenticated;
revoke all on function public.private_delete_promotion_content_pre148(uuid, text, text) from public, anon, authenticated;
revoke all on function public.private_restore_promotion_content_pre148(uuid, text) from public, anon, authenticated;

create function public.save_promotion_draft(
  p_content_id uuid default null, p_content_type public.promotion_content_type default 'homepage_article',
  p_slug text default null, p_title text default null, p_summary text default null,
  p_public_body text default null, p_external_url text default null, p_byline text default null,
  p_byline_kind public.promotion_byline_kind default 'company', p_related_organization text default null,
  p_source_reference_url text default null, p_hero_image_url text default null,
  p_public_media jsonb default '[]'::jsonb, p_people_photo public.promotion_disclosure_answer default 'unsure',
  p_number_or_amount public.promotion_disclosure_answer default 'unsure', p_requested_publish_date date default null,
  p_change_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.private_actor_can('promotion.write') or not public.private_actor_can('promotion.edit_own') then raise exception using errcode='42501', message='PROMOTION_DRAFT_FORBIDDEN'; end if;
  return public.private_save_promotion_draft_pre148(p_content_id,p_content_type,p_slug,p_title,p_summary,p_public_body,p_external_url,p_byline,p_byline_kind,p_related_organization,p_source_reference_url,p_hero_image_url,p_public_media,p_people_photo,p_number_or_amount,p_requested_publish_date,p_change_reason);
end; $$;

create function public.save_operations_promotion_draft(
  p_content_id uuid default null, p_content_type public.promotion_content_type default 'homepage_article',
  p_slug text default null, p_title text default null, p_summary text default null,
  p_public_body text default null, p_external_url text default null, p_byline text default null,
  p_byline_kind public.promotion_byline_kind default 'company', p_related_organization text default null,
  p_source_reference_url text default null, p_hero_image_url text default null,
  p_public_media jsonb default '[]'::jsonb, p_people_photo public.promotion_disclosure_answer default 'unsure',
  p_number_or_amount public.promotion_disclosure_answer default 'unsure', p_requested_publish_date date default null,
  p_change_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.private_actor_can('promotion.edit_any_unpublished') then raise exception using errcode='42501', message='OPERATIONS_PROMOTION_DRAFT_FORBIDDEN'; end if;
  return public.private_save_operations_promotion_draft_pre148(p_content_id,p_content_type,p_slug,p_title,p_summary,p_public_body,p_external_url,p_byline,p_byline_kind,p_related_organization,p_source_reference_url,p_hero_image_url,p_public_media,p_people_photo,p_number_or_amount,p_requested_publish_date,p_change_reason);
end; $$;

create function public.submit_operations_promotion_revision(p_content_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.private_actor_can('promotion.edit_any_unpublished') then raise exception using errcode='42501', message='OPERATIONS_PROMOTION_SUBMIT_FORBIDDEN'; end if;
  return public.private_submit_operations_promotion_revision_pre148(p_content_id);
end; $$;

create function public.get_promotion_publication_admin() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not (public.private_actor_can('promotion.hide') or public.private_actor_can('promotion.republish') or public.private_actor_can('promotion.archive')) then raise exception using errcode='42501', message='PROMOTION_PUBLICATION_ADMIN_FORBIDDEN'; end if;
  return public.private_get_promotion_publication_admin_pre148();
end; $$;

create function public.set_promotion_visibility(p_content_id uuid, p_visible boolean, p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_visible and not public.private_actor_can('promotion.republish') then raise exception using errcode='42501', message='PROMOTION_REPUBLISH_FORBIDDEN'; end if;
  if not p_visible and not public.private_actor_can('promotion.hide') then raise exception using errcode='42501', message='PROMOTION_HIDE_FORBIDDEN'; end if;
  return public.private_set_promotion_visibility_pre148(p_content_id,p_visible,p_reason);
end; $$;

create function public.request_promotion_deletion(p_content_id uuid, p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.private_actor_can('promotion.archive') then raise exception using errcode='42501', message='PROMOTION_DELETE_REQUEST_FORBIDDEN'; end if;
  return public.private_request_promotion_deletion_pre148(p_content_id,p_reason);
end; $$;

create function public.delete_promotion_content(p_content_id uuid, p_confirm_title text, p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.private_actor_can('promotion.archive') then raise exception using errcode='42501', message='PROMOTION_DELETE_FORBIDDEN'; end if;
  return public.private_delete_promotion_content_pre148(p_content_id,p_confirm_title,p_reason);
end; $$;

create function public.reject_promotion_deletion_request(p_request_id uuid, p_comment text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.private_actor_can('promotion.archive') then raise exception using errcode='42501', message='PROMOTION_DELETE_FORBIDDEN'; end if;
  return public.private_reject_promotion_deletion_request_pre148(p_request_id,p_comment);
end; $$;

create function public.archive_unpublished_promotion_content(p_content_id uuid, p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.private_actor_can('promotion.archive') then raise exception using errcode='42501', message='PROMOTION_ARCHIVE_FORBIDDEN'; end if;
  return public.private_archive_unpublished_promotion_content_pre148(p_content_id,p_reason);
end; $$;

create function public.restore_promotion_content(p_content_id uuid, p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.private_actor_can('promotion.restore') then raise exception using errcode='42501', message='PROMOTION_RESTORE_FORBIDDEN'; end if;
  return public.private_restore_promotion_content_pre148(p_content_id,p_reason);
end; $$;

revoke all on function public.get_my_promotion_workspace() from public, anon;
revoke all on function public.submit_promotion_revision(uuid) from public, anon;
revoke all on function public.review_promotion_revision(uuid,text,text,date) from public, anon;
revoke all on function public.queue_promotion_revision(uuid,timestamptz) from public, anon;
revoke all on function public.save_promotion_draft(uuid, public.promotion_content_type, text, text, text, text, text, text, public.promotion_byline_kind, text, text, text, jsonb, public.promotion_disclosure_answer, public.promotion_disclosure_answer, date, text) from public, anon;
revoke all on function public.save_operations_promotion_draft(uuid, public.promotion_content_type, text, text, text, text, text, text, public.promotion_byline_kind, text, text, text, jsonb, public.promotion_disclosure_answer, public.promotion_disclosure_answer, date, text) from public, anon;
revoke all on function public.submit_operations_promotion_revision(uuid) from public, anon;
revoke all on function public.get_promotion_publication_admin() from public, anon;
revoke all on function public.set_promotion_visibility(uuid,boolean,text) from public, anon;
revoke all on function public.request_promotion_deletion(uuid,text) from public, anon;
revoke all on function public.reject_promotion_deletion_request(uuid,text) from public, anon;
revoke all on function public.archive_unpublished_promotion_content(uuid,text) from public, anon;
revoke all on function public.delete_promotion_content(uuid,text,text) from public, anon;
revoke all on function public.restore_promotion_content(uuid,text) from public, anon;

grant execute on function public.save_promotion_draft(uuid, public.promotion_content_type, text, text, text, text, text, text, public.promotion_byline_kind, text, text, text, jsonb, public.promotion_disclosure_answer, public.promotion_disclosure_answer, date, text), public.save_operations_promotion_draft(uuid, public.promotion_content_type, text, text, text, text, text, text, public.promotion_byline_kind, text, text, text, jsonb, public.promotion_disclosure_answer, public.promotion_disclosure_answer, date, text), public.submit_operations_promotion_revision(uuid), public.get_promotion_publication_admin(), public.set_promotion_visibility(uuid,boolean,text), public.request_promotion_deletion(uuid,text), public.reject_promotion_deletion_request(uuid,text), public.archive_unpublished_promotion_content(uuid,text), public.delete_promotion_content(uuid,text,text), public.restore_promotion_content(uuid,text) to authenticated;
commit;
