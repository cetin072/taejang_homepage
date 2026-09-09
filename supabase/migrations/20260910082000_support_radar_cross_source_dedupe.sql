-- Support Radar Phase 1 cross-source duplicate handling.
-- Conservative by design: candidates are suggested, never auto-merged.

begin;

create or replace function public.support_normalize_notice_title(p_title text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(lower(coalesce(p_title,'')), '[^0-9a-z가-힣]+', '', 'g');
$$;

create or replace function public.support_find_duplicate_candidates(
  p_title text,
  p_deadline_at timestamptz default null,
  p_managing_organization text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized text := public.support_normalize_notice_title(p_title);
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='SUPPORT_DEDUPE_CHECK_FORBIDDEN';
  end if;
  if normalized='' then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'notice_id',n.id,
      'title',n.title,
      'organization',coalesce(n.implementing_organization,n.managing_organization),
      'deadline_at',n.deadline_at,
      'canonical_url',n.canonical_url,
      'occurrence_count',(select count(*) from public.support_notice_occurrences o where o.notice_id=n.id)
    ) order by n.deadline_at nulls last, n.created_at desc)
    from public.support_notices n
    where n.archived_at is null
      and public.support_normalize_notice_title(n.title)=normalized
      and (
        p_deadline_at is null or n.deadline_at is null
        or abs(extract(epoch from (n.deadline_at-p_deadline_at))) <= 3*86400
      )
      and (
        nullif(btrim(coalesce(p_managing_organization,'')),'') is null
        or coalesce(n.implementing_organization,n.managing_organization) is null
        or lower(coalesce(n.implementing_organization,n.managing_organization,''))=lower(btrim(p_managing_organization))
      )
  ),'[]'::jsonb);
end;
$$;

create or replace function public.support_attach_notice_occurrence(
  p_notice_id uuid,
  p_source_id uuid,
  p_source_url text,
  p_source_notice_id text default null,
  p_raw_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  occurrence_id uuid;
  existing_id uuid;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='SUPPORT_OCCURRENCE_ATTACH_FORBIDDEN';
  end if;
  if not exists(select 1 from public.support_notices n where n.id=p_notice_id and n.archived_at is null) then
    raise exception using errcode='P0002', message='SUPPORT_NOTICE_NOT_FOUND';
  end if;
  if not exists(select 1 from public.support_sources s where s.id=p_source_id and s.active) then
    raise exception using errcode='22023', message='SUPPORT_SOURCE_NOT_ACTIVE';
  end if;
  if nullif(btrim(coalesce(p_source_url,'')),'') is null then
    raise exception using errcode='22023', message='SUPPORT_NOTICE_SOURCE_URL_REQUIRED';
  end if;

  if nullif(btrim(coalesce(p_source_notice_id,'')),'') is not null then
    select o.id into existing_id
    from public.support_notice_occurrences o
    where o.source_id=p_source_id and o.source_notice_id=btrim(p_source_notice_id)
    limit 1;
    if existing_id is not null then
      return jsonb_build_object('ok',true,'code','SUPPORT_OCCURRENCE_ALREADY_REGISTERED','notice_id',p_notice_id,'occurrence_id',existing_id);
    end if;
  end if;

  insert into public.support_notice_occurrences(
    notice_id,source_id,source_notice_id,source_url,raw_title,duplicate_candidate
  ) values (
    p_notice_id,p_source_id,nullif(btrim(coalesce(p_source_notice_id,'')),''),btrim(p_source_url),
    nullif(btrim(coalesce(p_raw_title,'')),''),false
  ) returning id into occurrence_id;

  perform public.private_append_audit(
    actor_id,'support_occurrence_attached','support_notice',p_notice_id::text,'success',
    '기존 지원사업 공고에 새 정보원 출처 연결',
    jsonb_build_object('source_id',p_source_id,'occurrence_id',occurrence_id)
  );

  return jsonb_build_object('ok',true,'code','SUPPORT_OCCURRENCE_ATTACHED','notice_id',p_notice_id,'occurrence_id',occurrence_id);
end;
$$;

create or replace function public.support_mark_occurrence_duplicate_candidate(p_occurrence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  notice_id uuid;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='SUPPORT_DUPLICATE_MARK_FORBIDDEN';
  end if;

  update public.support_notice_occurrences
  set duplicate_candidate=true
  where id=p_occurrence_id
  returning support_notice_occurrences.notice_id into notice_id;
  if notice_id is null then raise exception using errcode='P0002', message='SUPPORT_OCCURRENCE_NOT_FOUND'; end if;

  perform public.private_append_audit(
    actor_id,'support_duplicate_candidate_marked','support_notice',notice_id::text,'success',
    '교차 정보원 중복후보로 표시',jsonb_build_object('occurrence_id',p_occurrence_id)
  );

  return jsonb_build_object('ok',true,'code','SUPPORT_DUPLICATE_CANDIDATE_MARKED','notice_id',notice_id);
end;
$$;

revoke all on function public.support_normalize_notice_title(text) from public, anon;
revoke all on function public.support_find_duplicate_candidates(text,timestamptz,text) from public, anon;
revoke all on function public.support_attach_notice_occurrence(uuid,uuid,text,text,text) from public, anon;
revoke all on function public.support_mark_occurrence_duplicate_candidate(uuid) from public, anon;
grant execute on function public.support_find_duplicate_candidates(text,timestamptz,text) to authenticated;
grant execute on function public.support_attach_notice_occurrence(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.support_mark_occurrence_duplicate_candidate(uuid) to authenticated;

comment on function public.support_find_duplicate_candidates(text,timestamptz,text) is
  'Conservative cross-source duplicate suggestion. Matching does not mutate or merge canonical notices.';

commit;
