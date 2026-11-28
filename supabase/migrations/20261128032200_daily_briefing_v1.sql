begin;

insert into public.platform_capabilities(code, capability_kind, operations_manager_auto_grant, description)
values ('daily_briefing.manage', 'operational', true, '일일 브리핑 작성·확정·공유 및 반복 설정');
insert into public.role_capability_grants(role_id, capability_code)
select id, 'daily_briefing.manage' from public.roles where code = 'promotion_lead';
insert into public.menu_authority_catalog(menu_key,label,scope_summary,sensitive_fields,capabilities,adapter_ready)
values ('daily_briefing.manage','일일 브리핑','공용 일정과 전사 공지, 근무·연차 인원 집계로 브리핑을 관리합니다.',
 array['관리자용 인원 집계'],array['daily_briefing.manage'],false);

create table public.daily_briefing_settings (
 singleton boolean primary key default true check (singleton),
 enabled boolean not null default true,
 generate_at time not null default '07:30',
 review_at time not null default '08:30',
 share_at time not null default '08:40',
 rules jsonb not null default '[]' check (jsonb_typeof(rules) = 'array'),
 version integer not null default 1,
 updated_by uuid references public.profiles(id),
 updated_at timestamptz not null default now(),
 check (generate_at <= review_at and review_at <= share_at)
);
insert into public.daily_briefing_settings default values;

create table public.daily_briefings (
 work_date date not null,
 version integer not null check (version > 0),
 source jsonb not null,
 edits jsonb not null default '{}',
 hidden text[] not null default '{}',
 note text not null default '',
 created_by uuid references public.profiles(id),
 updated_by uuid references public.profiles(id),
 confirmed_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 confirmed_at timestamptz,
 primary key (work_date, version),
 check ((confirmed_at is null) = (confirmed_by is null))
);
create unique index daily_briefings_one_draft on public.daily_briefings(work_date) where confirmed_at is null;

create table public.daily_briefing_deliveries (
 request_id uuid primary key,
 work_date date not null,
 version integer not null,
 actor_id uuid not null references public.profiles(id),
 action text not null check (action in ('copied','copy_failed','share_requested','share_cancelled','share_failed')),
 attempted_at timestamptz not null default now(),
 foreign key (work_date,version) references public.daily_briefings(work_date,version)
);
create index daily_briefing_deliveries_day on public.daily_briefing_deliveries(work_date,attempted_at desc);

alter table public.daily_briefing_settings enable row level security;
alter table public.daily_briefings enable row level security;
alter table public.daily_briefing_deliveries enable row level security;
revoke all on public.daily_briefing_settings,public.daily_briefings,public.daily_briefing_deliveries from public,anon,authenticated;

create function private.daily_briefing_actor()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
 if actor is null or not public.current_profile_is_active()
   or not (public.private_actual_role_codes() && array['operations_manager','promotion_lead'])
   or not (public.current_user_has_role('operations_manager') or public.current_user_has_role('promotion_lead'))
   or exists(select 1 from public.role_simulation_modes where profile_id=actor and expires_at>now())
   or not public.private_actor_can('daily_briefing.manage')
   or public.private_menu_denied('daily_briefing.manage') then
  raise exception using errcode='42501',message='BRIEFING_FORBIDDEN';
 end if;
 return actor;
end $$;

create function private.daily_briefing_workday(p_day date)
returns boolean language sql stable set search_path = '' as $$
 select not exists(select 1 from public.employee_days_off where employee_uuid is null
   and work_date=p_day and revoked_at is null)
 and (
   public.private_attendance_is_workday(p_day)
   or exists(select 1 from public.attendance_holiday_work_assignments a
       join public.employees e on e.id=a.employee_uuid
       where a.work_date=p_day and a.revoked_at is null
         and e.archived_at is null and e.employment_status='active' and e.hired_on<=p_day
         and (e.departed_on is null or e.departed_on>=p_day)
         and not exists(select 1 from public.employee_days_off o where o.employee_uuid=e.id
                         and o.work_date=p_day and o.revoked_at is null))
 );
