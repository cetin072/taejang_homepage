begin;

-- NULL distinguishes months created under the original confirmation contract.
alter table public.monthly_client_document_sets
  add column stage text check(stage in ('notice','performed','result','closed')),
  add column stage_plan text not null default 'three_step' check(stage_plan in ('three_step','notice_skipped','single_bundle')),
  add column stage_history jsonb not null default '[]' check(jsonb_typeof(stage_history)='array');
alter table public.monthly_client_document_sets alter column stage set default 'notice';

create table public.monthly_client_document_dispatches (
  set_id uuid not null references public.monthly_client_document_sets,
  company_id text not null references public.monthly_client_document_company_defaults,
  stage text not null check(stage in ('notice','result')),
  revision integer not null check(revision>0),
  documents text[] not null,
  sent_at timestamptz not null,
  sent_by uuid not null references public.profiles,
  note text not null default '',
  primary key(set_id,company_id,stage,revision)
);
create table public.monthly_client_document_files (
  set_id uuid not null references public.monthly_client_document_sets,
  company_id text not null references public.monthly_client_document_company_defaults,
  stage text not null check(stage in ('notice','result')),
  revision integer not null check(revision>0),
  kind text not null check(kind in ('pdf','docx')),
  storage_path text not null unique,
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key(set_id,company_id,stage,revision,kind)
);
create table public.monthly_client_document_settings (
  singleton boolean primary key default true check(singleton),
  contract_basis_text text not null,
  service_types jsonb not null,
  base_amount_by_year jsonb not null,
  rate numeric not null check(rate between 0 and 100)
);
insert into public.monthly_client_document_settings values
(true,'계약 별첨2(용역 제공 기준)',
 '{"env":{"item":"지역사회 환경정화 용역","report":"{N}월 지역사회 환경정화(청소) 용역","work":["{장소} 및 주변 보행로 구역 환경정화(청소)","수거 폐기물 분리 및 규정에 따른 배출"]},"farm":{"item":"농작업 지원 및 농장 환경정화 용역","report":"{N}월 농작업 지원 및 농장 환경정화 용역","work":["농작업 지원","농장 인근 환경정화"]},"custom":{"item":"","report":"","work":[]}}',
 '{"2026":1295000}',70);
alter table public.monthly_client_document_dispatches enable row level security;
alter table public.monthly_client_document_files enable row level security;
alter table public.monthly_client_document_settings enable row level security;
revoke all on public.monthly_client_document_dispatches,public.monthly_client_document_files,
  public.monthly_client_document_settings from public,anon,authenticated;
insert into storage.buckets(id,name,public) values ('monthly-client-documents','monthly-client-documents',false);

create function private.monthly_document_locked(p_id uuid,p_revision integer)
returns public.monthly_client_document_sets language plpgsql security definer set search_path='' as $$
declare r public.monthly_client_document_sets;
begin
  if public.private_actor_can('monthly_client_documents.manage') is not true then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into strict r from public.monthly_client_document_sets where id=p_id for update;
  if r.stage is null or r.calculation_version<>'monthly-stages-1' then raise exception 'LEGACY_MONTH'; end if;
  if p_revision is distinct from r.revision then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  return r;
end $$;

create function public.monthly_client_documents_merge_stages(p_id uuid,p_revision integer,p_plan text)
returns integer language plpgsql security definer set search_path='' as $$
declare r public.monthly_client_document_sets := private.monthly_document_locked(p_id,p_revision);
begin
  if r.stage<>'notice' or r.status<>'draft' or p_plan is null or p_plan not in ('three_step','notice_skipped','single_bundle')
     or exists(select from public.monthly_client_document_dispatches where set_id=p_id) then raise exception 'PLAN_LOCKED'; end if;
  update public.monthly_client_document_sets set stage_plan=p_plan,
    stage=case when p_plan='three_step' then 'notice' when p_plan='single_bundle' then 'result' else 'performed' end,
    revision=revision+1,updated_by=auth.uid(),updated_at=now() where id=p_id;
  return r.revision+1;
end $$;

create function public.monthly_client_documents_advance_stage(p_id uuid,p_revision integer)
returns integer language plpgsql security definer set search_path='' as $$
declare r public.monthly_client_document_sets := private.monthly_document_locked(p_id,p_revision);
begin
  if r.status<>'confirmed' or r.stage not in ('notice','performed') then raise exception 'CONFIRM_STAGE_FIRST'; end if;
  update public.monthly_client_document_sets set stage=case r.stage when 'notice' then 'performed' else 'result' end,
    status='draft',confirmed_at=null,confirmed_by=null,calculation_snapshot=null,updated_at=now(),updated_by=auth.uid(),
    revision=revision+1 where id=p_id;
  return r.revision+1;
