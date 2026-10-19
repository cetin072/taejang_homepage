-- DRAFT: approval is required before applying to any hosted database.
-- Read history is deliberately separate from current_user_can_manage_notice.
begin;

create function public.private_can_read_notice_management(p_notice_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.current_profile_is_active() and public.private_actor_can('notice.manage') and exists (
  select 1 from public.notices n where n.id=p_notice_id and (
   (not public.private_notice_lead_actor() and public.current_user_can_manage_today_target(
     n.target_scope,n.target_department_id,n.target_work_group_id,n.target_profile_id))
   or (public.private_notice_lead_actor() and (
    (n.created_by=auth.uid() and ((n.lead_notice_mode is not null and n.target_scope='company')
     or public.current_user_can_manage_today_target(n.target_scope,n.target_department_id,n.target_work_group_id,n.target_profile_id)))
    or (n.status='published' and n.archived_at is null and n.target_scope='company' and n.publish_start_at<=now())
   ))
  ));
$$;

create function public.private_notice_management_json(p_notice_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(n)||jsonb_build_object(
  'media',public.private_notice_media_json(n.id),
  'creator_display_name',creator.display_name,
  'submitter_display_name',submitter.display_name,
  'can_edit',n.archived_at is null and public.current_user_can_manage_notice(n.id),
  'can_read_ack_summary',public.current_user_can_manage_today_target(
    n.target_scope,n.target_department_id,n.target_work_group_id,n.target_profile_id),
  'can_lead_edit',n.archived_at is null and public.current_user_can_manage_notice(n.id),
  'can_lead_direct_publish',n.lead_notice_mode='routine' and n.archived_at is null
    and public.current_user_can_manage_notice(n.id)
    and public.private_notice_is_routine(n.notice_kind,n.importance,n.requires_acknowledgement),
  'can_archive',n.archived_at is null and public.private_actor_can_manage_recovery_target(
    'notice.manage',n.target_scope,n.target_department_id,n.target_work_group_id,n.target_profile_id),
  'can_restore',n.archived_at is not null and public.private_actor_can_manage_recovery_target(
    'notice.manage',n.target_scope,n.target_department_id,n.target_work_group_id,n.target_profile_id))
 from public.notices n left join public.profiles creator on creator.id=n.created_by
 left join public.profiles submitter on submitter.id=n.submitted_for_review_by
 where n.id=p_notice_id and public.private_can_read_notice_management(n.id);
$$;

create function public.get_manageable_notice(p_notice_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.private_notice_management_json(p_notice_id);
 if result is null then raise exception using errcode='42501',message='NOTICE_READ_FORBIDDEN'; end if;
 return result;
end; $$;

create function public.list_manageable_notices_page(
 p_limit integer default 50,p_offset integer default 0,p_archive boolean default false,
 p_search text default null,p_status text default null,p_from timestamptz default null,p_until timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.current_profile_is_active() or not public.private_actor_can('notice.manage') then
  raise exception using errcode='42501',message='FORBIDDEN'; end if;
 if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0
  or p_archive is null or char_length(coalesce(p_search,''))>120
  or (p_status is not null and p_status not in ('active','scheduled','review','draft','expired','cancelled','inactive','archived')) then
  raise exception using errcode='22023',message='INVALID_NOTICE_QUERY'; end if;
 return (
  with visible as materialized (
   select n.*,case when n.archived_at is not null then 'archived'
    when n.status in ('cancelled','inactive') then n.status::text
    when n.review_state='submitted' then 'review'
    when n.status='draft' then 'draft'
    when n.publish_end_at<=now() then 'expired'
    when n.publish_start_at>now() then 'scheduled' else 'active' end as exposure
   from public.notices n where public.private_can_read_notice_management(n.id)
  ), filtered as materialized (
   select * from visible n where
    (n.archived_at is not null or n.status in ('cancelled','inactive'))=p_archive
    and (nullif(btrim(p_search),'') is null or strpos(lower(n.title),lower(btrim(p_search)))>0)
    and (p_status is null or n.exposure=p_status)
    and (p_from is null or coalesce(n.archived_at,n.published_at,n.publish_start_at,n.created_at)>=p_from)
    and (p_until is null or coalesce(n.archived_at,n.published_at,n.publish_start_at,n.created_at)<p_until)
  ), page as (
   select n.id,row_number() over (order by
    case when p_archive then 0 when n.exposure='active' then 0 when n.exposure='expired' then 2 else 1 end,
    case when p_archive then coalesce(n.archived_at,n.updated_at,n.created_at)
     when n.exposure='expired' then n.publish_end_at
     else coalesce(n.published_at,n.publish_start_at,n.created_at) end desc,n.id) as ordinal
   from filtered n order by ordinal limit p_limit offset p_offset
  ) select jsonb_build_object(
   'items',coalesce((select jsonb_agg(public.private_notice_management_json(id) order by ordinal) from page),'[]'::jsonb),
   'total',(select count(*) from filtered),'has_more',(select count(*) from filtered)>p_offset+p_limit
  )
 );
end; $$;

-- Keep existing callers compatible, but do not make the limited legacy list the
-- authority for exact-ID save verification or complete archive searches.
create or replace function public.list_manageable_notices(p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.current_profile_is_active() or not public.private_actor_can('notice.manage') then
  raise exception using errcode='42501',message='FORBIDDEN'; end if;
 if p_limit is null or p_limit not between 1 and 500 then
  raise exception using errcode='22023',message='INVALID_LIMIT'; end if;
 return coalesce((select jsonb_agg(public.private_notice_management_json(n.id) order by n.created_at desc,n.id)
  from (select x.id,x.created_at from public.notices x
   where x.archived_at is null and public.private_can_read_notice_management(x.id)
   order by x.created_at desc,x.id limit p_limit) n),'[]'::jsonb);
end; $$;

-- Replace in place: Storage/RLS policies retain the existing function identity.
create or replace function public.current_user_can_view_notice(p_notice_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare item public.notices%rowtype;
begin
 if p_notice_id is null or not public.current_profile_is_active() then return false; end if;
 if public.private_can_read_notice_management(p_notice_id) or public.current_user_can_manage_notice(p_notice_id) then return true; end if;
 select * into item from public.notices where id=p_notice_id;
 if item.id is null then return false; end if;
 if public.private_notice_lead_actor() and item.created_by=auth.uid() and
  ((item.lead_notice_mode is not null and item.target_scope='company') or public.current_user_can_manage_today_target(
   item.target_scope,item.target_department_id,item.target_work_group_id,item.target_profile_id)) then return true; end if;
 return public.private_notice_is_current(item) and public.today_target_matches_current_user(
  item.target_scope,item.target_department_id,item.target_work_group_id,item.target_profile_id);
end;
$$;

revoke all on function public.private_can_read_notice_management(uuid),public.private_notice_management_json(uuid) from public,anon,authenticated;
revoke all on function public.get_manageable_notice(uuid),public.list_manageable_notices_page(integer,integer,boolean,text,text,timestamptz,timestamptz),public.current_user_can_view_notice(uuid) from public,anon;
grant execute on function public.get_manageable_notice(uuid),public.list_manageable_notices_page(integer,integer,boolean,text,text,timestamptz,timestamptz),public.current_user_can_view_notice(uuid) to authenticated;
commit;