$$;

create function private.daily_briefing_source(p_day date)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
 day_start timestamptz := p_day::timestamp at time zone 'Asia/Seoul';
 next_start timestamptz := (p_day+1)::timestamp at time zone 'Asia/Seoul';
 window_end timestamptz := (p_day+8)::timestamp at time zone 'Asia/Seoul';
 issues text[] := '{}';
 is_workday boolean;
 headlines jsonb := '[]';
 today_events jsonb := '[]';
 future_events jsonb := '[]';
 work_status jsonb := '[]';
 routine_tasks jsonb := '[]';
 rules jsonb := '[]';
 missing integer;
begin
 begin
  is_workday := private.daily_briefing_workday(p_day);
 exception when others then issues := array_append(issues,'근무일 판정'); end;
 begin
  select coalesce(jsonb_agg(title order by priority desc,published desc,title),'[]') into headlines
  from (
   select distinct on (lower(regexp_replace(btrim(n.title),'[[:space:]]+',' ','g')))
    btrim(n.title) as title, case n.importance when 'urgent' then 2 else 1 end as priority,n.published_at as published
   from public.notices n
   where n.status='published' and n.archived_at is null and n.target_scope='company'
     and n.importance in ('urgent','important') and n.published_at<=now()
     and n.publish_start_at<next_start and coalesce(n.publish_end_at,'infinity')>=day_start
     and (n.effective_start_date is null or n.effective_start_date<=p_day)
     and (n.effective_end_date is null or n.effective_end_date>=p_day)
   order by lower(regexp_replace(btrim(n.title),'[[:space:]]+',' ','g')), priority desc,n.published_at desc,n.id
  ) n;
 exception when others then issues := array_append(issues,'중요 공지'); end;
 begin
  with events as (
   select s.title,s.starts_at,s.ends_at,s.all_day,s.revision_no>1 as changed
   from public.schedule_items s
   where s.status='published' and s.archived_at is null and s.target_scope='company'
     and s.starts_at<window_end and coalesce(s.ends_at,s.starts_at+interval '1 microsecond')>day_start
   union all
   select n.title,n.effective_start_date::timestamp at time zone 'Asia/Seoul',
     (coalesce(n.effective_end_date,n.effective_start_date)+1)::timestamp at time zone 'Asia/Seoul',true,n.version_no>1
   from public.notices n
   where n.status='published' and n.archived_at is null and n.target_scope='company'
     and n.published_at<=now() and n.publish_start_at<window_end and coalesce(n.publish_end_at,'infinity')>=day_start
     and n.notice_kind in ('working_hours','work_location','training','external_activity','holiday','transport')
     and n.effective_start_date<p_day+8 and coalesce(n.effective_end_date,n.effective_start_date)>=p_day
     and n.related_schedule_id is null
  ), dedup as (
   select distinct on (lower(regexp_replace(btrim(title),'[[:space:]]+',' ','g')),starts_at)
    btrim(title) as title, starts_at,ends_at,all_day,changed
   from events
   order by lower(regexp_replace(btrim(title),'[[:space:]]+',' ','g')),starts_at,changed desc,ends_at desc nulls last,all_day
  )
  select coalesce(jsonb_agg(
   concat(case when changed then '[변경] ' end,
          case when not all_day and starts_at>=day_start then to_char(starts_at at time zone 'Asia/Seoul','HH24:MI')||' ' end,title)
   order by changed desc,starts_at,title) filter(where starts_at<next_start),'[]'),
   coalesce(jsonb_agg(concat(to_char(starts_at at time zone 'Asia/Seoul','MM/DD'),' ',
     case when changed then '[변경] ' end,
     case when not all_day then to_char(starts_at at time zone 'Asia/Seoul','HH24:MI')||' ' end,title)
     order by changed desc,starts_at,title) filter(where starts_at>=next_start),'[]')
  into today_events,future_events from dedup;
 exception when others then issues := array_append(issues,'공용 일정'); end;
 begin
  with employee_days as materialized (
   select e.attendance_required,l.id is not null as on_leave,
     public.private_employee_schedule(e.id,p_day) as schedule,
     case
       when grouped.name in ('오전반','오후반') then grouped.name
       when t.starts_at<time '12:00' then '오전반'
       when t.starts_at>=time '12:00' then '오후반'
       else '근무반 미지정'
     end as shift
   from public.employees e
   left join lateral (select (public.private_work_terms(e.id,p_day)).starts_at) t on true
   left join lateral (
    select g.name from public.account_person_links a
    join public.work_group_members m on m.profile_id=a.profile_id and m.member_type='worker'
    join public.work_groups g on g.id=m.work_group_id and g.active and g.name in ('오전반','오후반')
    where a.person_id=e.person_id and a.revoked_at is null and m.start_date<=p_day
      and (m.end_date is null or m.end_date>=p_day)
    order by m.start_date desc,g.sort_order,g.id limit 1
   ) grouped on true
   left join public.employee_leave_requests l on l.employee_uuid=e.id and l.work_date=p_day and l.status='approved'
   where e.archived_at is null and e.employment_status='active' and e.hired_on<=p_day
     and (e.departed_on is null or e.departed_on>=p_day)
  ), shifts as (
   select shift,count(*) filter(where schedule->>'is_workday'='true') as working,
     count(*) filter(where on_leave) as leave_count
   from employee_days
   where on_leave or schedule->>'is_workday'='true'
   group by shift
  )
  select coalesce((select jsonb_agg(format('%s — 근무 %s명 · %s',shift,working,
   case when leave_count=0 then '연차 없음' else format('연차 %s명',leave_count) end)
   order by case shift when '오전반' then 1 when '오후반' then 2 else 3 end) from shifts),'[]'),
   (select count(*) from employee_days where attendance_required and schedule->>'configured' is distinct from 'true')
  into work_status,missing;
  if is_workday and missing>0 then issues := array_append(issues,format('근무조건 미등록 %s명',missing)); end if;
 exception when others then issues := array_append(issues,'근무·연차'); end;
 begin
  with applicable as (
   select r.value,r.ordinality from public.daily_briefing_settings settings
   cross join lateral jsonb_array_elements(settings.rules) with ordinality r
   where (r.value->>'active')::boolean
     and coalesce((r.value->>'from')::date,p_day)<=p_day
     and coalesce((r.value->>'until')::date,p_day)>=p_day
     and case r.value->>'frequency'
       when 'workday' then is_workday
       when 'weekly' then (r.value->'weekdays') @> jsonb_build_array(extract(isodow from p_day)::int)
       when 'monthly' then (r.value->>'month_day')::int=extract(day from p_day)::int
       else true end
  ), lines as (
   select value->>'kind' as kind,
    concat(case when value->>'audience'<>'전체' then (value->>'audience')||' — ' end,value->>'text') as line,
    (value->>'order')::int as sort_order,ordinality from applicable
  ), unique_lines as (
   select distinct on (kind,line) kind,line,sort_order,ordinality from lines order by kind,line,sort_order,ordinality
  )
  select coalesce(jsonb_agg(line order by sort_order,ordinality) filter(where kind='task'),'[]'),
         coalesce(jsonb_agg(line order by sort_order,ordinality) filter(where kind='rule'),'[]')
  into routine_tasks,rules from unique_lines;
 exception when others then issues := array_append(issues,'반복 설정'); end;
 return jsonb_build_object('is_workday',is_workday,'issues',to_jsonb(issues),
   'sections',jsonb_build_object(
     'headlines',headlines,'work',today_events||coalesce((
       select jsonb_agg(task.line order by task.ordinality)
       from jsonb_array_elements_text(routine_tasks) with ordinality task(line,ordinality)
       where not exists(select 1 from jsonb_array_elements_text(today_events) e(line)
         where lower(regexp_replace(e.line,'^(\[변경\] )?([0-9]{2}:[0-9]{2} )?','','g'))
           = lower(regexp_replace(task.line,'^(오전반|오후반) — ','')))
     ),'[]'),'staff',work_status,'upcoming',future_events,'rules',rules));
