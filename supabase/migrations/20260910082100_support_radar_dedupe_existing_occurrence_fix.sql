-- Fix cross-source occurrence attachment idempotency: when a source notice id
-- already exists, return the canonical notice that actually owns that occurrence.

begin;

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
  existing_notice_id uuid;
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
    select o.id,o.notice_id into existing_id,existing_notice_id
    from public.support_notice_occurrences o
    where o.source_id=p_source_id and o.source_notice_id=btrim(p_source_notice_id)
    limit 1;
    if existing_id is not null then
      return jsonb_build_object(
        'ok',true,
        'code','SUPPORT_OCCURRENCE_ALREADY_REGISTERED',
        'notice_id',existing_notice_id,
        'occurrence_id',existing_id
      );
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

revoke all on function public.support_attach_notice_occurrence(uuid,uuid,text,text,text) from public, anon;
grant execute on function public.support_attach_notice_occurrence(uuid,uuid,text,text,text) to authenticated;

commit;
