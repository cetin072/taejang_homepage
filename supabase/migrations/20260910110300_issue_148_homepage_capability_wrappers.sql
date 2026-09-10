-- Issue #148 B: preserve the allow-listed homepage workflow behind capability gates.
begin;

alter function public.create_homepage_slot_change_request(text,text,text,text,text,text) rename to private_create_homepage_slot_change_request_pre148;
alter function public.get_homepage_change_requests() rename to private_get_homepage_change_requests_pre148;
alter function public.review_homepage_change_request(uuid,text,text) rename to private_review_homepage_change_request_pre148;
alter function public.save_homepage_live_override(text,text,text,text,text,text) rename to private_save_homepage_live_override_pre148;
alter function public.delete_homepage_live_override(text) rename to private_delete_homepage_live_override_pre148;
alter function public.get_homepage_live_overrides_admin() rename to private_get_homepage_live_overrides_admin_pre148;

revoke all on function public.private_create_homepage_slot_change_request_pre148(text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.private_get_homepage_change_requests_pre148() from public, anon, authenticated;
revoke all on function public.private_review_homepage_change_request_pre148(uuid,text,text) from public, anon, authenticated;
revoke all on function public.private_save_homepage_live_override_pre148(text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.private_delete_homepage_live_override_pre148(text) from public, anon, authenticated;
revoke all on function public.private_get_homepage_live_overrides_admin_pre148() from public, anon, authenticated;

create function public.create_homepage_slot_change_request(
  p_slot_key text, p_current_summary text default null, p_proposed_text text default null,
  p_proposed_image_url text default null, p_image_alt text default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.private_actor_can('homepage.draft') then raise exception using errcode='42501', message='HOMEPAGE_CHANGE_REQUEST_FORBIDDEN'; end if;
  perform public.promotion_validate_url(p_proposed_image_url, 'proposed_image_url');
  return public.private_create_homepage_slot_change_request_pre148(p_slot_key,p_current_summary,p_proposed_text,p_proposed_image_url,p_image_alt,p_reason);
end; $$;

create function public.get_homepage_change_requests() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not (public.private_actor_can('homepage.draft') or public.private_actor_can('homepage.review') or public.private_actor_can('homepage.approve_apply')) then raise exception using errcode='42501', message='HOMEPAGE_CHANGE_READ_FORBIDDEN'; end if;
  return public.private_get_homepage_change_requests_pre148();
end; $$;

create function public.review_homepage_change_request(p_request_id uuid, p_action text, p_comment text default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_action = 'approve' and not public.private_actor_can('homepage.approve_apply') then raise exception using errcode='42501', message='HOMEPAGE_CHANGE_APPROVE_FORBIDDEN'; end if;
  if p_action in ('changes_requested','reject') and not public.private_actor_can('homepage.review') then raise exception using errcode='42501', message='HOMEPAGE_CHANGE_REVIEW_FORBIDDEN'; end if;
  return public.private_review_homepage_change_request_pre148(p_request_id,p_action,p_comment);
end; $$;

create function public.save_homepage_live_override(
  p_slot_key text, p_text_value text default null, p_link_label text default null,
  p_link_url text default null, p_image_url text default null, p_image_alt text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.private_actor_can('homepage.direct_edit') then raise exception using errcode='42501', message='HOMEPAGE_DIRECT_EDIT_FORBIDDEN'; end if;
  return public.private_save_homepage_live_override_pre148(p_slot_key,p_text_value,p_link_label,p_link_url,p_image_url,p_image_alt);
end; $$;

create function public.delete_homepage_live_override(p_slot_key text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.private_actor_can('homepage.direct_edit') then raise exception using errcode='42501', message='HOMEPAGE_DIRECT_EDIT_FORBIDDEN'; end if;
  return public.private_delete_homepage_live_override_pre148(p_slot_key);
end; $$;

create function public.get_homepage_live_overrides_admin() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.private_actor_can('homepage.direct_edit') then raise exception using errcode='42501', message='HOMEPAGE_DIRECT_EDIT_FORBIDDEN'; end if;
  return public.private_get_homepage_live_overrides_admin_pre148();
end; $$;

revoke all on function public.create_homepage_slot_change_request(text,text,text,text,text,text) from public, anon;
revoke all on function public.get_homepage_change_requests() from public, anon;
revoke all on function public.review_homepage_change_request(uuid,text,text) from public, anon;
revoke all on function public.save_homepage_live_override(text,text,text,text,text,text) from public, anon;
revoke all on function public.delete_homepage_live_override(text) from public, anon;
revoke all on function public.get_homepage_live_overrides_admin() from public, anon;

grant execute on function public.create_homepage_slot_change_request(text,text,text,text,text,text), public.get_homepage_change_requests(), public.review_homepage_change_request(uuid,text,text), public.save_homepage_live_override(text,text,text,text,text,text), public.delete_homepage_live_override(text), public.get_homepage_live_overrides_admin() to authenticated;
commit;
