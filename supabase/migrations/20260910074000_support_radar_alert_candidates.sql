-- Taejang Support Radar Phase 1 alert-candidate calculation.
-- This does not send notifications. It exposes a reviewed in-app candidate list.

begin;

create table public.support_notice_priority_flags (
  notice_id uuid primary key references public.support_notices(id) on delete restrict,
  rare_national_opportunity boolean not null default false,
  force_alert boolean not null default false,
  note text check (char_length(coalesce(note, '')) <= 1000),
  updated_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);

alter table public.support_notice_priority_flags enable row level security;

create policy support_notice_priority_flags_scoped_read
on public.support_notice_priority_flags
for select to authenticated
using (public.support_can_view_notice(notice_id));

revoke all on public.support_notice_priority_flags from anon, authenticated;
grant select on public.support_notice_priority_flags to authenticated;

create or replace function public.support_set_notice_priority_flags(
  p_notice_id uuid,
  p_rare_national_opportunity boolean default false,
  p_force_alert boolean default false,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='SUPPORT_PRIORITY_FLAG_FORBIDDEN';
  end if;

  if not exists (
    select 1 from public.support_notices n
    where n.id=p_notice_id and n.archived_at is null
  ) then
    raise exception using errcode='P0002', message='SUPPORT_NOTICE_NOT_FOUND';
  end if;

  insert into public.support_notice_priority_flags (
    notice_id, rare_national_opportunity, force_alert, note, updated_by_profile_id, updated_at
  ) values (
    p_notice_id,
    coalesce(p_rare_national_opportunity,false),
    coalesce(p_force_alert,false),
    nullif(btrim(coalesce(p_note,'')),''),
    actor_id,
    now()
  )
  on conflict (notice_id) do update
  set rare_national_opportunity=excluded.rare_national_opportunity,
      force_alert=excluded.force_alert,
      note=excluded.note,
      updated_by_profile_id=excluded.updated_by_profile_id,
      updated_at=now();

  perform public.private_append_audit(
    actor_id,
    'support_notice_priority_flags_changed',
    'support_notice',
    p_notice_id::text,
    'success',
    '지원사업 중요도 수동 플래그 변경',
    jsonb_build_object(
      'rare_national_opportunity',coalesce(p_rare_national_opportunity,false),
      'force_alert',coalesce(p_force_alert,false)
    )
  );

  return jsonb_build_object('ok',true,'code','SUPPORT_PRIORITY_FLAGS_UPDATED');
end;
$$;

create or replace function public.support_get_alert_candidates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  company_profile_id uuid;
  result jsonb;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo')) then
    raise exception using errcode='42501', message='SUPPORT_ALERT_LIST_FORBIDDEN';
  end if;

  select cp.id into company_profile_id
  from public.support_company_profiles cp
  where cp.is_current
  order by cp.version desc
  limit 1;

  if company_profile_id is null then
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
    where e.company_profile_id=company_profile_id
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

revoke all on function public.support_set_notice_priority_flags(uuid,boolean,boolean,text) from public, anon;
revoke all on function public.support_get_alert_candidates() from public, anon;
grant execute on function public.support_set_notice_priority_flags(uuid,boolean,boolean,text) to authenticated;
grant execute on function public.support_get_alert_candidates() to authenticated;

comment on function public.support_get_alert_candidates() is
  'Phase 1 in-app alert candidates. Trigger facts are filtered by current Taejang rule-engine relevance before display; this function sends no external notification.';

commit;