end $$;

create function public.monthly_client_documents_record_dispatch(p_id uuid,p_revision integer,p_company text,p_sent_at timestamptz,p_note text default '',p_stage text default null)
returns void language plpgsql security definer set search_path='' as $$
declare r public.monthly_client_document_sets := private.monthly_document_locked(p_id,p_revision);
  docs text[];
  dispatch_stage text := coalesce(p_stage,r.stage);
  confirmed_revision integer := r.revision;
begin
  if dispatch_stage='notice' and r.stage in ('performed','result','closed') and r.stage_plan='three_step' then
    select (h->>'revision')::integer into confirmed_revision from jsonb_array_elements(r.stage_history) h
      where h->>'action'='confirm' and h->>'stage'='notice' order by (h->>'revision')::integer desc limit 1;
    if confirmed_revision is null then raise exception 'DISPATCH_UNAVAILABLE'; end if;
  elsif r.status<>'confirmed' or dispatch_stage<>r.stage or r.stage not in ('notice','result') then
    raise exception 'DISPATCH_UNAVAILABLE';
  end if;
  if p_sent_at is null or p_sent_at>now() or length(p_note)>500 then raise exception 'INVALID_DISPATCH'; end if;
  if not exists(select from jsonb_array_elements(r.payload->'companies') c where c->>'id'=p_company and (c->>'enabled')::boolean)
    then raise exception 'COMPANY_NOT_INCLUDED'; end if;
  docs:=case when dispatch_stage='notice' then array['notice'] when r.stage_plan='single_bundle' then array['notice','quote','report'] else array['quote','report'] end;
  insert into public.monthly_client_document_dispatches values(p_id,p_company,dispatch_stage,confirmed_revision,docs,p_sent_at,auth.uid(),coalesce(p_note,''))
    on conflict do nothing;
  if dispatch_stage='result' and not exists(select from jsonb_array_elements(r.payload->'companies') c
    where (c->>'enabled')::boolean and not exists(select from public.monthly_client_document_dispatches d
      where d.set_id=p_id and d.company_id=c->>'id' and d.stage=r.stage and d.revision=r.revision)) then
    update public.monthly_client_document_sets set stage='closed',revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=p_id;
  end if;
end $$;

create function public.monthly_client_documents_rewind_stage(p_id uuid,p_revision integer,p_reason text)
returns integer language plpgsql security definer set search_path='' as $$
declare r public.monthly_client_document_sets := private.monthly_document_locked(p_id,p_revision);
  target text;
begin
  if coalesce(trim(p_reason),'')='' then raise exception 'REASON_REQUIRED'; end if;
  target:=case when r.stage='closed' then 'result' when r.status='confirmed' then r.stage
    when r.stage='result' and r.stage_plan<>'single_bundle' then 'performed'
    when r.stage='performed' and r.stage_plan='three_step' then 'notice' end;
  if target is null then raise exception 'NO_PREVIOUS_STAGE'; end if;
  update public.monthly_client_document_sets set stage=target,status='draft',confirmed_at=null,confirmed_by=null,
    calculation_snapshot=null,revision=revision+1,updated_at=now(),updated_by=auth.uid(),
    stage_history=stage_history||jsonb_build_array(jsonb_build_object('action','rewind','from',stage,'to',target,
      'reason',trim(p_reason),'by',auth.uid(),'at',now(),'revision',revision+1)) where id=p_id;
  return r.revision+1;
end $$;

