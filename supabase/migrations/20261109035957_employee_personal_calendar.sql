begin;

-- The private calendar is the existing personal schedule ledger, not a second copy.
-- Provision only an internal calendar workspace on the owner's first explicit save.
-- No Auth account, performance record, task, company schedule or notification is created.
create function private.calendar_actor() returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.current_profile_is_active() or exists(
  select 1 from public.role_simulation_modes where profile_id=auth.uid() and expires_at>now()
 ) then raise exception using errcode='42501',message='CALENDAR_FORBIDDEN'; end if;
 return auth.uid();
end $$;
revoke all on function private.calendar_actor() from public,anon,authenticated;

create function private.calendar_workspace(p_create boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.calendar_actor(); v_id uuid;
begin
 if p_create then perform pg_advisory_xact_lock(hashtextextended('erp-calendar:'||v_actor::text,0)); end if;
 select id into v_id from worklog.workspaces where kind='personal' and owner_user_id=v_actor;
 if v_id is null and p_create then
  insert into worklog.workspaces(name,kind,owner_user_id,created_by_user_id,metadata)
   values('내 일정','personal',v_actor,v_actor,'{"source":"erp_calendar"}') returning id into v_id;
  insert into worklog.workspace_members(workspace_id,user_id,role) values(v_id,v_actor,'owner');
 end if;
 if v_id is not null and not exists(select 1 from worklog.workspace_members
  where workspace_id=v_id and user_id=v_actor and role='owner') then
  raise exception using errcode='42501',message='CALENDAR_FORBIDDEN';
 end if;
 return v_id;
end $$;
revoke all on function private.calendar_workspace(boolean) from public,anon,authenticated;

create function public.save_my_calendar_event(
 p_id uuid,p_request_id uuid,p_expected_updated_at timestamptz,p_title text,
 p_starts_at timestamptz,p_ends_at timestamptz,p_all_day boolean,
 p_location text default '',p_description text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=private.calendar_actor(); v_workspace uuid; v_row worklog.schedules;
 v_payload jsonb:=jsonb_build_object('title',btrim(p_title),'starts_at',p_starts_at,
  'ends_at',p_ends_at,'all_day',p_all_day,'location',btrim(coalesce(p_location,'')),
  'description',btrim(coalesce(p_description,'')));
begin
 if p_id is null or p_request_id is null or p_title is null or length(btrim(p_title)) not between 1 and 200
  or length(coalesce(p_location,''))>200 or length(coalesce(p_description,''))>2000
  or p_starts_at is null or not isfinite(p_starts_at) or p_all_day is null
  or p_starts_at<'2000-01-01T00:00:00+09:00' or p_starts_at>='2100-01-01T00:00:00+09:00'
  or (p_ends_at is not null and (not isfinite(p_ends_at) or p_ends_at<=p_starts_at or p_ends_at>'2100-01-01T00:00:00+09:00'))
  or (p_all_day and ((p_starts_at at time zone 'Asia/Seoul')::time<>'00:00'
    or p_ends_at is null or (p_ends_at at time zone 'Asia/Seoul')::time<>'00:00')) then
  raise exception using errcode='22023',message='CALENDAR_INVALID_INPUT';
 end if;
 v_workspace:=private.calendar_workspace(true);
 select * into v_row from worklog.schedules where id=p_id for update;
 if found then
  if v_row.workspace_id<>v_workspace or v_row.created_by_user_id is distinct from v_actor then
   raise exception using errcode='42501',message='CALENDAR_FORBIDDEN';
  end if;
  if v_row.metadata->'erp_calendar'->>'request_id'=p_request_id::text then
   if v_row.metadata->'erp_calendar'->'payload' is distinct from v_payload then
    raise exception using errcode='22023',message='CALENDAR_REQUEST_REUSE'; end if;
   return to_jsonb(v_row);
  end if;
  if p_expected_updated_at is null or p_expected_updated_at is distinct from v_row.updated_at
   or v_row.status not in ('confirmed','tentative') then
   raise exception using errcode='40001',message='CALENDAR_CONFLICT';
  end if;
  -- Linked work-record appointments keep their existing canonical edit workflow.
  if v_row.metadata ?| array['workRecordId','reminderWorkRecordId'] then
   raise exception using errcode='22023',message='CALENDAR_WORKLOG_RECORD';
  end if;
  update worklog.schedules set title=btrim(p_title),starts_at=p_starts_at,ends_at=p_ends_at,
   all_day=p_all_day,location=btrim(coalesce(p_location,'')),description=btrim(coalesce(p_description,'')),
   metadata=metadata||jsonb_build_object('erp_calendar',jsonb_build_object('request_id',p_request_id,'payload',v_payload)),updated_at=clock_timestamp()
   where id=p_id returning * into v_row;
 else
  if p_expected_updated_at is not null then raise exception using errcode='40001',message='CALENDAR_CONFLICT'; end if;
  insert into worklog.schedules(id,workspace_id,created_by_user_id,title,starts_at,ends_at,all_day,
    location,description,timezone,status,metadata)
   values(p_id,v_workspace,v_actor,btrim(p_title),p_starts_at,p_ends_at,p_all_day,
    btrim(coalesce(p_location,'')),btrim(coalesce(p_description,'')),'Asia/Seoul','confirmed',
    jsonb_build_object('source','erp_calendar','erp_calendar',jsonb_build_object('request_id',p_request_id,'payload',v_payload)))
   returning * into v_row;
 end if;
 return to_jsonb(v_row);
end $$;

create function public.cancel_my_calendar_event(p_id uuid,p_request_id uuid,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=private.calendar_actor();v_row worklog.schedules;v_workspace uuid:=private.calendar_workspace(false);
begin
 if p_id is null or p_request_id is null then raise exception using errcode='22023',message='CALENDAR_INVALID_INPUT'; end if;
 select * into v_row from worklog.schedules where id=p_id and workspace_id=v_workspace and created_by_user_id=v_actor for update;
 if not found then raise exception using errcode='42501',message='CALENDAR_FORBIDDEN';end if;
 if v_row.status='cancelled' and v_row.metadata->>'erp_calendar_cancel_request'=p_request_id::text then return to_jsonb(v_row);end if;
 if p_expected_updated_at is null or p_expected_updated_at is distinct from v_row.updated_at or v_row.status not in ('confirmed','tentative') then
  raise exception using errcode='40001',message='CALENDAR_CONFLICT';end if;
 if v_row.metadata ?| array['workRecordId','reminderWorkRecordId'] then
  raise exception using errcode='22023',message='CALENDAR_WORKLOG_RECORD';end if;
 update worklog.schedules set status='cancelled',updated_at=clock_timestamp(),
  metadata=metadata||jsonb_build_object('erp_calendar_cancel_request',p_request_id)
  where id=p_id returning * into v_row;
 return to_jsonb(v_row);
end $$;

create function public.get_my_calendar_month(p_month date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=private.calendar_actor();v_workspace uuid:=private.calendar_workspace(false);
 v_from timestamptz;v_to timestamptz;v_today date:=(now() at time zone 'Asia/Seoul')::date;
 v_rows jsonb;v_tasks jsonb;
begin
 if p_month is null or not isfinite(p_month) or p_month<>date_trunc('month',p_month)::date
   or p_month<'2000-01-01' or p_month>='2100-01-01' then
  raise exception using errcode='22023',message='CALENDAR_INVALID_MONTH';end if;
 v_from:=p_month::timestamp at time zone 'Asia/Seoul';
 v_to:=(p_month+interval '1 month')::timestamp at time zone 'Asia/Seoul';
 with visible_notices as (
  select n.*,s.id as visible_schedule_id,s.starts_at as schedule_start,s.ends_at as schedule_end,
   s.all_day as schedule_all_day,s.status as schedule_status
  from public.notices n left join public.schedule_items s on s.id=n.related_schedule_id
   and s.status in ('published','cancelled') and public.today_target_matches_current_user(
    s.target_scope,s.target_department_id,s.target_work_group_id,s.target_profile_id)
  where n.archived_at is null and n.publish_start_at<=now() and (n.publish_end_at is null or n.publish_end_at>=now())
   and (n.status='published' or (n.status='cancelled' and n.published_at is not null))
   and public.today_target_matches_current_user(n.target_scope,n.target_department_id,n.target_work_group_id,n.target_profile_id)
   and (n.effective_start_date is not null or s.id is not null)
 ), events as (
  select s.id,'personal'::text as source,s.title,s.starts_at,s.ends_at,s.all_day,s.location,
   s.description,s.status,s.updated_at,
   not(s.metadata ?| array['workRecordId','reminderWorkRecordId']) as editable,null::uuid as notice_id
  from worklog.schedules s where s.workspace_id=v_workspace and s.created_by_user_id=v_actor and s.status in ('confirmed','tentative')
  union all
  select n.id,'notice',n.title,coalesce(n.schedule_start,n.effective_start_date::timestamp at time zone 'Asia/Seoul'),
   case when n.visible_schedule_id is not null then n.schedule_end
     else (coalesce(n.effective_end_date,n.effective_start_date)+1)::timestamp at time zone 'Asia/Seoul' end,
   coalesce(n.schedule_all_day,true),n.location,n.body_easy,
   case when n.status='cancelled' or n.schedule_status='cancelled' then 'cancelled' else 'published' end,
   n.updated_at,false,n.id from visible_notices n
  union all
  select s.id,'company',s.title,s.starts_at,s.ends_at,s.all_day,s.location,s.easy_text,s.status::text,s.updated_at,false,null::uuid
  from public.schedule_items s where s.status in ('published','cancelled')
   and public.today_target_matches_current_user(s.target_scope,s.target_department_id,s.target_work_group_id,s.target_profile_id)
   and not exists(select 1 from visible_notices n where n.visible_schedule_id=s.id)
 ), selected as (
  select e.* from events e where
   (e.starts_at<v_to and coalesce(e.ends_at,e.starts_at+interval '1 microsecond')>v_from)
   or (e.starts_at<(v_today+1)::timestamp at time zone 'Asia/Seoul'
    and coalesce(e.ends_at,e.starts_at+interval '1 microsecond')>v_today::timestamp at time zone 'Asia/Seoul')
  order by e.starts_at,e.source,e.id limit 1001
 ) select coalesce(jsonb_agg(to_jsonb(selected) order by starts_at,source,id),'[]') into v_rows from selected;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into v_tasks from (
  select id,title,status,due_at from worklog.work_records where workspace_id=v_workspace
   and created_by_user_id=v_actor and status in ('in_progress','waiting','needs_review')
   and (action_kind is null or action_kind='task') order by updated_at desc,id limit 500
 ) t;
 return jsonb_build_object('month',to_char(p_month,'YYYY-MM'),'today',v_today,'events',v_rows,
  'limited',jsonb_array_length(v_rows)>1000,'tasks',v_tasks);
end $$;

revoke all on function public.get_my_calendar_month(date),
 public.save_my_calendar_event(uuid,uuid,timestamptz,text,timestamptz,timestamptz,boolean,text,text),
 public.cancel_my_calendar_event(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.get_my_calendar_month(date),
 public.save_my_calendar_event(uuid,uuid,timestamptz,text,timestamptz,timestamptz,boolean,text,text),
 public.cancel_my_calendar_event(uuid,uuid,timestamptz) to authenticated;
commit;
