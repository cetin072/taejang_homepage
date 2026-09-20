begin;

-- Issue #300: operations review workflow and notice photo material metadata.

-- config.toml provisions this bucket for local Supabase.  The migration also
-- declares it for hosted staging, where config.toml is not applied by db push.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'notice-media',
  'notice-media',
  false,
  8388608,
  array['image/jpeg','image/png','image/webp','image/gif']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.notices
  add column if not exists review_state text not null default 'none',
  add column if not exists submitted_for_review_at timestamptz,
  add column if not exists submitted_for_review_by uuid references public.profiles(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id);

alter table public.notices
  drop constraint if exists notices_review_state_check;
alter table public.notices
  add constraint notices_review_state_check
  check (review_state in ('none','submitted','reviewed'));

create table if not exists public.notice_media (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.notices(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null,
  alt_text text not null,
  display_order integer not null default 0,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id),
  archive_reason text,
  constraint notice_media_mime_check check (mime_type in ('image/jpeg','image/png','image/webp','image/gif')),
  constraint notice_media_alt_check check (char_length(btrim(alt_text)) between 1 and 240),
  constraint notice_media_order_check check (display_order between 0 and 1000)
);

create index if not exists notice_media_notice_order_idx
  on public.notice_media(notice_id, display_order, created_at)
  where archived_at is null;

alter table public.notice_media enable row level security;
revoke all on table public.notice_media from public, anon, authenticated;

create or replace function public.current_user_can_manage_notice(p_notice_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  item public.notices%rowtype;
begin
  if p_notice_id is null
     or not public.current_profile_is_active()
     or not public.private_actor_can('notice.manage') then
    return false;
  end if;

  select * into item from public.notices where id = p_notice_id;
  if item.id is null then return false; end if;

  return public.current_user_can_manage_today_target(
    item.target_scope,
    item.target_department_id,
    item.target_work_group_id,
    item.target_profile_id
  );
end;
$$;

create or replace function public.current_user_can_view_notice(p_notice_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  item public.notices%rowtype;
begin
  if p_notice_id is null or not public.current_profile_is_active() then return false; end if;
  if public.current_user_can_manage_notice(p_notice_id) then return true; end if;

  select * into item from public.notices where id = p_notice_id;
  if item.id is null then return false; end if;

  return public.private_notice_is_current(item)
    and public.today_target_matches_current_user(
      item.target_scope,
      item.target_department_id,
      item.target_work_group_id,
      item.target_profile_id
    );
end;
$$;

revoke all on function public.current_user_can_manage_notice(uuid) from public, anon;
revoke all on function public.current_user_can_view_notice(uuid) from public, anon;
grant execute on function public.current_user_can_manage_notice(uuid) to authenticated;
grant execute on function public.current_user_can_view_notice(uuid) to authenticated;

create or replace function public.private_notice_media_json(p_notice_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', media.id,
        'storage_path', media.storage_path,
        'mime_type', media.mime_type,
        'alt_text', media.alt_text,
        'display_order', media.display_order
      )
      order by media.display_order, media.created_at, media.id
    ),
    '[]'::jsonb
  )
  from public.notice_media media
  where media.notice_id = p_notice_id
    and media.archived_at is null;
$$;

revoke all on function public.private_notice_media_json(uuid) from public, anon, authenticated;

