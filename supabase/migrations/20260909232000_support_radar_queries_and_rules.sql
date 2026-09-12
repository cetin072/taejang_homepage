-- Taejang Support Radar Phase 1 queries and deterministic Rule Engine v1.
-- Issue #165 / #167. No external AI or paid API is used here.

begin;

create or replace function public.support_list_sources()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo')) then
    raise exception using errcode='42501', message='SUPPORT_SOURCE_LIST_FORBIDDEN';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(s) order by s.priority, s.name)
    from public.support_sources s
    where s.active
  ), '[]'::jsonb);
end;
$$;

create or replace function public.support_get_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  profile_id uuid;
  open_count integer := 0;
  deadline_count integer := 0;
  application_count integer := 0;
  unreviewed_count integer := 0;
  top_items jsonb := '[]'::jsonb;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo')) then
    raise exception using errcode='42501', message='SUPPORT_DASHBOARD_FORBIDDEN';
  end if;

  select id into profile_id
  from public.support_company_profiles
  where is_current
  order by version desc
  limit 1;

  select count(*)::integer into open_count
  from public.support_notices n
  where n.archived_at is null
    and n.notice_status in ('open','upcoming','unknown')
    and (n.deadline_at is null or n.deadline_at >= now());

  select count(*)::integer into deadline_count
  from public.support_notices n
  where n.archived_at is null
    and n.deadline_at >= now()
    and n.deadline_at <= now() + interval '7 days';

  select count(*)::integer into application_count
  from public.support_applications a
  where a.status not in ('selected','not_selected','cancelled');

  if profile_id is not null then
    select count(*)::integer into unreviewed_count
    from public.support_notices n
    where n.archived_at is null
      and (n.deadline_at is null or n.deadline_at >= now())
      and not exists (
        select 1 from public.support_evaluations e
        where e.notice_id=n.id and e.company_profile_id=profile_id
      );

    select coalesce(jsonb_agg(item order by (item->>'score')::integer desc, item->>'deadline'), '[]'::jsonb)
    into top_items
    from (
      select jsonb_build_object(
        'notice_id', n.id,
        'title', n.title,
        'organization', coalesce(n.implementing_organization,n.managing_organization),
        'deadline', n.deadline_at,
        'score', e.overall_score,
        'hard_gate', e.hard_gate,
        'application_mode', e.recommended_application_mode,
        'recommendation', e.recommendation,
        'confidence', e.confidence,
        'cash_support_max', n.cash_support_max,
        'in_kind_available', n.in_kind_available
      ) item
      from public.support_notices n
      join lateral (
        select x.* from public.support_evaluations x
        where x.notice_id=n.id and x.company_profile_id=profile_id
        order by x.evaluated_at desc limit 1
      ) e on true
      where n.archived_at is null
        and (n.deadline_at is null or n.deadline_at >= now())
      order by e.overall_score desc, n.deadline_at nulls last
      limit 5
    ) ranked;
  end if;

  return jsonb_build_object(
    'ok',true,
    'profile_required',profile_id is null,
    'open_count',open_count,
    'deadline_7_count',deadline_count,
    'application_count',application_count,
    'unreviewed_count',unreviewed_count,
    'top_items',top_items
  );
end;
$$;

