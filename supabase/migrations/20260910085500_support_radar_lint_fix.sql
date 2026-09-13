-- Support Radar Phase 1 lint fix.
-- Disambiguates PL/pgSQL variables from support_evaluations.company_profile_id.

begin;

create or replace function public.support_get_alert_candidates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  current_company_profile_id uuid;
  result jsonb;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo')) then
    raise exception using errcode='42501', message='SUPPORT_ALERT_LIST_FORBIDDEN';
  end if;

  select cp.id into current_company_profile_id
  from public.support_company_profiles cp
  where cp.is_current
  order by cp.version desc
  limit 1;

  if current_company_profile_id is null then
    return jsonb_build_object('ok',true,'profile_required',true,'items','[]'::jsonb);
  end if;

  with latest_evaluation as (
    select distinct on (e.notice_id)
      e.notice_id,
      e.overall_score,
      e.strategic_fit_score,
      e.hard_gate,
      e.recommended_application_mode,
      e.recommendation,
      e.confidence,
      e.evaluated_at
    from public.support_evaluations e
    where e.company_profile_id=current_company_profile_id
    order by e.notice_id, e.evaluated_at desc
  ), facts as (
    select
      n.id,
      n.title,
      coalesce(n.implementing_organization,n.managing_organization) organization,
      n.deadline_at,
      n.cash_support_max,
      n.cash_support_min,
      n.in_kind_available,
      n.categories,
      e.overall_score,
      e.strategic_fit_score,
      e.hard_gate,
      e.recommended_application_mode,
      e.recommendation,
      e.confidence,
      coalesce(f.rare_national_opportunity,false) rare_national_opportunity,
      coalesce(f.force_alert,false) force_alert,
      f.note priority_note,
      array_remove(array[
        case when e.overall_score >= 85 then 'score_85' end,
        case when greatest(coalesce(n.cash_support_max,0),coalesce(n.cash_support_min,0)) >= 5000000 then 'amount_5m' end,
        case when n.in_kind_available and (
          n.title ilike '%차량%' or n.title ilike '%시설%' or n.title ilike '%장비%'
          or n.categories::text ilike '%차량%' or n.categories::text ilike '%시설%' or n.categories::text ilike '%장비%'
        ) then 'in_kind_vehicle_facility_equipment' end,
        case when (
          n.categories::text ilike '%고용%' or n.categories::text ilike '%근로%'
          or n.categories::text ilike '%문화%' or n.categories::text ilike '%원예%'
          or n.categories::text ilike '%AI%' or n.categories::text ilike '%디지털%'
        ) then 'priority_domain' end,
        case when n.deadline_at is not null and n.deadline_at >= now() and n.deadline_at <= now()+interval '7 days' then 'deadline_7' end,
        case when coalesce(f.rare_national_opportunity,false) then 'rare_national' end,
        case when coalesce(f.force_alert,false) then 'manual_priority' end
      ]::text[],null) trigger_reasons
    from public.support_notices n
    join latest_evaluation e on e.notice_id=n.id
    left join public.support_notice_priority_flags f on f.notice_id=n.id
    where n.archived_at is null
      and n.notice_status in ('open','upcoming','unknown')
      and (n.deadline_at is null or n.deadline_at >= now())
      and e.hard_gate <> 'fail'
      and e.recommended_application_mode <> 'none'
      and public.support_can_view_notice(n.id)
  ), filtered as (
    select *
    from facts
    where cardinality(trigger_reasons)>0
      and (
        force_alert
        or rare_national_opportunity
        or overall_score>=85
        or strategic_fit_score>=6
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'notice_id',id,
    'title',title,
    'organization',organization,
    'deadline_at',deadline_at,
    'cash_support_max',cash_support_max,
    'cash_support_min',cash_support_min,
    'in_kind_available',in_kind_available,
    'categories',categories,
    'score',overall_score,
    'strategic_fit_score',strategic_fit_score,
    'hard_gate',hard_gate,
    'application_mode',recommended_application_mode,
    'recommendation',recommendation,
    'confidence',confidence,
    'trigger_reasons',to_jsonb(trigger_reasons),
    'rare_national_opportunity',rare_national_opportunity,
    'manual_priority',force_alert,
    'priority_note',priority_note
  ) order by
    case when force_alert then 0 when rare_national_opportunity then 1 when overall_score>=85 then 2 else 3 end,
    overall_score desc,
    deadline_at nulls last
  ),'[]'::jsonb) into result
  from filtered;

  return jsonb_build_object('ok',true,'profile_required',false,'items',result);
