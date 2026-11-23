-- Keep summaries and older clients on the original plain-text field.
alter table public.notices add column body_document text
  check (char_length(body_document) <= 30000);

-- Older writers can still replace the plain text without leaving stale formatting.
create function public.private_clear_notice_document() returns trigger
language plpgsql set search_path='' as $$
begin
  new.body_document := null;
  return new;
end;
$$;
create trigger clear_notice_document before update of body_easy on public.notices
for each row when (old.body_easy is distinct from new.body_easy)
execute function public.private_clear_notice_document();

create function public.save_formatted_notice(
  p_notice_id uuid,
  p_notice_kind public.notice_kind,
  p_importance public.notice_importance,
  p_title text,
  p_body_easy text,
  p_publish_start_at timestamptz,
  p_publish_end_at timestamptz,
  p_effective_start_date date,
  p_effective_end_date date,
  p_location text,
  p_materials_text text,
  p_related_schedule_id uuid,
  p_related_work_guide_id uuid,
  p_related_link_url text,
  p_related_link_label text,
  p_requires_acknowledgement boolean,
  p_target_scope public.today_target_scope,
  p_target_department_id uuid,
  p_target_work_group_id uuid,
  p_target_profile_id uuid,
  p_status public.board_record_status,
  p_change_reason text,
  p_body_document text,
  p_lead boolean,
  p_confirm_routine boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if p_body_document is null or char_length(p_body_document) > 30000
     or not starts_with(p_body_document, E'TAEJANG_ARTICLE_V1\n') then
    raise exception using errcode='22023', message='INVALID_NOTICE_DOCUMENT';
  end if;
  if (substr(p_body_document, length(E'TAEJANG_ARTICLE_V1\n') + 1)::jsonb ->> 'type') is distinct from 'doc' then
    raise exception using errcode='22023', message='INVALID_NOTICE_DOCUMENT';
  end if;
  if p_lead then
    result := public.save_lead_notice(
      p_notice_id, p_notice_kind, p_importance, p_title,
      p_body_easy, p_publish_start_at, p_publish_end_at, p_effective_start_date,
      p_effective_end_date, p_location, p_materials_text, p_related_schedule_id,
      p_related_work_guide_id, p_related_link_url, p_related_link_label, p_requires_acknowledgement,
      p_target_scope, p_target_department_id, p_target_work_group_id, p_target_profile_id,
      p_status, p_change_reason, p_confirm_routine);
  else
    result := public.save_notice(
      p_notice_id, p_notice_kind, p_importance, p_title,
      p_body_easy, p_publish_start_at, p_publish_end_at, p_effective_start_date,
      p_effective_end_date, p_location, p_materials_text, p_related_schedule_id,
      p_related_work_guide_id, p_related_link_url, p_related_link_label, p_requires_acknowledgement,
      p_target_scope, p_target_department_id, p_target_work_group_id, p_target_profile_id,
      p_status, p_change_reason);
  end if;
  if (result->>'ok')::boolean then
    update public.notices set body_document=p_body_document where id=(result->>'id')::uuid;
  end if;
  return result;
end;
$$;
revoke all on function public.save_formatted_notice(uuid,public.notice_kind,public.notice_importance,text,text,timestamptz,timestamptz,date,date,text,text,uuid,uuid,text,text,boolean,public.today_target_scope,uuid,uuid,uuid,public.board_record_status,text,text,boolean,boolean) from public, anon;
grant execute on function public.save_formatted_notice(uuid,public.notice_kind,public.notice_importance,text,text,timestamptz,timestamptz,date,date,text,text,uuid,uuid,text,text,boolean,public.today_target_scope,uuid,uuid,uuid,public.board_record_status,text,text,boolean,boolean) to authenticated;

create or replace function public.get_my_notice_detail(p_notice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.current_profile_is_active() then
    raise exception using errcode='42501', message='FORBIDDEN';
  end if;

  select jsonb_build_object(
    'id', notice.id,
    'notice_kind', notice.notice_kind,
    'importance', notice.importance,
    'title', notice.title,
    'body_easy', notice.body_easy,
    'body_document', notice.body_document,
    'publish_start_at', notice.publish_start_at,
    'publish_end_at', notice.publish_end_at,
    'effective_start_date', notice.effective_start_date,
    'effective_end_date', notice.effective_end_date,
    'location', notice.location,
    'materials', notice.materials_text,
    'related_schedule_id', notice.related_schedule_id,
    'related_work_guide_id', notice.related_work_guide_id,
    'related_link_url', notice.related_link_url,
    'related_link_label', notice.related_link_label,
    'requires_acknowledgement', notice.requires_acknowledgement,
    'version_no', notice.version_no,
    'media', public.private_notice_media_json(notice.id),
    'acknowledged', exists (
      select 1 from public.notice_acknowledgements acknowledgement
      where acknowledgement.notice_id = notice.id
        and acknowledgement.notice_version = notice.version_no
        and acknowledgement.profile_id = auth.uid()
    ),
    'acknowledged_at', (
      select acknowledgement.acknowledged_at
      from public.notice_acknowledgements acknowledgement
      where acknowledgement.notice_id = notice.id
        and acknowledgement.notice_version = notice.version_no
        and acknowledgement.profile_id = auth.uid()
    ),
    'updated_at', notice.updated_at
  )
  into result
  from public.notices notice
  where notice.id = p_notice_id
    and public.private_notice_is_current(notice)
    and public.today_target_matches_current_user(
      notice.target_scope, notice.target_department_id,
      notice.target_work_group_id, notice.target_profile_id
    );

  if result is null then
    raise exception using errcode='42501', message='FORBIDDEN';
  end if;
  return result;
end;
$$;