create function private.monthly_document_stage_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.payload->'common' ? 'noticeDate' then
      new.calculation_version:='monthly-stages-1';
    end if;
    return new;
  end if;
  if old.calculation_version<>'monthly-stages-1' then
    if old.status='draft' and new.status='draft' and new.payload->'common' ? 'noticeDate' then
      new.stage:='notice';
      new.calculation_version:='monthly-stages-1';
    end if;
    return new;
  end if;
  if not (new.payload->'common' ? 'noticeDate') then raise exception 'STAGE_PAYLOAD_REQUIRED'; end if;
  if old.stage in ('performed','result') and (old.stage_plan='three_step' or (old.stage='result' and old.stage_plan='notice_skipped')) and old.payload<>new.payload then
    if old.payload->'companies' is distinct from new.payload->'companies'
       or (old.payload->'common' - array['actualPerfDates','safety','workDescription','promotion','photoSets','reportDate','quoteDate','extras'])
         is distinct from (new.payload->'common' - array['actualPerfDates','safety','workDescription','promotion','photoSets','reportDate','quoteDate','extras']) then
      raise exception 'PREVIOUS_STAGE_LOCKED';
    end if;
    if old.stage='result' and old.stage_plan<>'single_bundle' and (old.payload->'common' - array['promotion','photoSets','reportDate','quoteDate'])
      is distinct from (new.payload->'common' - array['promotion','photoSets','reportDate','quoteDate']) then
      raise exception 'PREVIOUS_STAGE_LOCKED';
    end if;
  end if;
  if old.status='confirmed' and new.status='draft' and old.stage=new.stage and old.stage_history=new.stage_history then
    raise exception 'USE_REWIND_WITH_REASON';
  end if;
  if new.stage='closed' and new.status<>'confirmed' then raise exception 'MONTH_CLOSED'; end if;
  if old.status='draft' and new.status='confirmed' then
    if new.payload->'common' ? 'noticeDate' then
      if (new.stage='notice' or new.stage_plan='single_bundle') and nullif(new.payload#>>'{common,noticeDate}','') is null then raise exception 'NOTICE_DATE_REQUIRED'; end if;
      if new.stage in ('performed','result') and jsonb_array_length(coalesce(new.payload#>'{common,actualPerfDates}','[]'))=0 then
        raise exception 'ACTUAL_DATES_REQUIRED';
      end if;
      if new.stage='result' and (nullif(new.payload#>>'{common,reportDate}','') is null or nullif(new.payload#>>'{common,quoteDate}','') is null) then
        raise exception 'RESULT_DATES_REQUIRED';
      end if;
    end if;
    new.stage_history:=old.stage_history||jsonb_build_array(jsonb_build_object('action','confirm','stage',new.stage,
      'by',new.confirmed_by,'at',new.confirmed_at,'revision',new.revision,'payload',new.payload,'calculation',new.calculation_snapshot));
  end if;
  if old.stage<>new.stage and new.stage='closed' then
    new.stage_history:=new.stage_history||jsonb_build_array(jsonb_build_object('action','closed','at',now(),'by',auth.uid(),'revision',new.revision));
  end if;
  return new;
end $$;
create trigger monthly_document_stage_guard before insert or update on public.monthly_client_document_sets
for each row execute function private.monthly_document_stage_guard();

create function public.monthly_client_documents_workflow(p_year integer,p_month integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.monthly_client_document_sets;
begin
  if public.private_actor_can('monthly_client_documents.manage') is not true then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into r from public.monthly_client_document_sets where year=p_year and month=p_month;
  if not found then return null; end if;
  return jsonb_build_object('id',r.id,'stage',r.stage,'plan',r.stage_plan,'revision',r.revision,'history',r.stage_history,
    'dates',jsonb_build_object('noticeDate',coalesce(r.payload#>>'{common,noticeDate}',r.payload#>>'{common,docDate}'),
      'reportDate',coalesce(r.payload#>>'{common,reportDate}',r.payload#>>'{common,docDate}'),
      'quoteDate',coalesce(r.payload#>>'{common,quoteDate}',r.payload#>>'{common,docDate}')),
    'dispatches',coalesce((select jsonb_agg(to_jsonb(d) order by sent_at) from public.monthly_client_document_dispatches d where set_id=r.id),'[]'::jsonb));
end $$;
revoke all on function private.monthly_document_locked(uuid,integer),private.monthly_document_stage_guard() from public,anon,authenticated;
revoke all on function public.monthly_client_documents_merge_stages(uuid,integer,text),
 public.monthly_client_documents_advance_stage(uuid,integer),public.monthly_client_documents_record_dispatch(uuid,integer,text,timestamptz,text,text),
 public.monthly_client_documents_rewind_stage(uuid,integer,text),public.monthly_client_documents_workflow(integer,integer) from public,anon;
grant execute on function public.monthly_client_documents_merge_stages(uuid,integer,text),
 public.monthly_client_documents_advance_stage(uuid,integer),public.monthly_client_documents_record_dispatch(uuid,integer,text,timestamptz,text,text),
 public.monthly_client_documents_rewind_stage(uuid,integer,text),public.monthly_client_documents_workflow(integer,integer) to authenticated;

-- Only adapt the input to the existing calculator. Keep its original rounding and output.
alter function private.monthly_client_documents_calculate(integer,integer,jsonb,boolean)
  rename to monthly_client_documents_calculate_v2;
create function private.monthly_client_documents_calculate(p_year integer,p_month integer,p_payload jsonb,p_require_ready boolean)
returns jsonb language plpgsql immutable set search_path='' as $$
declare c jsonb:=p_payload->'common'; day_value text; mode text;
begin
  if c ? 'noticeDate' then
    if coalesce(c->>'serviceType','') not in ('env','farm','custom')
      or coalesce(c#>>'{promotion,status}','') not in ('posted','planned','none')
      or jsonb_typeof(c->'photoSets') is distinct from 'array' then raise exception 'INVALID_RESULT_INPUT'; end if;
    if exists(select from jsonb_array_elements_text(c->'photoSets') f where f is null or f not in ('safety','site','group'))
       or exists(select from jsonb_array_elements_text(c->'photoSets') f group by f having count(*)>1) then raise exception 'INVALID_PHOTO_SETS'; end if;
    mode:=c#>>'{safety,mode}';
    if mode is null or mode not in ('outdoor','indoor_hq','indoor_video','custom')
      or (mode='custom' and p_require_ready and nullif(trim(c#>>'{safety,text}'),'') is null) then raise exception 'INVALID_SAFETY'; end if;
    if jsonb_typeof(c->'actualPerfDates') is distinct from 'array' then raise exception 'INVALID_ACTUAL_DATES'; end if;
    for day_value in select jsonb_array_elements_text(c->'actualPerfDates')
      union all select unnest(array[nullif(c->>'noticeDate',''),nullif(c->>'quoteDate',''),nullif(c->>'reportDate','')]) loop
      if day_value is not null and (day_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(day_value::date,'YYYY-MM-DD')<>day_value) then
        raise exception 'INVALID_DOCUMENT_DATE';
      end if;
    end loop;
    if jsonb_array_length(c->'actualPerfDates')>4 or exists(select from jsonb_array_elements_text(c->'actualPerfDates') d group by d having count(*)>1) or exists(select from jsonb_array_elements(c->'actualPerfDates') d where jsonb_typeof(d)<>'string') then raise exception 'INVALID_ACTUAL_DATES'; end if;
    c:=c||jsonb_build_object('safety',case when mode='outdoor' then 'outdoor' else 'indoor' end,
      'docDate',coalesce(nullif(c->>'noticeDate',''),nullif(c->>'quoteDate',''),c#>>'{perfDates,0}',''),'perfDate',c#>>'{perfDates,0}');
    p_payload:=jsonb_set(p_payload,'{common}',c);
  end if;
  return private.monthly_client_documents_calculate_v2(p_year,p_month,p_payload,p_require_ready);
end $$;
revoke all on function private.monthly_client_documents_calculate(integer,integer,jsonb,boolean) from public,anon,authenticated;

create function public.monthly_client_documents_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if public.private_actor_can('monthly_client_documents.manage') is not true then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  return (select to_jsonb(s)-'singleton' from public.monthly_client_document_settings s);
end $$;
revoke all on function public.monthly_client_documents_settings() from public,anon;
grant execute on function public.monthly_client_documents_settings() to authenticated;
create or replace function public.monthly_client_documents_copy_previous(p_year integer,p_month integer)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare prior_year integer; prior_month integer; prior_payload jsonb; next_payload jsonb; current_row public.monthly_client_document_sets%rowtype;
begin
  if not public.private_actor_can('monthly_client_documents.manage') then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_year is null or p_month is null or p_year not between 2000 and 9999 or p_month not between 1 and 12 then raise exception using errcode='22023',message='INVALID_MONTH'; end if;
  if p_month=1 then prior_year:=p_year-1; prior_month:=12; else prior_year:=p_year; prior_month:=p_month-1; end if;
  select payload into prior_payload from public.monthly_client_document_sets where year=prior_year and month=prior_month;
  if prior_payload is null then raise exception using errcode='P0002',message='PREVIOUS_MONTH_NOT_FOUND'; end if;
  next_payload := jsonb_set(prior_payload,'{common,year}',to_jsonb(p_year),true);
  next_payload := jsonb_set(next_payload,'{common,month}',to_jsonb(p_month),true);
  next_payload := jsonb_set(next_payload,'{common,docDate}','""'::jsonb,true);
  next_payload := jsonb_set(next_payload,'{common,perfDate}','""'::jsonb,true);
  next_payload := jsonb_set(next_payload,'{common,note}','""'::jsonb,true);
  next_payload := jsonb_set(next_payload,'{common,extras}','[]'::jsonb,true);
  if prior_payload->'common' ? 'perfDates' then
    next_payload := jsonb_set(next_payload,'{common,perfDates}','[""]'::jsonb,true);
    next_payload := jsonb_set(next_payload,'{common,workDescription}','""'::jsonb,true);
  end if;
  next_payload := jsonb_set(next_payload,'{companies}',coalesce((select jsonb_agg(jsonb_set(value,'{note}','""'::jsonb,true) order by (value->>'seq')::integer) from jsonb_array_elements(prior_payload->'companies')),'[]'::jsonb),true);
  if next_payload->'common' ? 'noticeDate' then
    next_payload:=jsonb_set(next_payload,'{common}',next_payload->'common'||jsonb_build_object(
      'noticeDate','','quoteDate','','reportDate','','actualPerfDates','[]'::jsonb,
      'promotion',jsonb_build_object('status','none'),'photoSets','[]'::jsonb));
  end if;
  insert into public.monthly_client_document_sets(year,month,payload,created_by,updated_by,template_version)
    values(p_year,p_month,next_payload,auth.uid(),auth.uid(),case when next_payload->'common' ? 'perfDates' then 'client-template-2' else 'claude-template-1' end)
    on conflict(year,month) do nothing returning * into current_row;
  if not found then raise exception using errcode='P0001',message='MONTH_ALREADY_EXISTS'; end if;
  return jsonb_build_object('year',current_row.year,'month',current_row.month,'status',current_row.status,'revision',current_row.revision,'payload',current_row.payload,
    'calculationVersion',current_row.calculation_version,'templateVersion',current_row.template_version);
end; $$;


create function public.monthly_client_documents_update_settings(p_previous jsonb,p_settings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_settings jsonb;
begin
  if public.private_actor_can('monthly_client_documents.manage') is not true then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select to_jsonb(s)-'singleton' into strict current_settings from public.monthly_client_document_settings s for update;
  if current_settings is distinct from p_previous then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  if nullif(trim(p_settings->>'contract_basis_text'),'') is null or jsonb_typeof(p_settings->'base_amount_by_year') is distinct from 'object'
    or jsonb_typeof(p_settings->'rate') is distinct from 'number' or jsonb_typeof(p_settings->'service_types') is distinct from 'object'
    or not ((p_settings->'service_types') ?& array['env','farm','custom']) then raise exception 'INVALID_SETTINGS'; end if;
  if exists(select from jsonb_each(p_settings->'base_amount_by_year') where key !~ '^[0-9]{4}$' or jsonb_typeof(value)<>'number' or value::text !~ '^[0-9]+$')
    or exists(select from jsonb_each(p_settings->'service_types') where key not in ('env','farm','custom')
       or jsonb_typeof(value->'item') is distinct from 'string' or jsonb_typeof(value->'report') is distinct from 'string'
       or jsonb_typeof(value->'work') is distinct from 'array') then raise exception 'INVALID_SETTINGS'; end if;
  update public.monthly_client_document_settings set contract_basis_text=p_settings->>'contract_basis_text',service_types=p_settings->'service_types',
    base_amount_by_year=p_settings->'base_amount_by_year',rate=(p_settings->>'rate')::numeric where singleton;
  return public.monthly_client_documents_settings();
end $$;
revoke all on function public.monthly_client_documents_update_settings(jsonb,jsonb) from public,anon;
grant execute on function public.monthly_client_documents_update_settings(jsonb,jsonb) to authenticated;

-- The employee master currently has no standalone verified sex field.
-- Never infer it from names, positions or decrypted identity numbers.
create function public.monthly_client_documents_worker_counts(p_year integer,p_month integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare boundary date; severe_count integer; mild_count integer; unknown_count integer;
begin
  if public.private_actor_can('monthly_client_documents.manage') is not true then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_year is null or p_year not between 2000 and 9999 or p_month is null or p_month not between 1 and 12 then raise exception 'INVALID_MONTH'; end if;
  boundary:=make_date(p_year,p_month,1);
  select count(*) filter(where info.degree='severe'),count(*) filter(where info.degree='mild'),
    count(*) filter(where info.degree is null) into severe_count,mild_count,unknown_count
    from public.employees employee left join private.employee_disability_info info on info.employee_uuid=employee.id
    where employee.hired_on<=boundary and (employee.departed_on is null or employee.departed_on>=boundary)
      and (employee.archived_at is null or employee.archived_at::date>=boundary);
  if unknown_count>0 then raise exception 'WORKER_CLASSIFICATION_INCOMPLETE'; end if;
  if mild_count>0 then raise exception 'VERIFIED_SEX_COUNTS_UNAVAILABLE'; end if;
  return jsonb_build_object('severe',severe_count,'mildF',0,'mildM',0);
end $$;
revoke all on function public.monthly_client_documents_worker_counts(integer,integer) from public,anon;
grant execute on function public.monthly_client_documents_worker_counts(integer,integer) to authenticated;
commit;