create or replace function public.private_reset_notice_review_after_editor_change(p_notice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_has_role('promotion_lead')
     and not public.current_user_has_role('operations_manager') then
    update public.notices
    set review_state = 'none',
        submitted_for_review_at = null,
        submitted_for_review_by = null,
        reviewed_at = null,
        reviewed_by = null,
        updated_at = now()
    where id = p_notice_id
      and review_state in ('submitted','reviewed');
  end if;
end;
$$;

revoke all on function public.private_reset_notice_review_after_editor_change(uuid)
from public, anon, authenticated;

create or replace function public.submit_notice_for_operations_review(
  p_notice_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.notices%rowtype;
begin
  if not public.current_profile_is_active()
     or not public.private_actor_can('notice.manage')
     or not public.current_user_has_role('promotion_lead')
     or public.current_user_has_role('operations_manager') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if char_length(btrim(coalesce(p_reason,''))) not between 1 and 300 then
    raise exception using errcode='22023', message='INVALID_REVIEW_REASON';
  end if;

  select * into item
  from public.notices
  where id = p_notice_id
  for update;

  if item.id is null
     or item.status <> 'draft'
     or not public.current_user_can_manage_today_target(
       item.target_scope,
       item.target_department_id,
       item.target_work_group_id,
       item.target_profile_id
     ) then
    return jsonb_build_object('ok', false, 'code', 'NOTICE_NOT_SUBMITTABLE');
  end if;

  update public.notices
  set review_state = 'submitted',
      submitted_for_review_at = now(),
      submitted_for_review_by = auth.uid(),
      reviewed_at = null,
      reviewed_by = null,
      updated_at = now(),
      updated_by = auth.uid(),
      change_reason = btrim(p_reason)
  where id = p_notice_id;

  perform public.private_append_audit(
    auth.uid(),
    'notice_submitted_for_operations_review',
    'notice',
    p_notice_id::text,
    'success',
    p_reason,
    jsonb_build_object('review_state','submitted','version',item.version_no)
  );

  return jsonb_build_object('ok', true, 'code', 'NOTICE_SUBMITTED_FOR_REVIEW', 'id', p_notice_id);
end;
$$;

revoke all on function public.submit_notice_for_operations_review(uuid,text) from public, anon;
grant execute on function public.submit_notice_for_operations_review(uuid,text) to authenticated;

create or replace function public.add_notice_media(
  p_notice_id uuid,
  p_storage_path text,
  p_mime_type text,
  p_alt_text text,
  p_display_order integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  path_prefix text := p_notice_id::text || '/';
begin
  if not public.current_user_can_manage_notice(p_notice_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if p_storage_path is null
     or left(p_storage_path, char_length(path_prefix)) <> path_prefix
     or p_mime_type not in ('image/jpeg','image/png','image/webp','image/gif')
     or char_length(btrim(coalesce(p_alt_text,''))) not between 1 and 240
     or p_display_order not between 0 and 1000 then
    raise exception using errcode='22023', message='INVALID_NOTICE_MEDIA';
  end if;

  insert into public.notice_media(
    notice_id, storage_path, mime_type, alt_text, display_order, uploaded_by
  ) values (
    p_notice_id, p_storage_path, p_mime_type, btrim(p_alt_text), p_display_order, auth.uid()
  )
  returning id into saved_id;

  perform public.private_reset_notice_review_after_editor_change(p_notice_id);

  perform public.private_append_audit(
    auth.uid(), 'notice_media_added', 'notice', p_notice_id::text,
    'success', '공지 사진 자료 추가',
    jsonb_build_object('media_id',saved_id,'display_order',p_display_order,'mime_type',p_mime_type)
  );

  return jsonb_build_object('ok', true, 'code', 'NOTICE_MEDIA_ADDED', 'id', saved_id);
end;
$$;

create or replace function public.update_notice_media(
  p_media_id uuid,
  p_alt_text text,
  p_display_order integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.notice_media%rowtype;
begin
  select * into item
  from public.notice_media
  where id = p_media_id and archived_at is null
  for update;

  if item.id is null or not public.current_user_can_manage_notice(item.notice_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if char_length(btrim(coalesce(p_alt_text,''))) not between 1 and 240
     or p_display_order not between 0 and 1000 then
    raise exception using errcode='22023', message='INVALID_NOTICE_MEDIA';
  end if;

  update public.notice_media
  set alt_text = btrim(p_alt_text),
      display_order = p_display_order
  where id = p_media_id;

  perform public.private_reset_notice_review_after_editor_change(item.notice_id);

  return jsonb_build_object('ok', true, 'code', 'NOTICE_MEDIA_UPDATED', 'id', p_media_id);
end;
$$;

create or replace function public.archive_notice_media(
  p_media_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.notice_media%rowtype;
begin
  select * into item
  from public.notice_media
  where id = p_media_id and archived_at is null
  for update;

  if item.id is null or not public.current_user_can_manage_notice(item.notice_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if char_length(btrim(coalesce(p_reason,''))) not between 1 and 300 then
    raise exception using errcode='22023', message='INVALID_ARCHIVE_REASON';
  end if;

  update public.notice_media
  set archived_at = now(),
      archived_by = auth.uid(),
      archive_reason = btrim(p_reason)
  where id = p_media_id;

  perform public.private_reset_notice_review_after_editor_change(item.notice_id);

  perform public.private_append_audit(
    auth.uid(), 'notice_media_removed', 'notice', item.notice_id::text,
    'success', p_reason, jsonb_build_object('media_id',p_media_id)
  );

  return jsonb_build_object(
    'ok', true, 'code', 'NOTICE_MEDIA_ARCHIVED',
    'id', p_media_id, 'storage_path', item.storage_path
  );
end;
$$;

revoke all on function public.add_notice_media(uuid,text,text,text,integer) from public, anon;
revoke all on function public.update_notice_media(uuid,text,integer) from public, anon;
revoke all on function public.archive_notice_media(uuid,text) from public, anon;
grant execute on function public.add_notice_media(uuid,text,text,text,integer) to authenticated;
grant execute on function public.update_notice_media(uuid,text,integer) to authenticated;
grant execute on function public.archive_notice_media(uuid,text) to authenticated;

-- Preserve the existing save contract while resetting stale submissions after
-- promotion-lead edits and marking a submitted notice reviewed on operations publication.
create or replace function public.save_notice(
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
  p_change_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  saved_id uuid;
begin
  if not public.private_actor_can('notice.manage') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  -- Promotion leads prepare drafts for operations review.  Publishing (or
  -- cancelling/deactivating a notice) remains an operations responsibility,
  -- even when a client bypasses the UI status selector.
  if public.current_user_has_role('promotion_lead')
     and not public.current_user_has_role('operations_manager')
     and not public.current_user_has_role('super_admin')
     and p_status <> 'draft' then
    return jsonb_build_object('ok', false, 'code', 'OPERATIONS_REVIEW_REQUIRED');
  end if;

  result := public.private_save_notice_pre280(
    p_notice_id, p_notice_kind, p_importance, p_title, p_body_easy,
    p_publish_start_at, p_publish_end_at, p_effective_start_date,
    p_effective_end_date, p_location, p_materials_text, p_related_schedule_id,
    p_related_work_guide_id, p_related_link_url, p_related_link_label,
    p_requires_acknowledgement, p_target_scope, p_target_department_id,
    p_target_work_group_id, p_target_profile_id, p_status, p_change_reason
  );

  if coalesce((result->>'ok')::boolean,false) then
    saved_id := (result->>'id')::uuid;

    if public.current_user_has_role('promotion_lead')
       and not public.current_user_has_role('operations_manager') then
      perform public.private_reset_notice_review_after_editor_change(saved_id);
    elsif (public.current_user_has_role('operations_manager')
           or public.current_user_has_role('super_admin')) then
      update public.notices
      set review_state = 'reviewed',
          reviewed_at = now(),
          reviewed_by = auth.uid()
      where id = saved_id
        and review_state = 'submitted';
    end if;
  end if;

  return result;
end;
$$;

revoke all on function public.save_notice(
  uuid,public.notice_kind,public.notice_importance,text,text,timestamptz,timestamptz,
  date,date,text,text,uuid,uuid,text,text,boolean,public.today_target_scope,
  uuid,uuid,uuid,public.board_record_status,text
) from public, anon;
grant execute on function public.save_notice(
  uuid,public.notice_kind,public.notice_importance,text,text,timestamptz,timestamptz,
  date,date,text,text,uuid,uuid,text,text,boolean,public.today_target_scope,
  uuid,uuid,uuid,public.board_record_status,text
) to authenticated;

create or replace function public.list_manageable_notices(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('notice.manage') then
    raise exception using errcode='42501', message='FORBIDDEN';
  end if;
  if p_limit not between 1 and 500 then
    raise exception using errcode='22023', message='INVALID_LIMIT';
  end if;

  return coalesce((
    select jsonb_agg(
      to_jsonb(item)
      || jsonb_build_object(
        'media', public.private_notice_media_json(item.id),
        'creator_display_name', creator.display_name,
        'submitter_display_name', submitter.display_name
      )
      order by
        case when item.review_state = 'submitted' then 1 else 0 end desc,
        case item.importance when 'urgent' then 2 when 'important' then 1 else 0 end desc,
        item.publish_start_at desc,
        item.created_at desc
    )
    from (
      select notice.*
      from public.notices notice
      where notice.status <> 'inactive'
        and public.current_user_can_manage_today_target(
          notice.target_scope, notice.target_department_id,
          notice.target_work_group_id, notice.target_profile_id
        )
      order by
        case when notice.review_state = 'submitted' then 1 else 0 end desc,
        case notice.importance when 'urgent' then 2 when 'important' then 1 else 0 end desc,
        notice.publish_start_at desc, notice.created_at desc
      limit p_limit
    ) item
    left join public.profiles creator on creator.id = item.created_by
    left join public.profiles submitter on submitter.id = item.submitted_for_review_by
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_my_notice_list(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_profile_is_active() then
    raise exception using errcode='42501', message='FORBIDDEN';
  end if;
  if p_limit not between 1 and 200 then
    raise exception using errcode='22023', message='INVALID_LIMIT';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', item.id,
      'notice_kind', item.notice_kind,
      'importance', item.importance,
      'title', item.title,
      'summary', left(item.body_easy,220),
      'publish_start_at', item.publish_start_at,
      'publish_end_at', item.publish_end_at,
      'requires_acknowledgement', item.requires_acknowledgement,
      'version_no', item.version_no,
      'media', public.private_notice_media_json(item.id),
      'acknowledged', exists (
        select 1 from public.notice_acknowledgements acknowledgement
        where acknowledgement.notice_id = item.id
          and acknowledgement.notice_version = item.version_no
          and acknowledgement.profile_id = auth.uid()
      ),
      'is_new', item.publish_start_at >= now() - interval '7 days',
      'is_changed', item.version_no > 1,
      'updated_at', item.updated_at
    ) order by
      case item.importance when 'urgent' then 2 when 'important' then 1 else 0 end desc,
      item.publish_start_at desc, item.created_at desc)
    from (
      select notice.*
      from public.notices notice
      where public.private_notice_is_current(notice)
        and public.today_target_matches_current_user(
          notice.target_scope, notice.target_department_id,
          notice.target_work_group_id, notice.target_profile_id
        )
      order by
        case notice.importance when 'urgent' then 2 when 'important' then 1 else 0 end desc,
        notice.publish_start_at desc, notice.created_at desc
      limit p_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

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

revoke all on function public.list_manageable_notices(integer) from public, anon;
revoke all on function public.get_my_notice_list(integer) from public, anon;
revoke all on function public.get_my_notice_detail(uuid) from public, anon;
grant execute on function public.list_manageable_notices(integer) to authenticated;
grant execute on function public.get_my_notice_list(integer) to authenticated;
grant execute on function public.get_my_notice_detail(uuid) to authenticated;

-- Private Storage bucket policies. The bucket itself is declared in config.toml
-- for local/CI and provisioned separately in hosted staging.
drop policy if exists "notice media upload" on storage.objects;
create policy "notice media upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'notice-media'
  and array_length(storage.foldername(name),1) >= 1
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.current_user_can_manage_notice(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "notice media read" on storage.objects;
create policy "notice media read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'notice-media'
  and array_length(storage.foldername(name),1) >= 1
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.current_user_can_view_notice(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "notice media delete" on storage.objects;
create policy "notice media delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'notice-media'
  and array_length(storage.foldername(name),1) >= 1
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.current_user_can_manage_notice(((storage.foldername(name))[1])::uuid)
);

commit;
