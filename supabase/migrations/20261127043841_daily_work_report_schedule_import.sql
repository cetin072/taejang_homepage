begin;

alter table daily_work_private.reports
  add column imported_schedule_ids uuid[] not null default '{}';

-- Keep references to private calendar entries out of the report search response.
create or replace function daily_work_private.search_reports(p_from date,p_to date,p_query text,p_page integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  can_oversee boolean:=daily_work_private.access();
  term text:=lower(btrim(coalesce(p_query,'')));
  result jsonb;
begin
  if length(term)>120 or p_page is null or p_page not between 0 and 1000 or p_from>p_to
  then raise exception 'DAILY_WORK_INVALID' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)-'author_id'-'imported_schedule_ids'
            || jsonb_build_object('can_edit',r.author_id=actor)
            order by r.work_date desc,r.id desc),'[]'::jsonb) into result
  from (
    select j.* from daily_work_private.reports j
    where (can_oversee or j.author_id=actor)
      and (p_from is null or j.work_date>=p_from) and (p_to is null or j.work_date<=p_to)
      and (term='' or strpos(lower(concat_ws(' ',j.author_name,j.work_done,j.staff_notes,j.other_notes)),term)>0)
    order by j.work_date desc,j.id desc limit 51 offset p_page*50
  ) r;
  return result;
end $$;

create function daily_work_private.report_access()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'can_read_all',daily_work_private.access(),
    'author_name',coalesce((select nullif(btrim(p.display_name),'') from public.profiles p where p.id=auth.uid()),'이름 미등록')
  )
$$;

-- Use the same owner membership and Auth UUID as the shared personal calendar.
-- A Seoul calendar day is a half-open interval, including spanning events.
create function daily_work_private.schedule_candidates(p_date date)
returns table(id uuid,title text,starts_at timestamptz,all_day boolean,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare
  workspace uuid;
  day_start timestamptz;
  day_end timestamptz;
begin
  perform daily_work_private.access();
  if p_date is null or p_date not between date '2000-01-01' and date '2100-12-31' then
    raise exception 'DAILY_WORK_INVALID' using errcode='22023';
  end if;
  workspace:=private.calendar_workspace(false);
  day_start:=p_date::timestamp at time zone 'Asia/Seoul';
  day_end:=(p_date+1)::timestamp at time zone 'Asia/Seoul';
  return query
    select s.id,regexp_replace(btrim(s.title),'[[:space:]]+',' ','g'),s.starts_at,s.all_day,s.updated_at
    from worklog.schedules s
    where s.workspace_id=workspace and s.created_by_user_id=auth.uid()
      and s.status in ('confirmed','tentative')
      and s.starts_at<day_end and coalesce(s.ends_at,s.starts_at+interval '1 microsecond')>day_start
      and length(btrim(s.title))>0
    order by s.starts_at,s.id;
end $$;

create function daily_work_private.available_schedules(p_date date)
returns jsonb language sql security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(s) order by s.starts_at,s.id),'[]'::jsonb)
  from daily_work_private.schedule_candidates(p_date) s
  where not exists (
    select 1 from daily_work_private.reports j
    where j.author_id=auth.uid() and j.work_date=p_date and s.id=any(j.imported_schedule_ids)
  )
$$;

create function daily_work_private.save_with_schedules(
  p_date date,p_morning boolean,p_afternoon boolean,p_work text,p_staff text,p_other text,
  p_revision integer,p_schedules jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  existing daily_work_private.reports%rowtype;
  added_ids uuid[];
  expected_count integer;
  appended text;
  saved jsonb;
begin
  perform daily_work_private.access();
  if jsonb_typeof(p_schedules) is distinct from 'array' then
    raise exception 'DAILY_WORK_INVALID' using errcode='22023';
  end if;
  if jsonb_array_length(p_schedules)>100 then
    raise exception 'DAILY_WORK_INVALID' using errcode='22023';
  end if;
  if p_schedules='[]'::jsonb then
    return daily_work_private.save_report(p_date,p_morning,p_afternoon,p_work,p_staff,p_other,p_revision)-'imported_schedule_ids';
  end if;

  select * into existing from daily_work_private.reports j
  where j.author_id=actor and j.work_date=p_date for update;
  if p_revision is distinct from coalesce(existing.revision,0) then
    raise exception 'DAILY_WORK_CONFLICT' using errcode='40001';
  end if;

  with requested as (
    select distinct item.id,item.updated_at
    from jsonb_to_recordset(p_schedules) item(id uuid,updated_at timestamptz)
    where not coalesce(item.id=any(existing.imported_schedule_ids),false)
  )
  select (select count(*) from requested),
    array_agg(s.id order by s.starts_at,s.id),
    string_agg('- '||s.title,E'\n' order by s.starts_at,s.id)
  into expected_count,added_ids,appended
  from requested r join daily_work_private.schedule_candidates(p_date) s
    on s.id=r.id and s.updated_at=r.updated_at;
  if expected_count<>coalesce(cardinality(added_ids),0) then
    raise exception 'DAILY_WORK_SCHEDULE_CHANGED' using errcode='22023';
  end if;

  saved:=daily_work_private.save_report(p_date,p_morning,p_afternoon,
    concat_ws(E'\n',nullif(btrim(coalesce(p_work,'')),''),appended),
    p_staff,p_other,p_revision);
  if added_ids is not null then
    update daily_work_private.reports j set imported_schedule_ids=j.imported_schedule_ids||added_ids
    where j.author_id=actor and j.work_date=p_date;
  end if;
  return saved-'imported_schedule_ids';
end $$;

create function public.get_daily_work_report_access() returns jsonb
language sql stable security invoker set search_path='' as $$
  select daily_work_private.report_access()
$$;
create function public.list_daily_work_report_schedules(p_date date) returns jsonb
language sql security invoker set search_path='' as $$
  select daily_work_private.available_schedules(p_date)
$$;
create function public.save_daily_work_report_with_schedules(
  p_date date,p_morning boolean,p_afternoon boolean,p_work text,p_staff text,p_other text,
  p_revision integer,p_schedules jsonb
) returns jsonb language sql security invoker set search_path='' as $$
  select daily_work_private.save_with_schedules(p_date,p_morning,p_afternoon,p_work,p_staff,p_other,p_revision,p_schedules)
$$;

revoke all on function daily_work_private.schedule_candidates(date),daily_work_private.report_access(),
  daily_work_private.available_schedules(date),
  daily_work_private.save_with_schedules(date,boolean,boolean,text,text,text,integer,jsonb)
  from public,anon,authenticated;
grant execute on function daily_work_private.report_access(),daily_work_private.available_schedules(date),
  daily_work_private.save_with_schedules(date,boolean,boolean,text,text,text,integer,jsonb) to authenticated;
revoke all on function public.get_daily_work_report_access(),public.list_daily_work_report_schedules(date),
  public.save_daily_work_report_with_schedules(date,boolean,boolean,text,text,text,integer,jsonb)
  from public,anon,authenticated;
grant execute on function public.get_daily_work_report_access(),public.list_daily_work_report_schedules(date),
  public.save_daily_work_report_with_schedules(date,boolean,boolean,text,text,text,integer,jsonb)
  to authenticated;

commit;