end;
$$;

create or replace function public.support_get_kpis()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  current_company_profile_id uuid;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo')) then
    raise exception using errcode='42501', message='SUPPORT_KPI_FORBIDDEN';
  end if;

  select cp.id into current_company_profile_id
  from public.support_company_profiles cp
  where cp.is_current
  order by cp.version desc
  limit 1;

  return jsonb_build_object(
    'ok',true,
    'profile_required',current_company_profile_id is null,
    'eligible_notice_count',case when current_company_profile_id is null then 0 else (
      with latest as (
        select distinct on (e.notice_id) e.notice_id,e.hard_gate,e.recommended_application_mode
        from public.support_evaluations e
        where e.company_profile_id=current_company_profile_id
        order by e.notice_id,e.evaluated_at desc
      )
      select count(*) from latest
      where hard_gate in ('pass','conditional') and recommended_application_mode<>'none'
    ) end,
    'application_count',(select count(*) from public.support_applications),
    'selected_count',(select count(*) from public.support_applications a where a.status='selected'),
    'actual_cash_total',(select coalesce(sum(a.actual_cash_benefit),0) from public.support_applications a where a.status='selected'),
    'actual_in_kind_total',(select coalesce(sum(a.actual_in_kind_value),0) from public.support_applications a where a.status='selected'),
    'missed_important_count',case when current_company_profile_id is null then 0 else (
      with latest as (
        select distinct on (e.notice_id) e.notice_id,e.overall_score,e.hard_gate,e.recommended_application_mode
        from public.support_evaluations e
        where e.company_profile_id=current_company_profile_id
        order by e.notice_id,e.evaluated_at desc
      )
      select count(*)
      from public.support_notices n
      join latest e on e.notice_id=n.id
      where n.archived_at is null
        and n.deadline_at is not null and n.deadline_at<now()
        and e.overall_score>=85 and e.hard_gate<>'fail' and e.recommended_application_mode<>'none'
        and not exists(select 1 from public.support_applications a where a.notice_id=n.id)
    ) end,
    'important_unreviewed_count',case when current_company_profile_id is null then 0 else (
      with latest as (
        select distinct on (e.notice_id) e.notice_id,e.overall_score,e.hard_gate,e.recommended_application_mode
        from public.support_evaluations e
        where e.company_profile_id=current_company_profile_id
        order by e.notice_id,e.evaluated_at desc
      )
      select count(*)
      from public.support_notices n
      join latest e on e.notice_id=n.id
      where n.archived_at is null
        and (n.deadline_at is null or n.deadline_at>=now())
        and e.overall_score>=85 and e.hard_gate<>'fail' and e.recommended_application_mode<>'none'
        and not exists(select 1 from public.support_notice_reviews r where r.notice_id=n.id)
    ) end,
    'average_hours_discovery_to_first_review',(
      select round(avg(extract(epoch from (x.first_reviewed_at-n.first_discovered_at))/3600)::numeric,1)
      from public.support_notices n
      join (
        select review.notice_id,min(review.reviewed_at) first_reviewed_at
        from public.support_notice_reviews review
        group by review.notice_id
      ) x on x.notice_id=n.id
      where x.first_reviewed_at>=n.first_discovered_at
    )
  );
end;
$$;

revoke all on function public.support_get_alert_candidates() from public, anon;
revoke all on function public.support_get_kpis() from public, anon;
grant execute on function public.support_get_alert_candidates() to authenticated;
grant execute on function public.support_get_kpis() to authenticated;

commit;