end $$;

create function private.ensure_daily_briefing(p_day date, p_actor uuid)
returns void language plpgsql set search_path = '' as $$
begin
 perform pg_advisory_xact_lock(151625,p_day-date '2000-01-01');
 if not exists(select 1 from public.daily_briefings where work_date=p_day) then
  insert into public.daily_briefings(work_date,version,source,created_by,updated_by)
  values (p_day,1,private.daily_briefing_source(p_day),p_actor,p_actor);
 end if;
end $$;

create function private.daily_briefing_payload(p_day date)
returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object(
  'date',p_day,
  'briefing',(select to_jsonb(b)||jsonb_build_object(
    'author',coalesce((select p.display_name from public.profiles p where p.id=b.created_by),'자동 생성'),
    'confirmer',(select p.display_name from public.profiles p where p.id=b.confirmed_by))
   from public.daily_briefings b where b.work_date=p_day order by b.version desc limit 1),
  'schedule',(select to_jsonb(s)-'rules'-'updated_by' from public.daily_briefing_settings s where singleton));
$$;

create function public.get_daily_briefing(p_day date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.daily_briefing_actor();
begin
 if p_day is null or p_day<date '2020-01-01' or p_day>date '2099-12-31' then raise exception 'BRIEFING_INVALID_DATE'; end if;
 if p_day>=(now() at time zone 'Asia/Seoul')::date then perform private.ensure_daily_briefing(p_day,actor); end if;
 return private.daily_briefing_payload(p_day);
end $$;

create function public.write_daily_briefing(
 p_day date,p_version integer,p_updated_at timestamptz,p_action text,p_edits jsonb,p_hidden text[],p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.daily_briefing_actor();
 current_brief public.daily_briefings;
 source_snapshot jsonb;
 section_names text[]:=array['headlines','work','staff','upcoming','rules'];
begin
 if p_day is null or p_day<date '2020-01-01' or p_day>date '2099-12-31'
  or p_action is null or p_action not in ('save','refresh','confirm','revise')
  or jsonb_typeof(p_edits) is distinct from 'object' or p_hidden is null or not p_hidden<@section_names
  or p_note is null or length(p_note)>1000 then raise exception 'BRIEFING_INVALID_INPUT'; end if;
 if exists(select 1 from jsonb_each(p_edits) e where e.key='staff' or not e.key=any(section_names)
      or jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}')>6000) then raise exception 'BRIEFING_INVALID_INPUT'; end if;
 perform pg_advisory_xact_lock(151625,p_day-date '2000-01-01');
 select * into current_brief from public.daily_briefings where work_date=p_day order by version desc limit 1 for update;
 if not found or current_brief.version is distinct from p_version or current_brief.updated_at is distinct from p_updated_at then
  raise exception using errcode='40001',message='BRIEFING_STALE';
 end if;
 if p_action='revise' then
  if current_brief.confirmed_at is null then raise exception 'BRIEFING_DRAFT_EXISTS'; end if;
  insert into public.daily_briefings(work_date,version,source,edits,hidden,note,created_by,updated_by)
  values(p_day,p_version+1,current_brief.source,current_brief.edits,current_brief.hidden,current_brief.note,actor,actor);
  return private.daily_briefing_payload(p_day);
 end if;
 if current_brief.confirmed_at is not null then raise exception 'BRIEFING_ALREADY_CONFIRMED'; end if;
 if p_action in ('refresh','confirm') then
  source_snapshot:=private.daily_briefing_source(p_day);
 else
  source_snapshot:=current_brief.source - 'generated_at';
 end if;
 if p_action='confirm' then
  if jsonb_array_length(source_snapshot->'issues')>0 then
   raise exception using message='BRIEFING_SOURCE_INCOMPLETE',detail=(source_snapshot->'issues')::text;
  end if;
  if source_snapshot is distinct from current_brief.source-'generated_at' then raise exception 'BRIEFING_SOURCE_CHANGED'; end if;
 end if;
 source_snapshot:=source_snapshot||jsonb_build_object('generated_at',case when p_action='refresh'
   then to_jsonb(now()) else coalesce(current_brief.source->'generated_at',to_jsonb(current_brief.created_at)) end);
 update public.daily_briefings set source=source_snapshot,edits=p_edits,hidden=p_hidden,note=btrim(p_note),
  updated_at=clock_timestamp(),updated_by=actor,
  confirmed_by=case when p_action='confirm' then actor end,
  confirmed_at=case when p_action='confirm' then clock_timestamp() end
 where work_date=p_day and version=p_version;
 return private.daily_briefing_payload(p_day);
end $$;

create function public.list_daily_briefings(p_before date default null,p_version integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 perform private.daily_briefing_actor();
 return (select coalesce(jsonb_agg(to_jsonb(page) order by work_date desc,version desc),'[]') from (
  select b.work_date,b.version,b.created_at,b.updated_at,b.confirmed_at,
   coalesce(a.display_name,'자동 생성') as author,m.display_name as editor,f.display_name as confirmer,
   (select array_agg(distinct d.action) from public.daily_briefing_deliveries d
     where d.work_date=b.work_date and d.version=b.version) as delivery_actions
  from public.daily_briefings b left join public.profiles a on a.id=b.created_by
   left join public.profiles m on m.id=b.updated_by left join public.profiles f on f.id=b.confirmed_by
  where p_before is null or (b.work_date,b.version)<(p_before,coalesce(p_version,0))
  order by b.work_date desc,b.version desc limit 30
 ) page);
end $$;

create function public.get_daily_briefing_version(p_day date,p_version integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 perform private.daily_briefing_actor();
 return (select to_jsonb(b)||jsonb_build_object('deliveries',
   coalesce((select jsonb_agg(jsonb_build_object('action',d.action,'at',d.attempted_at,'by',p.display_name)
     order by d.attempted_at desc)
     from public.daily_briefing_deliveries d join public.profiles p on p.id=d.actor_id
     where d.work_date=b.work_date and d.version=b.version),'[]'))
  from public.daily_briefings b where b.work_date=p_day and b.version=p_version);
end $$;

create function public.record_daily_briefing_delivery(p_id uuid,p_day date,p_version integer,p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.daily_briefing_actor();
begin
 if not exists(select 1 from public.daily_briefings where work_date=p_day and version=p_version and confirmed_at is not null) then
  raise exception 'BRIEFING_NOT_CONFIRMED';
 end if;
 insert into public.daily_briefing_deliveries(request_id,work_date,version,actor_id,action)
 values(p_id,p_day,p_version,actor,p_action) on conflict(request_id) do nothing;
end $$;

create function public.get_daily_briefing_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 perform private.daily_briefing_actor();
 return (select to_jsonb(s)-'updated_by' from public.daily_briefing_settings s where singleton);
end $$;

create function public.save_daily_briefing_settings(
 p_version integer,p_enabled boolean,p_generate time,p_review time,p_share time,p_rules jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.daily_briefing_actor();
begin
 if p_rules is null or jsonb_typeof(p_rules)<>'array' or jsonb_array_length(p_rules)>100
  or p_enabled is null or p_generate is null or p_review is null or p_share is null
  or p_generate>p_review or p_review>p_share or p_share>=time '24:00' then raise exception 'BRIEFING_INVALID_SETTINGS'; end if;
 if exists(select 1 from jsonb_array_elements(p_rules) r
   where jsonb_typeof(r) is distinct from 'object'
    or r->>'text' is null or length(btrim(r->>'text')) not between 1 and 400
    or coalesce(r->>'kind','') not in ('task','rule')
    or coalesce(r->>'audience','') not in ('전체','오전반','오후반')
    or jsonb_typeof(r->'active') is distinct from 'boolean'
    or coalesce(r->>'order','') !~ '^[0-9]{1,3}$'
    or (r->>'from')::date>(r->>'until')::date
    or coalesce(r->>'frequency','') not in ('workday','weekly','monthly','period')
    or (r->>'frequency'='period' and (r->>'from' is null or r->>'until' is null))
    or (r->>'frequency'='weekly' and case when jsonb_typeof(r->'weekdays')='array' then
       jsonb_array_length(r->'weekdays')=0 or not (r->'weekdays')<@'[1,2,3,4,5,6,7]' else true end)
    or (r->>'frequency'='monthly' and coalesce(r->>'month_day','') !~ '^([1-9]|[12][0-9]|3[01])$')
 ) then raise exception 'BRIEFING_INVALID_RULE'; end if;
 -- Both managers can maintain the company-wide repeat list. Only operations controls Cron times.
 if not public.current_user_has_role('operations_manager') and exists(
  select 1 from public.daily_briefing_settings s where singleton and
   (s.enabled,s.generate_at,s.review_at,s.share_at) is distinct from (p_enabled,p_generate,p_review,p_share)
 ) then raise exception using errcode='42501',message='BRIEFING_SCHEDULE_FORBIDDEN'; end if;
 update public.daily_briefing_settings set enabled=p_enabled,generate_at=p_generate,
   review_at=p_review,share_at=p_share,rules=p_rules,version=version+1,updated_by=actor,updated_at=clock_timestamp()
 where singleton and version=p_version;
 if not found then raise exception using errcode='40001',message='BRIEFING_SETTINGS_STALE'; end if;
 return public.get_daily_briefing_settings();
end $$;

create function private.run_daily_briefing(p_now timestamptz default now())
returns boolean language plpgsql set search_path = '' as $$
declare local_now timestamp:=p_now at time zone 'Asia/Seoul'; settings public.daily_briefing_settings;
begin
 select * into settings from public.daily_briefing_settings where singleton;
 if not settings.enabled or local_now::time<settings.generate_at
    or exists(select 1 from public.daily_briefings where work_date=local_now::date)
    or not private.daily_briefing_workday(local_now::date) then return false; end if;
 perform private.ensure_daily_briefing(local_now::date,null);
 return true;
end $$;

revoke all on function private.daily_briefing_actor(),private.daily_briefing_workday(date),
 private.daily_briefing_source(date),private.ensure_daily_briefing(date,uuid),private.daily_briefing_payload(date),
 private.run_daily_briefing(timestamptz) from public,anon,authenticated;
revoke all on function public.get_daily_briefing(date),public.write_daily_briefing(date,integer,timestamptz,text,jsonb,text[],text),
 public.list_daily_briefings(date,integer),public.get_daily_briefing_version(date,integer),
 public.record_daily_briefing_delivery(uuid,date,integer,text),public.get_daily_briefing_settings(),
 public.save_daily_briefing_settings(integer,boolean,time,time,time,jsonb) from public,anon,authenticated;
grant execute on function public.get_daily_briefing(date),public.write_daily_briefing(date,integer,timestamptz,text,jsonb,text[],text),
 public.list_daily_briefings(date,integer),public.get_daily_briefing_version(date,integer),
 public.record_daily_briefing_delivery(uuid,date,integer,text),public.get_daily_briefing_settings(),
 public.save_daily_briefing_settings(integer,boolean,time,time,time,jsonb) to authenticated;

-- Reuse the Cron extension installed for leave reconciliation. KST and company
-- workday checks are inside the job, so the database scheduler may stay in UTC.
select cron.schedule('taejang-daily-briefing','* * * * *','select private.run_daily_briefing();');

commit;
