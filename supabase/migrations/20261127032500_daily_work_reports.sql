begin;
create schema if not exists daily_work_private;
revoke all on schema daily_work_private from public, anon, authenticated;
grant usage on schema daily_work_private to authenticated;
create table daily_work_private.reports (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.profiles(id),
  author_name text not null,
  work_date date not null,
  morning boolean not null,
  afternoon boolean not null,
  work_done text not null check (length(btrim(work_done)) between 1 and 8000),
  staff_notes text not null check (length(staff_notes)<=8000),
  other_notes text not null check (length(other_notes)<=8000),
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  unique(author_id,work_date),
  check (morning or afternoon)
);
alter table daily_work_private.reports enable row level security;
revoke all on all tables in schema daily_work_private from public, anon, authenticated;
revoke all on all sequences in schema daily_work_private from public, anon, authenticated;
create index daily_work_reports_by_date on daily_work_private.reports(work_date desc,id desc);

create function daily_work_private.access() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  eligible text[]:=array['department_lead','promotion_lead','operations_manager','ceo'];
  oversight text[]:=array['operations_manager','ceo'];
  actual text[]:=public.private_actual_role_codes();
  effective text[]:=public.private_effective_role_codes();
begin
  if actor is null or public.current_profile_is_active() is not true
    or not coalesce(actual && eligible,false) or not coalesce(effective && eligible,false)
    or exists(select 1 from public.role_simulation_modes m where m.profile_id=actor and m.expires_at>now())
  then raise exception 'DAILY_WORK_FORBIDDEN' using errcode='42501'; end if;
  return actual && oversight and effective && oversight;
end $$;

create function daily_work_private.search_reports(p_from date,p_to date,p_query text,p_page integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  can_oversee boolean:=daily_work_private.access();
  term text:=lower(btrim(coalesce(p_query,'')));
  result jsonb;
begin
  if length(term)>120 or p_page is null or p_page not between 0 and 1000 or p_from>p_to
  then raise exception 'DAILY_WORK_INVALID' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)-'author_id' || jsonb_build_object('can_edit',r.author_id=actor)
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

create function daily_work_private.save_report(p_date date,p_morning boolean,p_afternoon boolean,p_work text,p_staff text,p_other text,p_revision integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  name text;
  saved_report daily_work_private.reports%rowtype;
begin
  perform daily_work_private.access();
  if p_date is null or p_date<date '2000-01-01' or p_date>date '2100-12-31'
    or p_morning is null or p_afternoon is null or not (p_morning or p_afternoon)
    or p_revision is null or p_revision<0
    or p_work is null or length(btrim(p_work)) not between 1 and 8000
    or length(coalesce(p_staff,''))>8000 or length(coalesce(p_other,''))>8000
  then raise exception 'DAILY_WORK_INVALID' using errcode='22023'; end if;
  select coalesce(nullif(btrim(p.display_name),''),'이름 미등록') into name from public.profiles p where p.id=actor;
  if p_revision=0 then
    insert into daily_work_private.reports(author_id,author_name,work_date,morning,afternoon,work_done,staff_notes,other_notes)
    values(actor,name,p_date,p_morning,p_afternoon,btrim(p_work),coalesce(p_staff,''),coalesce(p_other,''))
    on conflict(author_id,work_date) do nothing returning * into saved_report;
  else
    update daily_work_private.reports j set
      morning=p_morning,afternoon=p_afternoon,work_done=btrim(p_work),staff_notes=coalesce(p_staff,''),
      other_notes=coalesce(p_other,''),revision=j.revision+1,updated_at=now()
    where j.author_id=actor and j.work_date=p_date and j.revision=p_revision returning * into saved_report;
  end if;
  if saved_report.id is null then raise exception 'DAILY_WORK_CONFLICT' using errcode='40001'; end if;
  return (to_jsonb(saved_report)-'author_id') || jsonb_build_object('can_edit',true);
end $$;

create function public.search_daily_work_reports(p_from date,p_to date,p_query text,p_page integer)
returns jsonb language sql stable security invoker set search_path='' as $$
 select daily_work_private.search_reports(p_from,p_to,p_query,p_page)
$$;
create function public.save_daily_work_report(p_date date,p_morning boolean,p_afternoon boolean,p_work text,p_staff text,p_other text,p_revision integer)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select daily_work_private.save_report(p_date,p_morning,p_afternoon,p_work,p_staff,p_other,p_revision)
$$;
revoke all on all functions in schema daily_work_private from public,anon,authenticated;
grant execute on function daily_work_private.search_reports(date,date,text,integer),daily_work_private.save_report(date,boolean,boolean,text,text,text,integer) to authenticated;
revoke all on function public.search_daily_work_reports(date,date,text,integer),public.save_daily_work_report(date,boolean,boolean,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.search_daily_work_reports(date,date,text,integer),public.save_daily_work_report(date,boolean,boolean,text,text,text,integer) to authenticated;
commit;
