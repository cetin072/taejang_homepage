-- Local-reviewed additive change; DO NOT apply to shared/production DB without approval.
-- CLI migration-new could not initialize its read-only home; filename uses observed UTC time.
begin;

alter table public.support_notices add column application_period text
  check (char_length(coalesce(application_period,'')) <= 1000);

create table public.support_notice_interests (
  notice_id uuid primary key references public.support_notices(id) on delete restrict,
  interested boolean not null,
  revision integer not null check (revision > 0),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);
create table public.support_collection_runs (
  id uuid primary key,
  source_id uuid not null references public.support_sources(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  status text not null check(status in ('success_new','success_no_new','not_connected','authentication_failed','http_error','network_error','invalid_response')),
  added integer not null default 0 check(added>=0),
  updated integer not null default 0 check(updated>=0),
  items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items)<=100),
  completed_at timestamptz not null default clock_timestamp()
);
create index support_collection_runs_source_time on public.support_collection_runs(source_id,completed_at desc);
alter table public.support_notice_interests enable row level security;
alter table public.support_collection_runs enable row level security;
revoke all on public.support_notice_interests, public.support_collection_runs from public,anon,authenticated;
-- RPC-only: retain existing operations/CEO management boundary, including capability restriction.

create function public.support_set_notice_interest(p_notice_id uuid,p_interested boolean,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous public.support_notice_interests%rowtype; result public.support_notice_interests%rowtype;
begin
  if actor is null or not public.current_profile_is_active() or not public.current_user_has_role('operations_manager')
     or not public.private_actor_can('support_radar.management_edit') then
    raise exception using errcode='42501',message='SUPPORT_INTEREST_FORBIDDEN';
  end if;
  if p_interested is null or p_expected_revision is null or p_expected_revision<0 then
    raise exception using errcode='22023',message='SUPPORT_INTEREST_INPUT_INVALID';
  end if;
  -- Notice lock serializes the absent-row case as well as updates. No data is deleted.
  perform 1 from public.support_notices where id=p_notice_id and archived_at is null for update;
  if not found then raise exception using errcode='P0002',message='SUPPORT_NOTICE_NOT_FOUND'; end if;
  select * into previous from public.support_notice_interests where notice_id=p_notice_id;
  if coalesce(previous.revision,0)<>p_expected_revision then
    -- Business revision conflicts must not trigger PostgREST serialization retries.
    raise exception using errcode='PT409',message='SUPPORT_INTEREST_REVISION_CONFLICT';
  end if;
  if previous.notice_id is not null and previous.interested=p_interested then return to_jsonb(previous); end if;
  insert into public.support_notice_interests(notice_id,interested,revision,updated_by)
  values(p_notice_id,p_interested,coalesce(previous.revision,0)+1,actor)
  on conflict(notice_id) do update set interested=excluded.interested,revision=excluded.revision,updated_by=actor,updated_at=clock_timestamp()
  returning * into result;
  perform public.private_append_audit(actor,'support_interest_changed','support_notice',p_notice_id::text,'success','조직 공통 관심 보관 변경',
    jsonb_build_object('before',previous.interested,'after',result.interested,'revision',result.revision));
  return to_jsonb(result);
end; $$;

create function public.support_record_bizinfo_collection(p_run_id uuid,p_status text,p_items jsonb default '[]')
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare
  actor uuid:=auth.uid(); src public.support_sources%rowtype; oldrun public.support_collection_runs%rowtype;
  result public.support_collection_runs%rowtype; item jsonb; normalized jsonb; clean_items jsonb:='[]';
  occ public.support_notice_occurrences%rowtype; n public.support_notices%rowtype; old jsonb;
  new_count integer:=0; changed_count integer:=0; nid uuid; start_at timestamptz; end_at timestamptz;
begin
  if actor is null or not public.current_profile_is_active() or not public.current_user_has_role('operations_manager')
     or not public.private_actor_can('support_radar.management_edit') then
    raise exception using errcode='42501',message='SUPPORT_COLLECTION_FORBIDDEN';
  end if;
  if p_run_id is null or p_status is null or p_status not in ('success','not_connected','authentication_failed','http_error','network_error','invalid_response')
     or p_items is null or jsonb_typeof(p_items)<>'array' then
    raise exception using errcode='22023',message='SUPPORT_COLLECTION_INPUT_INVALID';
  end if;
  if jsonb_array_length(p_items)>100 or octet_length(p_items::text)>2000000 or (p_status<>'success' and jsonb_array_length(p_items)<>0) then
    raise exception using errcode='22023',message='SUPPORT_COLLECTION_BATCH_INVALID';
  end if;
  -- This existing source row lock serializes overlapping collectors; existing unique occurrence index is the final guard.
  select * into src from public.support_sources where code='bizinfo' and active and terms_review_status='allowed' for update;
  if not found then raise exception using errcode='22023',message='SUPPORT_BIZINFO_SOURCE_UNAVAILABLE'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item)<>'object' or coalesce(item->>'source_notice_id','')!~'^PBLN_[A-Za-z0-9_-]+$'
       or char_length(item->>'source_notice_id')>240 or char_length(btrim(coalesce(item->>'title',''))) not between 1 and 500
       or coalesce(item->>'canonical_url','')!~'^https?://[^/@[:space:]]+([/?#]|$)' or char_length(item->>'canonical_url')>2000
       or char_length(coalesce(item->>'application_period',''))>1000
       or char_length(coalesce(item->>'managing_organization',''))>240
       or char_length(coalesce(item->>'implementing_organization',''))>240
       or char_length(coalesce(item->>'eligibility_summary',''))>12000 then
      raise exception using errcode='22023',message='SUPPORT_COLLECTION_NOTICE_INVALID';
    end if;
    start_at:=nullif(item->>'application_start_at','')::timestamptz;
    end_at:=nullif(item->>'deadline_at','')::timestamptz;
    if (start_at is not null and not isfinite(start_at)) or (end_at is not null and not isfinite(end_at))
       or (start_at is not null and end_at<start_at) then
      raise exception using errcode='22023',message='SUPPORT_COLLECTION_PERIOD_INVALID';
    end if;
    -- Whitelist source data only. Unknown fields (including notes, decisions and credentials) are not stored.
    normalized:=jsonb_build_object('source_notice_id',item->>'source_notice_id','title',btrim(item->>'title'),
      'canonical_url',item->>'canonical_url','managing_organization',item->>'managing_organization',
      'implementing_organization',item->>'implementing_organization','eligibility_summary',item->>'eligibility_summary',
      'application_period',item->>'application_period','application_start_at',start_at,'deadline_at',end_at);
    clean_items:=clean_items||jsonb_build_array(normalized);
  end loop;
  if exists(select 1 from jsonb_array_elements(clean_items) i group by i->>'source_notice_id' having count(*)>1) then
    raise exception using errcode='22023',message='SUPPORT_COLLECTION_DUPLICATE_INPUT';
  end if;
  select * into oldrun from public.support_collection_runs where id=p_run_id;
  if found then
    if oldrun.source_id<>src.id or oldrun.items<>clean_items or
      (case when oldrun.status like 'success_%' then 'success' else oldrun.status end)<>p_status then
      raise exception using errcode='22023',message='SUPPORT_COLLECTION_RUN_CONFLICT';
    end if;
    return to_jsonb(oldrun)-'items';
  end if;
  for item in select value from jsonb_array_elements(clean_items) loop
    select * into occ from public.support_notice_occurrences where source_id=src.id and source_notice_id=item->>'source_notice_id' for update;
    if not found then
      insert into public.support_notices(title,canonical_url,managing_organization,implementing_organization,
        eligibility_summary,application_period,application_start_at,deadline_at,notice_status)
      values(item->>'title',item->>'canonical_url',item->>'managing_organization',item->>'implementing_organization',
        item->>'eligibility_summary',item->>'application_period',(item->>'application_start_at')::timestamptz,
        (item->>'deadline_at')::timestamptz,'unknown') returning id into nid;
      insert into public.support_notice_occurrences(notice_id,source_id,source_notice_id,source_url,raw_title,raw_payload)
      values(nid,src.id,item->>'source_notice_id',item->>'canonical_url',item->>'title',item);
      new_count:=new_count+1;
    else
      old:=occ.raw_payload;
      select * into n from public.support_notices where id=occ.notice_id for update;
      if old is distinct from item then
        -- Three-way update: only replace values still matching the previous source snapshot.
        -- Operator corrections and all separate notes/evaluations/decisions/assignments remain intact.
        update public.support_notices set
          title=case when title is not distinct from old->>'title' then item->>'title' else title end,
          canonical_url=case when canonical_url is not distinct from old->>'canonical_url' then item->>'canonical_url' else canonical_url end,
          managing_organization=case when managing_organization is not distinct from old->>'managing_organization' then item->>'managing_organization' else managing_organization end,
          implementing_organization=case when implementing_organization is not distinct from old->>'implementing_organization' then item->>'implementing_organization' else implementing_organization end,
          eligibility_summary=case when eligibility_summary is not distinct from old->>'eligibility_summary' then item->>'eligibility_summary' else eligibility_summary end,
          application_period=case when application_period is not distinct from old->>'application_period' then item->>'application_period' else application_period end,
          application_start_at=case when application_start_at is not distinct from (old->>'application_start_at')::timestamptz then (item->>'application_start_at')::timestamptz else application_start_at end,
          deadline_at=case when deadline_at is not distinct from (old->>'deadline_at')::timestamptz then (item->>'deadline_at')::timestamptz else deadline_at end,
          source_updated_at=clock_timestamp(),updated_at=clock_timestamp()
        where id=n.id and archived_at is null;
        changed_count:=changed_count+1;
      end if;
      update public.support_notice_occurrences set raw_payload=item,source_url=item->>'canonical_url',raw_title=item->>'title',last_seen_at=clock_timestamp() where id=occ.id;
    end if;
  end loop;
  insert into public.support_collection_runs(id,source_id,actor_id,status,added,updated,items)
  values(p_run_id,src.id,actor,case when p_status='success' then case when new_count>0 then 'success_new' else 'success_no_new' end else p_status end,new_count,changed_count,clean_items)
  returning * into result;
  update public.support_sources set last_checked_at=result.completed_at,
    last_success_at=case when p_status='success' then result.completed_at else last_success_at end,
    last_error_summary=case when p_status='success' then null else p_status end where id=src.id;
  perform public.private_append_audit(actor,'support_collection_recorded','support_source',src.id::text,'success','기업마당 수집 결과 기록',
    jsonb_build_object('run_id',p_run_id,'status',result.status,'added',new_count,'updated',changed_count));
  return to_jsonb(result)-'items';
