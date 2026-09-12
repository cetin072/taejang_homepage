-- Taejang Support Radar Phase 1 weekly report query.
-- The same payload can later feed email/Kakao automation without changing core data.

begin;

create or replace function public.support_get_weekly_report(p_as_of date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  dashboard jsonb;
  start_date date := coalesce(p_as_of,current_date)-6;
  new_count integer := 0;
  evaluated_count integer := 0;
  apply_count integer := 0;
  submitted_count integer := 0;
  selected_count integer := 0;
  selected_cash numeric := 0;
  selected_in_kind numeric := 0;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo')) then
    raise exception using errcode='42501', message='SUPPORT_WEEKLY_REPORT_FORBIDDEN';
  end if;

  dashboard := public.support_get_dashboard();

  select count(*)::integer into new_count
  from public.support_notices n
  where n.first_discovered_at::date between start_date and coalesce(p_as_of,current_date);

  select count(*)::integer into evaluated_count
  from public.support_evaluations e
  where e.evaluated_at::date between start_date and coalesce(p_as_of,current_date);

  select count(*)::integer into apply_count
  from public.support_decisions d
  where d.decision='apply' and d.decided_at::date between start_date and coalesce(p_as_of,current_date);

  select count(*)::integer into submitted_count
  from public.support_applications a
  where a.submitted_at is not null and a.submitted_at::date between start_date and coalesce(p_as_of,current_date);

  select count(*)::integer,
         coalesce(sum(a.actual_cash_benefit),0),
         coalesce(sum(a.actual_in_kind_value),0)
  into selected_count, selected_cash, selected_in_kind
  from public.support_applications a
  where a.status='selected'
    and a.result_recorded_at is not null
    and a.result_recorded_at::date between start_date and coalesce(p_as_of,current_date);

  return jsonb_build_object(
    'ok',true,
    'period_start',start_date,
    'period_end',coalesce(p_as_of,current_date),
    'new_notices',new_count,
    'evaluated',evaluated_count,
    'apply_decisions',apply_count,
    'submitted',submitted_count,
    'selected',selected_count,
    'selected_cash',selected_cash,
    'selected_in_kind_value',selected_in_kind,
    'open_count',dashboard->'open_count',
    'deadline_7_count',dashboard->'deadline_7_count',
    'unreviewed_count',dashboard->'unreviewed_count',
    'application_count',dashboard->'application_count',
    'top_items',dashboard->'top_items'
  );
end;
$$;

revoke all on function public.support_get_weekly_report(date) from public, anon;
grant execute on function public.support_get_weekly_report(date) to authenticated;

commit;
