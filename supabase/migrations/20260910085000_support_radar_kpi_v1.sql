-- Support Radar Phase 1 KPI summary.
-- Metrics remain useful when discovery is manual and carry forward to later automatic ingestion.

begin;

create or replace function public.support_get_kpis()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  company_profile_id uuid;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo')) then
    raise exception using errcode='42501', message='SUPPORT_KPI_FORBIDDEN';
  end if;

  select cp.id into company_profile_id
  from public.support_company_profiles cp
  where cp.is_current
  order by cp.version desc
  limit 1;

  return jsonb_build_object(
    'ok',true,
    'profile_required',company_profile_id is null,
    'eligible_notice_count',case when company_profile_id is null then 0 else (
      with latest as (
        select distinct on (e.notice_id) e.notice_id,e.hard_gate,e.recommended_application_mode
        from public.support_evaluations e
        where e.company_profile_id=company_profile_id
        order by e.notice_id,e.evaluated_at desc
      )
      select count(*) from latest
      where hard_gate in ('pass','conditional') and recommended_application_mode<>'none'
    ) end,
    'application_count',(select count(*) from public.support_applications),
    'selected_count',(select count(*) from public.support_applications a where a.status='selected'),
    'actual_cash_total',(select coalesce(sum(a.actual_cash_benefit),0) from public.support_applications a where a.status='selected'),
    'actual_in_kind_total',(select coalesce(sum(a.actual_in_kind_value),0) from public.support_applications a where a.status='selected'),
    'missed_important_count',case when company_profile_id is null then 0 else (
      with latest as (
        select distinct on (e.notice_id) e.notice_id,e.overall_score,e.hard_gate,e.recommended_application_mode
        from public.support_evaluations e
        where e.company_profile_id=company_profile_id
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
    'important_unreviewed_count',case when company_profile_id is null then 0 else (
      with latest as (
        select distinct on (e.notice_id) e.notice_id,e.overall_score,e.hard_gate,e.recommended_application_mode
        from public.support_evaluations e
        where e.company_profile_id=company_profile_id
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
        select notice_id,min(reviewed_at) first_reviewed_at
        from public.support_notice_reviews
        group by notice_id
      ) x on x.notice_id=n.id
      where x.first_reviewed_at>=n.first_discovered_at
    )
  );
end;
$$;

revoke all on function public.support_get_kpis() from public, anon;
grant execute on function public.support_get_kpis() to authenticated;

comment on function public.support_get_kpis() is
  'Support Radar KPI summary: eligible notices, applications, selections, realized support, missed important notices, and discovery-to-review time.';

commit;