end; $$;

create function public.support_get_collection_state()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare src public.support_sources%rowtype;
begin
  if auth.uid() is null or not public.current_profile_is_active() or
     not (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo')) or
     not public.private_actor_can('support_radar.management_view') then
    raise exception using errcode='42501',message='SUPPORT_COLLECTION_VIEW_FORBIDDEN';
  end if;
  select * into src from public.support_sources where code='bizinfo' and active;
  return jsonb_build_object('source',to_jsonb(src),'latest_run',(
    select to_jsonb(r)-'items' from public.support_collection_runs r where r.source_id=src.id order by completed_at desc,id desc limit 1));
end; $$;

create function public.support_list_finder_notices(p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb;
begin
  if auth.uid() is null or not public.current_profile_is_active() or
     not (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo')) or
     not public.private_actor_can('support_radar.management_view') then
    raise exception using errcode='42501',message='SUPPORT_FINDER_FORBIDDEN';
  end if;
  base:=public.support_list_notices(p_limit);
  return coalesce((select jsonb_agg(item||jsonb_build_object('canonical_url',n.canonical_url,'eligibility_summary',n.eligibility_summary,
    'application_start_at',n.application_start_at,'application_period',n.application_period,
    'interested',coalesce(i.interested,false),'interest_revision',coalesce(i.revision,0)) order by ord)
    from jsonb_array_elements(base) with ordinality a(item,ord)
    join public.support_notices n on n.id=(item->>'id')::uuid
    left join public.support_notice_interests i on i.notice_id=n.id),'[]');
end; $$;

create function public.support_get_finder_notice_detail(p_notice_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb; interest public.support_notice_interests%rowtype;
begin
  if auth.uid() is null or not public.current_profile_is_active() or
     not (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo')) or
     not public.private_actor_can('support_radar.management_view') then
    raise exception using errcode='42501',message='SUPPORT_FINDER_FORBIDDEN';
  end if;
  base:=public.support_get_notice_detail(p_notice_id);
  select * into interest from public.support_notice_interests where notice_id=p_notice_id;
  return base||jsonb_build_object('interest',jsonb_build_object('interested',coalesce(interest.interested,false),'revision',coalesce(interest.revision,0)));
end; $$;

revoke all on function public.support_set_notice_interest(uuid,boolean,integer),public.support_record_bizinfo_collection(uuid,text,jsonb),
 public.support_get_collection_state(),public.support_list_finder_notices(integer),public.support_get_finder_notice_detail(uuid) from public,anon;
grant execute on function public.support_set_notice_interest(uuid,boolean,integer),public.support_record_bizinfo_collection(uuid,text,jsonb),
 public.support_get_collection_state(),public.support_list_finder_notices(integer),public.support_get_finder_notice_detail(uuid) to authenticated;
commit;
