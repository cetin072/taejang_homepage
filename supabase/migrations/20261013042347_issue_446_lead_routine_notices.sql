-- #446: exact-role, company-only authoring. No backfill, role grants or existing records rewritten.
begin;
alter table public.notices
 add column lead_notice_mode text check (lead_notice_mode in ('routine','review','operations')),
 add column lead_direct_published_at timestamptz;

create function public.private_notice_lead_actor() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.current_profile_is_active()
 and public.current_user_has_role('promotion_lead')
 and not public.current_user_has_role('operations_manager')
 and not public.current_user_has_role('super_admin')
 and public.private_actor_can('notice.manage');
$$;
create function public.private_notice_is_routine(k public.notice_kind,i public.notice_importance,a boolean)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(k in ('general','external_activity','training','transport','materials','clothing','company_life')
 and i='normal' and a=false,false);
$$;
revoke all on function public.private_notice_lead_actor(),public.private_notice_is_routine(public.notice_kind,public.notice_importance,boolean) from public,anon,authenticated;

-- Existing photo metadata RPCs and Storage policies already call this one owner.
create or replace function public.current_user_can_manage_notice(p_notice_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare n public.notices%rowtype;
begin
 if not public.current_profile_is_active() or not public.private_actor_can('notice.manage') then return false; end if;
 select * into n from public.notices where id=p_notice_id;
 if n.id is null then return false; end if;
 if public.private_notice_lead_actor() then
  if n.created_by<>auth.uid() or n.review_state<>'none' then return false; end if;
  if n.status='draft' then
   return (n.target_scope='company' and n.lead_notice_mode in ('routine','review'))
     or (n.lead_notice_mode is null and public.current_user_can_manage_today_target(n.target_scope,n.target_department_id,n.target_work_group_id,n.target_profile_id));
  end if;
  return n.status in ('published','inactive') and n.target_scope='company'
   and n.lead_notice_mode='routine' and n.lead_direct_published_at is not null
   and public.private_notice_is_routine(n.notice_kind,n.importance,n.requires_acknowledgement);
 end if;
 return public.current_user_can_manage_today_target(n.target_scope,n.target_department_id,n.target_work_group_id,n.target_profile_id);
end; $$;

create function public.private_notice_write_target(p_id uuid,p_scope public.today_target_scope,p_dep uuid,p_group uuid,p_profile uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select case when public.private_notice_lead_actor() and p_scope='company' then
  p_dep is null and p_group is null and p_profile is null and
  (p_id is null or exists(select 1 from public.notices where id=p_id and created_by=auth.uid() and lead_notice_mode in ('routine','review') and review_state='none'))
 else public.current_user_can_manage_today_target(p_scope,p_dep,p_group,p_profile) end;
$$;
revoke all on function public.private_notice_write_target(uuid,public.today_target_scope,uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.private_save_notice_pre280(
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
  saved_id uuid;
  saved_version integer;
  old_item public.notices%rowtype;
  action_code text;
begin
  perform public.private_validate_today_target(
    p_target_scope,
    p_target_department_id,
    p_target_work_group_id,
    p_target_profile_id
  );
  if not public.private_notice_write_target(p_notice_id,
    p_target_scope,
    p_target_department_id,
    p_target_work_group_id,
    p_target_profile_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_body_easy, ''))) not between 1 and 3000
     or char_length(btrim(coalesce(p_change_reason, ''))) not between 1 and 300
     or p_publish_start_at is null
     or (p_publish_end_at is not null and p_publish_end_at <= p_publish_start_at)
     or (p_effective_start_date is not null and p_effective_end_date is not null and p_effective_end_date < p_effective_start_date)
     or (p_requires_acknowledgement and p_importance = 'normal')
     or ((p_related_link_url is null) <> (p_related_link_label is null))
     or (p_related_link_url is not null and not public.is_safe_https_url(p_related_link_url)) then
    raise exception using errcode = '22023', message = 'INVALID_NOTICE';
  end if;
  if p_related_schedule_id is not null
     and not exists (
       select 1 from public.schedule_items schedule
       where schedule.id = p_related_schedule_id
         and public.current_user_can_manage_today_target(
           schedule.target_scope,
           schedule.target_department_id,
           schedule.target_work_group_id,
           schedule.target_profile_id
         )
     ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN_RELATED_SCHEDULE');
  end if;
  if p_related_work_guide_id is not null
     and not public.current_user_can_manage_work_guide(p_related_work_guide_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN_RELATED_WORK_GUIDE');
  end if;

  if p_notice_id is null then
    insert into public.notices (
      notice_kind, importance, title, body_easy, publish_start_at, publish_end_at,
      effective_start_date, effective_end_date, location, materials_text,
      related_schedule_id, related_work_guide_id, related_link_url, related_link_label,
      requires_acknowledgement, version_no, target_scope, target_department_id,
      target_work_group_id, target_profile_id, status, change_reason, created_by,
      updated_by, published_at
    ) values (
      p_notice_kind, p_importance, btrim(p_title), btrim(p_body_easy),
      p_publish_start_at, p_publish_end_at, p_effective_start_date, p_effective_end_date,
      nullif(btrim(coalesce(p_location, '')), ''),
      nullif(btrim(coalesce(p_materials_text, '')), ''),
      p_related_schedule_id, p_related_work_guide_id,
      nullif(btrim(coalesce(p_related_link_url, '')), ''),
      nullif(btrim(coalesce(p_related_link_label, '')), ''),
      p_requires_acknowledgement, 1, p_target_scope, p_target_department_id,
      p_target_work_group_id, p_target_profile_id, p_status, btrim(p_change_reason),
      auth.uid(), auth.uid(), case when p_status = 'published' then now() else null end
    )
    returning id, version_no into saved_id, saved_version;
    action_code := case when p_status = 'published' then 'notice_published' else 'notice_created' end;
  else
    select * into old_item
    from public.notices item
    where item.id = p_notice_id
    for update;

    if old_item.id is null
       or not public.current_user_can_manage_notice(old_item.id) then
      return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
    end if;

    update public.notices
    set notice_kind = p_notice_kind,
        importance = p_importance,
        title = btrim(p_title),
        body_easy = btrim(p_body_easy),
        publish_start_at = p_publish_start_at,
        publish_end_at = p_publish_end_at,
        effective_start_date = p_effective_start_date,
        effective_end_date = p_effective_end_date,
        location = nullif(btrim(coalesce(p_location, '')), ''),
        materials_text = nullif(btrim(coalesce(p_materials_text, '')), ''),
        related_schedule_id = p_related_schedule_id,
        related_work_guide_id = p_related_work_guide_id,
        related_link_url = nullif(btrim(coalesce(p_related_link_url, '')), ''),
        related_link_label = nullif(btrim(coalesce(p_related_link_label, '')), ''),
        requires_acknowledgement = p_requires_acknowledgement,
        version_no = version_no + 1,
        target_scope = p_target_scope,
        target_department_id = p_target_department_id,
        target_work_group_id = p_target_work_group_id,
        target_profile_id = p_target_profile_id,
        status = p_status,
        change_reason = btrim(p_change_reason),
        updated_by = auth.uid(),
        published_at = case
          when p_status = 'published' and published_at is null then now()
          else published_at
        end,
        updated_at = now()
    where id = p_notice_id
    returning id, version_no into saved_id, saved_version;

    action_code := case
      when old_item.status <> 'published' and p_status = 'published' then 'notice_published'
      when old_item.status <> 'inactive' and p_status = 'inactive' then 'notice_inactivated'
      when old_item.status <> 'cancelled' and p_status = 'cancelled' then 'notice_cancelled'
      else 'notice_updated'
    end;
  end if;

  perform public.private_append_audit(
    auth.uid(),
    action_code,
    'notice',
    saved_id::text,
    'success',
    p_change_reason,
    jsonb_build_object(
      'previous_status', old_item.status,
      'status', p_status,
      'previous_version', old_item.version_no,
      'version', saved_version,
      'previous_importance', old_item.importance,
      'importance', p_importance,
      'acknowledgement_changed', p_notice_id is not null and old_item.requires_acknowledgement is distinct from p_requires_acknowledgement,
      'target_changed', p_notice_id is not null and (
        old_item.target_scope is distinct from p_target_scope
        or old_item.target_department_id is distinct from p_target_department_id
        or old_item.target_work_group_id is distinct from p_target_work_group_id
        or old_item.target_profile_id is distinct from p_target_profile_id
      ),
      'related_schedule_changed', p_notice_id is not null and old_item.related_schedule_id is distinct from p_related_schedule_id,
      'related_work_guide_changed', p_notice_id is not null and old_item.related_work_guide_id is distinct from p_related_work_guide_id,
      'related_link_changed', p_notice_id is not null and old_item.related_link_url is distinct from p_related_link_url
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'NOTICE_SAVED',
    'id', saved_id,
    'version_no', saved_version
  );
end;
$$;

alter function public.save_notice(uuid,public.notice_kind,public.notice_importance,text,text,timestamptz,timestamptz,date,date,text,text,uuid,uuid,text,text,boolean,public.today_target_scope,uuid,uuid,uuid,public.board_record_status,text) rename to private_save_notice_before446;
revoke all on function public.private_save_notice_before446(uuid,public.notice_kind,public.notice_importance,text,text,timestamptz,timestamptz,date,date,text,text,uuid,uuid,text,text,boolean,public.today_target_scope,uuid,uuid,uuid,public.board_record_status,text) from public,anon,authenticated;
create function public.save_notice(
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
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if public.private_notice_lead_actor() then
  if p_status is distinct from 'draft' then return jsonb_build_object('ok',false,'code','OPERATIONS_REVIEW_REQUIRED'); end if;
  if p_target_scope='company' or (p_notice_id is not null and not public.current_user_can_manage_notice(p_notice_id)) then
   return jsonb_build_object('ok',false,'code','FORBIDDEN_NOTICE_OWNERSHIP');
  end if;
 end if;
 result:=public.private_save_notice_before446(p_notice_id, p_notice_kind, p_importance, p_title, p_body_easy, p_publish_start_at, p_publish_end_at, p_effective_start_date, p_effective_end_date, p_location, p_materials_text, p_related_schedule_id, p_related_work_guide_id, p_related_link_url, p_related_link_label, p_requires_acknowledgement, p_target_scope, p_target_department_id, p_target_work_group_id, p_target_profile_id, p_status, p_change_reason);
 -- Operations takes over a marked notice without erasing its original direct-publication evidence.
 if coalesce((result->>'ok')::boolean,false) and (public.current_user_has_role('operations_manager') or public.current_user_has_role('super_admin')) then
  update public.notices set lead_notice_mode='operations' where id=(result->>'id')::uuid and lead_notice_mode is not null;
 end if;
 return result;
end; $$;
revoke all on function public.save_notice(uuid,public.notice_kind,public.notice_importance,text,text,timestamptz,timestamptz,date,date,text,text,uuid,uuid,text,text,boolean,public.today_target_scope,uuid,uuid,uuid,public.board_record_status,text) from public,anon;
grant execute on function public.save_notice(uuid,public.notice_kind,public.notice_importance,text,text,timestamptz,timestamptz,date,date,text,text,uuid,uuid,text,text,boolean,public.today_target_scope,uuid,uuid,uuid,public.board_record_status,text) to authenticated;

create function public.save_lead_notice(
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
, p_confirm_routine boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.notices%rowtype; result jsonb; routine boolean; mode text;
begin
 if not public.private_notice_lead_actor() then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
 if p_target_scope is distinct from 'company' or p_target_department_id is not null or p_target_work_group_id is not null or p_target_profile_id is not null then
  return jsonb_build_object('ok',false,'code','LEAD_COMPANY_ONLY');
 end if;
 if p_status is null or p_status not in ('draft','published','inactive') then return jsonb_build_object('ok',false,'code','LEAD_STATUS_FORBIDDEN'); end if;
 if p_notice_id is null and p_status<>'draft' then return jsonb_build_object('ok',false,'code','LEAD_DRAFT_FIRST'); end if;
 routine:=public.private_notice_is_routine(p_notice_kind,p_importance,p_requires_acknowledgement);
 if p_notice_id is not null then
  select * into n from public.notices where id=p_notice_id for update;
  if n.id is null or n.created_by<>auth.uid() or n.lead_notice_mode not in ('routine','review') or n.lead_notice_mode is null
   or not public.current_user_can_manage_notice(n.id) then return jsonb_build_object('ok',false,'code','FORBIDDEN_NOTICE_OWNERSHIP'); end if;
  if n.status<>'draft' and (p_status='draft' or not routine) then return jsonb_build_object('ok',false,'code','LEAD_PUBLIC_CHANGE_FORBIDDEN'); end if;
 end if;
 if p_status<>'draft' and (not routine or p_confirm_routine is distinct from true or (p_notice_id is not null and n.lead_notice_mode<>'routine')) then
  return jsonb_build_object('ok',false,'code','OPERATIONS_REVIEW_REQUIRED');
 end if;
 if p_status='inactive' and (n.lead_direct_published_at is null or n.status not in ('published','inactive')) then
  return jsonb_build_object('ok',false,'code','LEAD_STATUS_FORBIDDEN');
 end if;
 result:=public.private_save_notice_pre280(p_notice_id, p_notice_kind, p_importance, p_title, p_body_easy, p_publish_start_at, p_publish_end_at, p_effective_start_date, p_effective_end_date, p_location, p_materials_text, p_related_schedule_id, p_related_work_guide_id, p_related_link_url, p_related_link_label, p_requires_acknowledgement, p_target_scope, p_target_department_id, p_target_work_group_id, p_target_profile_id, p_status, p_change_reason);
 if coalesce((result->>'ok')::boolean,false) then
  mode:=case when not routine or n.lead_notice_mode='review' then 'review' else 'routine' end;
  update public.notices set lead_notice_mode=mode,
   lead_direct_published_at=case when p_status='published' then coalesce(lead_direct_published_at,now()) else lead_direct_published_at end
   where id=(result->>'id')::uuid;
  perform public.private_append_audit(auth.uid(),'lead_notice_saved','notice',result->>'id','success',p_change_reason,
   jsonb_build_object('mode',mode,'status',p_status,'version',result->'version_no','confirmed_routine',p_confirm_routine));
  result:=result||jsonb_build_object('lead_notice_mode',mode);
 end if;
 return result;
end; $$;
revoke all on function public.save_lead_notice(uuid,public.notice_kind,public.notice_importance,text,text,timestamptz,timestamptz,date,date,text,text,uuid,uuid,text,text,boolean,public.today_target_scope,uuid,uuid,uuid,public.board_record_status,text,boolean) from public,anon;
grant execute on function public.save_lead_notice(uuid,public.notice_kind,public.notice_importance,text,text,timestamptz,timestamptz,date,date,text,text,uuid,uuid,text,text,boolean,public.today_target_scope,uuid,uuid,uuid,public.board_record_status,text,boolean) to authenticated;

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
     or not public.current_user_can_manage_notice(item.id) then
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
  if public.private_notice_lead_actor() and item.created_by=auth.uid() and (item.lead_notice_mode is not null or public.current_user_can_manage_today_target(item.target_scope,item.target_department_id,item.target_work_group_id,item.target_profile_id)) then return true; end if;

  return public.private_notice_is_current(item)
    and public.today_target_matches_current_user(
      item.target_scope,
      item.target_department_id,
      item.target_work_group_id,
      item.target_profile_id
    );
end;
$$;

alter function public.list_manageable_notices(integer) rename to private_list_manageable_notices_before446;
revoke all on function public.private_list_manageable_notices_before446(integer) from public,anon,authenticated;
create function public.list_manageable_notices(p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.current_profile_is_active() or not public.private_actor_can('notice.manage') then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 if not public.private_notice_lead_actor() then return public.private_list_manageable_notices_before446(p_limit); end if;
 if p_limit not between 1 and 500 then raise exception using errcode='22023',message='INVALID_LIMIT'; end if;
 return coalesce((select jsonb_agg(to_jsonb(n)||jsonb_build_object('media',public.private_notice_media_json(n.id),
  'can_lead_edit',public.current_user_can_manage_notice(n.id),
  'can_lead_direct_publish',n.lead_notice_mode='routine' and public.current_user_can_manage_notice(n.id)
    and public.private_notice_is_routine(n.notice_kind,n.importance,n.requires_acknowledgement)) order by n.created_at desc)
  from (select * from public.notices x where x.created_by=auth.uid() and
   (x.lead_notice_mode is not null or public.current_user_can_manage_today_target(x.target_scope,x.target_department_id,x.target_work_group_id,x.target_profile_id))
   order by x.created_at desc limit p_limit) n),'[]'::jsonb);
end; $$;
revoke all on function public.list_manageable_notices(integer) from public,anon;
grant execute on function public.list_manageable_notices(integer) to authenticated;
commit;