create or replace function public.support_list_notices(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  profile_id uuid;
  safe_limit integer := least(greatest(coalesce(p_limit,100),1),300);
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode='42501', message='SUPPORT_NOTICE_LIST_FORBIDDEN';
  end if;

  select id into profile_id from public.support_company_profiles where is_current order by version desc limit 1;

  return coalesce((
    select jsonb_agg(item order by item_deadline nulls last, item_score desc, item_title)
    from (
      select
        n.deadline_at item_deadline,
        coalesce(e.overall_score,-1) item_score,
        n.title item_title,
        jsonb_build_object(
          'id',n.id,
          'title',n.title,
          'organization',coalesce(n.implementing_organization,n.managing_organization),
          'deadline_at',n.deadline_at,
          'notice_status',n.notice_status,
          'cash_support_max',n.cash_support_max,
          'in_kind_available',n.in_kind_available,
          'categories',n.categories,
          'target_regions',n.target_regions,
          'score',e.overall_score,
          'hard_gate',e.hard_gate,
          'direct_eligibility',e.direct_eligibility,
          'joint_eligibility',e.joint_eligibility,
          'partner_eligibility',e.partner_eligibility,
          'application_mode',e.recommended_application_mode,
          'confidence',e.confidence,
          'recommendation',e.recommendation,
          'decision',d.decision,
          'application_status',a.status,
          'needs_current_profile_evaluation',profile_id is not null and e.id is null
        ) item
      from public.support_notices n
      left join lateral (
        select x.* from public.support_evaluations x
        where x.notice_id=n.id and x.company_profile_id=profile_id
        order by x.evaluated_at desc limit 1
      ) e on true
      left join lateral (
        select x.* from public.support_decisions x where x.notice_id=n.id order by x.decided_at desc limit 1
      ) d on true
      left join public.support_applications a on a.notice_id=n.id
      where n.archived_at is null and public.support_can_view_notice(n.id)
      order by n.deadline_at nulls last, e.overall_score desc nulls last, n.title
      limit safe_limit
    ) rows
  ), '[]'::jsonb);
end;
$$;

create or replace function public.support_get_notice_detail(p_notice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  profile_id uuid;
  notice_json jsonb;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.support_can_view_notice(p_notice_id) then
    raise exception using errcode='42501', message='SUPPORT_NOTICE_DETAIL_FORBIDDEN';
  end if;

  select id into profile_id from public.support_company_profiles where is_current order by version desc limit 1;
  select to_jsonb(n) into notice_json from public.support_notices n where n.id=p_notice_id and n.archived_at is null;
  if notice_json is null then
    raise exception using errcode='P0002', message='SUPPORT_NOTICE_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'ok',true,
    'notice',notice_json,
    'occurrences',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,'source_id',o.source_id,'source_notice_id',o.source_notice_id,'source_url',o.source_url,
        'raw_title',o.raw_title,'discovered_at',o.discovered_at,'last_seen_at',o.last_seen_at,'duplicate_candidate',o.duplicate_candidate
      ) order by o.discovered_at)
      from public.support_notice_occurrences o where o.notice_id=p_notice_id
    ),'[]'::jsonb),
    'documents',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',d.id,'document_type',d.document_type,'original_filename',d.original_filename,'source_url',d.source_url,
        'mime_type',d.mime_type,'parse_status',d.parse_status,'created_at',d.created_at
      ) order by d.created_at)
      from public.support_documents d where d.notice_id=p_notice_id
    ),'[]'::jsonb),
    'evaluation',(
      select to_jsonb(e) from public.support_evaluations e
      where e.notice_id=p_notice_id and e.company_profile_id=profile_id
      order by e.evaluated_at desc limit 1
    ),
    'decision',(
      select to_jsonb(d) from public.support_decisions d where d.notice_id=p_notice_id order by d.decided_at desc limit 1
    ),
    'application',(
      select to_jsonb(a) from public.support_applications a where a.notice_id=p_notice_id
    ),
    'assignments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'profile_id',a.profile_id,'display_name',p.display_name,'assigned_at',a.assigned_at,'note',a.note
      ) order by a.assigned_at)
      from public.support_assignments a
      join public.profiles p on p.id=a.profile_id
      where a.notice_id=p_notice_id and a.unassigned_at is null
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.support_evaluate_notice_v1(p_notice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  n public.support_notices%rowtype;
  cp public.support_company_profiles%rowtype;
  evaluation_id uuid;
  next_version integer;
  eligibility_text text;
  haystack text;
  region_item jsonb;
  region_text text;
  region_specified boolean := false;
  region_match boolean := false;
  has_sme boolean := false;
  needs_sme boolean := false;
  nonprofit_only boolean := false;
  agricultural_match boolean := false;
  standard_workplace_match boolean := false;
  days_left integer;
  eligibility_score integer := 0;
  strategic_score integer := 0;
  economic_score integer := 0;
  execution_score integer := 0;
  selection_score integer := 5;
  urgency_score integer := 0;
  overall integer := 0;
  hard_gate text := 'verify';
  direct_status text := 'verify';
  joint_status text := 'verify';
  partner_status text := 'verify';
  recommended_mode text := 'verify';
  recommendation_text text;
  recommendation_reason text;
  confidence_text text := 'low';
  gaps jsonb := '[]'::jsonb;
  questions jsonb := '[]'::jsonb;
  evidence_items jsonb := '[]'::jsonb;
  area record;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='SUPPORT_EVALUATE_FORBIDDEN';
  end if;

  select * into n from public.support_notices where id=p_notice_id and archived_at is null;
  if n.id is null then raise exception using errcode='P0002', message='SUPPORT_NOTICE_NOT_FOUND'; end if;
  select * into cp from public.support_company_profiles where is_current order by version desc limit 1;
  if cp.id is null then raise exception using errcode='22023', message='SUPPORT_COMPANY_PROFILE_REQUIRED'; end if;

  eligibility_text := lower(coalesce(n.eligibility_summary,''));
  haystack := lower(concat_ws(' ',n.title,n.managing_organization,n.implementing_organization,n.eligibility_summary,n.categories::text));
  needs_sme := eligibility_text like '%중소기업%' or eligibility_text like '%중소기업확인서%';
  nonprofit_only := eligibility_text like '%비영리%' and eligibility_text not like '%비영리 제외%';
  agricultural_match := cp.agricultural_corporation and (haystack like '%농업회사법인%' or haystack like '%농업법인%' or haystack like '%농업%');
  standard_workplace_match := cp.subsidiary_standard_workplace and (haystack like '%장애인표준사업장%' or haystack like '%장애인 고용%' or haystack like '%장애인고용%');

  select exists (
    select 1 from public.support_company_qualifications q
    where q.company_profile_id=cp.id and q.code='sme_confirmation' and q.status='valid'
  ) into has_sme;

  for region_item in select value from jsonb_array_elements(coalesce(n.target_regions,'[]'::jsonb)) loop
    region_text := lower(case when jsonb_typeof(region_item)='string' then region_item #>> '{}' else region_item::text end);
    if nullif(btrim(region_text),'') is not null then region_specified := true; end if;
    if region_text like '%전국%' or region_text like '%경상남도%' or region_text like '%경남%' or region_text like '%창원%' or region_text like '%마산합포%' or region_text like '%의창%' or region_text like '%진전%' then
      region_match := true;
    end if;
  end loop;
  if not region_specified then region_match := true; end if;

  if n.deadline_at is not null then
    days_left := floor(extract(epoch from (n.deadline_at-now()))/86400)::integer;
  end if;

  -- Eligibility: region contributes 15, known legal/qualification facts contribute 15.
  if region_match then
    eligibility_score := eligibility_score + 15;
    evidence_items := evidence_items || jsonb_build_array(jsonb_build_object('type','region','fact','태장 사업장 기준 지역조건 일치 또는 전국/미지정'));
  else
    gaps := gaps || jsonb_build_array(jsonb_build_object('code','region_mismatch','label','태장 현재 사업장 지역과 공고 대상지역 불일치'));
  end if;

  if needs_sme and not has_sme then
    eligibility_score := eligibility_score + 5;
    gaps := gaps || jsonb_build_array(jsonb_build_object('code','sme_confirmation','label','중소기업확인서 현재 미보유'));
    questions := questions || jsonb_build_array('중소기업확인서가 필수 제출서류인지 확인');
  elsif agricultural_match or standard_workplace_match then
    eligibility_score := eligibility_score + 15;
    evidence_items := evidence_items || jsonb_build_array(jsonb_build_object('type','company_profile','fact','태장 보유 기업특성과 공고 분야가 일치'));
  elsif nullif(eligibility_text,'') is not null then
    eligibility_score := eligibility_score + 10;
  else
    eligibility_score := eligibility_score + 7;
    questions := questions || jsonb_build_array('신청자격 원문을 확인');
  end if;

  -- Strategic relevance: current business areas are weighted by their priority.
  for area in
    select name,priority from public.support_company_business_areas
    where company_profile_id=cp.id and active
  loop
    if haystack like '%' || lower(area.name) || '%' then
      strategic_score := least(20, strategic_score + case area.priority when 'highest' then 6 when 'high' then 4 else 3 end);
    end if;
  end loop;
  if strategic_score=0 and (agricultural_match or standard_workplace_match) then strategic_score := 8; end if;
  if strategic_score=0 then strategic_score := 3; end if;

  -- Economic value.
  if coalesce(n.cash_support_max,n.cash_support_min,0) >= 100000000 then economic_score := 15;
  elsif coalesce(n.cash_support_max,n.cash_support_min,0) >= 50000000 then economic_score := 13;
  elsif coalesce(n.cash_support_max,n.cash_support_min,0) >= 5000000 then economic_score := 10;
  elsif coalesce(n.cash_support_max,n.cash_support_min,0) > 0 then economic_score := 7;
  else economic_score := 3;
  end if;
  if n.in_kind_available then economic_score := least(15,economic_score+5); end if;

  -- Execution feasibility and urgency.
  if days_left is null then execution_score := 8; urgency_score := 3;
  elsif days_left > 30 then execution_score := 15; urgency_score := 2;
  elsif days_left >= 15 then execution_score := 12; urgency_score := 4;
  elsif days_left >= 8 then execution_score := 10; urgency_score := 7;
  elsif days_left >= 1 then execution_score := 6; urgency_score := 10;
  else execution_score := 0; urgency_score := 0;
  end if;

  if coalesce(n.self_funding_rate,0) >= 50 then execution_score := greatest(0,execution_score-5);
  elsif coalesce(n.self_funding_rate,0) >= 30 then execution_score := greatest(0,execution_score-3);
  elsif coalesce(n.self_funding_rate,0) >= 10 then execution_score := greatest(0,execution_score-1);
  end if;

  if region_specified and region_match then selection_score := 7; end if;
  if agricultural_match or standard_workplace_match then selection_score := greatest(selection_score,8); end if;

  if n.deadline_at is not null and n.deadline_at < now() or n.notice_status in ('closed','cancelled') then
    hard_gate := 'fail'; direct_status := 'ineligible'; joint_status := 'ineligible'; partner_status := 'ineligible'; recommended_mode := 'none';
    questions := questions || jsonb_build_array('마감 또는 취소 여부 최종 확인');
  elsif nonprofit_only then
    hard_gate := 'conditional'; direct_status := 'ineligible'; joint_status := 'conditional'; partner_status := 'conditional'; recommended_mode := 'partner';
    gaps := gaps || jsonb_build_array(jsonb_build_object('code','nonprofit_requirement','label','태장 직접신청보다 비영리 협력경로 확인 필요'));
    questions := questions || jsonb_build_array('컨소시엄·공동수행기관 참여 허용 여부 확인');
  elsif not region_match then
    hard_gate := 'conditional'; direct_status := 'ineligible'; joint_status := 'conditional'; partner_status := 'conditional'; recommended_mode := 'partner';
    questions := questions || jsonb_build_array('타지역 주관기관과 공동신청 또는 수행기관 참여 가능 여부 확인');
  elsif needs_sme and not has_sme then
    hard_gate := 'conditional'; direct_status := 'conditional'; joint_status := 'verify'; partner_status := 'verify'; recommended_mode := 'direct';
  else
    hard_gate := case when nullif(eligibility_text,'') is null then 'verify' else 'pass' end;
    direct_status := case when nullif(eligibility_text,'') is null then 'verify' else 'eligible' end;
    joint_status := 'verify'; partner_status := 'verify'; recommended_mode := 'direct';
  end if;

  if n.duplicate_support_rule is null then questions := questions || jsonb_build_array('기존 수혜사업과 중복지원 제한 확인'); end if;
  if n.self_funding_required is null then questions := questions || jsonb_build_array('자부담 여부와 비율 확인'); end if;

  overall := least(100,eligibility_score+strategic_score+economic_score+execution_score+selection_score+urgency_score);
  if hard_gate='fail' then overall := least(overall,25); end if;

  recommendation_text := case
    when hard_gate='fail' then '현재 공고는 신청 진행 대상이 아님'
    when overall >= 85 then '우선 검토·신청 추천'
    when overall >= 70 then '검토 가치 높음'
    when overall >= 50 then '조건 확인 후 검토'
    else '우선순위 낮음'
  end;

  recommendation_reason := concat_ws(' · ',
    '자격 '||eligibility_score||'/30',
    '전략연관 '||strategic_score||'/20',
    '경제가치 '||economic_score||'/15',
    '실행가능 '||execution_score||'/15',
    '선정가능 '||selection_score||'/10',
    '시급성 '||urgency_score||'/10'
  );

  confidence_text := case
    when nullif(eligibility_text,'') is not null and region_specified and (agricultural_match or standard_workplace_match) then 'high'
    when nullif(eligibility_text,'') is not null or region_specified then 'medium'
    else 'low'
  end;

  select coalesce(max(evaluation_version),0)+1 into next_version
  from public.support_evaluations
  where notice_id=n.id and company_profile_id=cp.id;

  insert into public.support_evaluations (
    notice_id,company_profile_id,evaluation_version,rule_version,overall_score,
    eligibility_score,strategic_fit_score,economic_value_score,execution_score,selection_score,urgency_score,
    hard_gate,direct_eligibility,joint_eligibility,partner_eligibility,recommended_application_mode,
    recommendation,recommendation_reason,taejang_possible_role,qualification_gaps,questions_to_confirm,next_action,
    confidence,evidence,evaluated_by,evaluated_by_profile_id
  ) values (
    n.id,cp.id,next_version,'support_rule_v1',overall,
    eligibility_score,strategic_score,economic_score,execution_score,selection_score,urgency_score,
    hard_gate,direct_status,joint_status,partner_status,recommended_mode,
    recommendation_text,recommendation_reason,
    case when recommended_mode='partner' then '협력 수행기관 또는 공동사업 파트너 가능성 검토' else '신청기업 또는 사업 수행기업' end,
    gaps,questions,
    case when hard_gate='fail' then '보관 후 차기 유사사업 모니터링' else '공고 원문과 확인질문 검토 후 운영총괄 결정' end,
    confidence_text,evidence_items,'rule',actor_id
  ) returning id into evaluation_id;

  perform public.private_append_audit(
    actor_id,'support_notice_evaluated','support_notice',n.id::text,'success','지원사업 Rule Engine v1 평가',
    jsonb_build_object('evaluation_id',evaluation_id,'profile_id',cp.id,'score',overall,'hard_gate',hard_gate,'application_mode',recommended_mode)
  );

  return jsonb_build_object(
    'ok',true,'code','SUPPORT_NOTICE_EVALUATED','evaluation_id',evaluation_id,'score',overall,
    'hard_gate',hard_gate,'direct_eligibility',direct_status,'joint_eligibility',joint_status,
    'partner_eligibility',partner_status,'application_mode',recommended_mode,'confidence',confidence_text
  );
end;
$$;

revoke all on function public.support_list_sources() from public, anon;
revoke all on function public.support_get_dashboard() from public, anon;
revoke all on function public.support_list_notices(integer) from public, anon;
revoke all on function public.support_get_notice_detail(uuid) from public, anon;
revoke all on function public.support_evaluate_notice_v1(uuid) from public, anon;

grant execute on function public.support_list_sources() to authenticated;
grant execute on function public.support_get_dashboard() to authenticated;
grant execute on function public.support_list_notices(integer) to authenticated;
grant execute on function public.support_get_notice_detail(uuid) to authenticated;
grant execute on function public.support_evaluate_notice_v1(uuid) to authenticated;

comment on function public.support_evaluate_notice_v1(uuid)
is 'Deterministic Taejang suitability Rule Engine v1. It does not replace source evidence or the operations manager decision.';

commit;
