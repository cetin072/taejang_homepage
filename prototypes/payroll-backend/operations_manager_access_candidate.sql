-- Taejang Payroll Operations-Manager Access Candidate
-- Goal: #142 / PR #143
-- Status: CANDIDATE ONLY. THIS FILE ROLLS BACK AND MUST NOT BE APPLIED TO STAGING/PRODUCTION WITHOUT A SEPARATE APPROVAL.
-- User-approved access model (2026-09-09): operations_manager is the only payroll operator role for the first controlled MVP.
--
-- This candidate assumes the payroll core tables from schema.sql and the existing platform
-- security helpers already exist. It intentionally creates no role, no table policy, no
-- service-role bypass, no payroll mutation RPC, and no Production grant beyond guarded RPC EXECUTE.

begin;

-- Positive authorization predicate for the first payroll MVP.
-- super_admin/ceo/department roles are deliberately NOT OR-ed into this predicate.
create or replace function public.private_payroll_operator_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
     and public.current_user_has_role('operations_manager');
$$;

create or replace function public.private_require_payroll_operator()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not public.private_payroll_operator_allowed() then
    raise exception using errcode='42501', message='PAYROLL_ACCESS_FORBIDDEN';
  end if;
  return actor_id;
end;
$$;

-- Narrow payroll-specific read model. Names are resolved only for an authorized screen
-- and are never copied into payroll result tables.
create or replace function public.get_payroll_operator_month_context(p_payroll_month date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  month_row public.payroll_months%rowtype;
  run_row public.payroll_calculation_runs%rowtype;
  employees_json jsonb := '[]'::jsonb;
  accounting_json jsonb := null;
  carryover_json jsonb := '{}'::jsonb;
  result jsonb;
begin
  if p_payroll_month is null
     or date_trunc('month', p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;

  if actor_id is null or not public.private_payroll_operator_allowed() then
    perform public.private_append_audit(
      actor_id,
      'payroll_month_access_denied',
      'payroll_month',
      p_payroll_month::text,
      'denied',
      '급여월 접근 권한 없음',
      jsonb_build_object('payroll_month', p_payroll_month)
    );
    raise exception using errcode='42501', message='PAYROLL_ACCESS_FORBIDDEN';
  end if;

  select * into month_row
  from public.payroll_months
  where payroll_month = p_payroll_month;

  if not found then
    result := jsonb_build_object(
      'access_level','operations_manager',
      'payroll_month',p_payroll_month,
      'month_status','not_started',
      'month',null,
      'latest_run',null,
      'employees','[]'::jsonb,
      'carryover',jsonb_build_object('incoming_count',0,'outgoing_count',0),
      'accounting',null
    );

    perform public.private_append_audit(
      actor_id,
      'payroll_month_viewed',
      'payroll_month',
      p_payroll_month::text,
      'success',
      '급여월 운영화면 열람',
      jsonb_build_object('payroll_month', p_payroll_month)
    );

    return result;
  end if;

  if month_row.latest_run_id is not null then
    select * into run_row
    from public.payroll_calculation_runs
    where id = month_row.latest_run_id
      and payroll_month_id = month_row.id;

    if not found then
      raise exception using errcode='55000', message='PAYROLL_LATEST_RUN_INTEGRITY_ERROR';
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'employee_uuid',e.id,
          'employee_id',e.employee_id,
          'display_name',p.full_name,
          'hired_on',e.hired_on,
          'departed_on',e.departed_on,
          'employment_status',e.employment_status,
          'actual_work_hours',r.actual_work_hours,
          'expected_work_hours',r.expected_work_hours,
          'paid_holiday_hours',r.paid_holiday_hours,
          'weekly_holiday_actual_hours',r.weekly_holiday_actual_hours,
          'weekly_holiday_expected_hours',r.weekly_holiday_expected_hours,
          'weekly_holiday_pending_weeks',r.weekly_holiday_pending_weeks,
          'unresolved_count',r.unresolved_count,
          'payable_hours_preview',r.payable_hours_preview,
          'hourly_rate',r.hourly_rate,
          'gross_pay_preview',r.gross_pay_preview,
          'rate_status',r.rate_status
        )
        order by e.employee_id
      ),
      '[]'::jsonb
    ) into employees_json
    from public.payroll_employee_results r
    join public.employees e on e.id=r.employee_uuid
    join public.people p on p.id=e.person_id
    where r.run_id=run_row.id;
  end if;

  select jsonb_build_object(
    'comparison_id',c.id,
    'run_id',c.run_id,
    'confirmed',c.confirmed,
    'stale',c.stale,
    'difference_count',c.difference_count,
    'updated_at',c.updated_at
  ) into accounting_json
  from public.payroll_accounting_comparisons c
  where c.payroll_month_id=month_row.id;

  select jsonb_build_object(
    'incoming_count',count(*) filter (where a.target_month=p_payroll_month and a.status<>'cancelled'),
    'incoming_unapplied_count',count(*) filter (
      where a.target_month=p_payroll_month
        and a.status<>'cancelled'
        and not exists (
          select 1 from public.payroll_carryover_applications ca
          where ca.adjustment_id=a.id
            and ca.applied_run_id=month_row.latest_run_id
        )
    ),
    'outgoing_count',count(*) filter (where a.source_month=p_payroll_month and a.status<>'cancelled'),
    'outgoing_pending_review_count',count(*) filter (
      where a.source_month=p_payroll_month and a.status='pending_next_month'
    )
  ) into carryover_json
  from public.payroll_adjustments a
  where a.source_month=p_payroll_month or a.target_month=p_payroll_month;

  result := jsonb_build_object(
    'access_level','operations_manager',
    'payroll_month',p_payroll_month,
    'month_status',month_row.status,
    'month',jsonb_build_object(
      'id',month_row.id,
      'status',month_row.status,
      'cutoff_date',month_row.cutoff_date,
      'unresolved_important_exceptions',month_row.unresolved_important_exceptions,
      'locked_at',month_row.locked_at,
      'latest_run_id',month_row.latest_run_id
    ),
    'latest_run',case when month_row.latest_run_id is null then null else jsonb_build_object(
      'id',run_row.id,
      'calculation_version',run_row.calculation_version,
      'cutoff_date',run_row.cutoff_date,
      'generated_at',run_row.generated_at,
      'employee_count',run_row.employee_count,
      'unresolved_item_count',run_row.unresolved_item_count,
      'rate_review_count',run_row.rate_review_count,
      'gross_pay_preview',run_row.gross_pay_preview,
      'gross_pay_preview_status',run_row.gross_pay_preview_status,
      'payable_hours_preview',run_row.payable_hours_preview
    ) end,
    'employees',employees_json,
    'carryover',coalesce(carryover_json,'{}'::jsonb),
    'accounting',accounting_json
  );

  -- Generic audit intentionally stores no employee names, payroll amounts, deductions,
  -- attendance raw values, or other payroll payloads.
  perform public.private_append_audit(
    actor_id,
    'payroll_month_viewed',
    'payroll_month',
    month_row.id::text,
    'success',
    '급여월 운영화면 열람',
    jsonb_build_object(
      'payroll_month',p_payroll_month,
      'run_id',month_row.latest_run_id
    )
  );

  return result;
end;
$$;

-- Keep tables fail-closed. The browser never receives table privileges.
revoke all on
  public.payroll_employment_terms,
  public.payroll_holidays,
  public.payroll_months,
  public.payroll_calculation_runs,
  public.payroll_employee_results,
  public.payroll_adjustments,
  public.payroll_carryover_applications,
  public.payroll_accounting_comparisons,
  public.payroll_accounting_difference_rows
from public, anon, authenticated;

revoke all on function public.private_payroll_operator_allowed() from public, anon, authenticated;
revoke all on function public.private_require_payroll_operator() from public, anon, authenticated;
revoke all on function public.get_payroll_operator_month_context(date) from public, anon, authenticated;

-- authenticated may reach the guarded RPC, but authorization is rechecked inside the RPC.
grant execute on function public.get_payroll_operator_month_context(date) to authenticated;

-- Intentionally absent from this candidate:
-- - any CREATE ROLE / payroll_operator role
-- - any payroll table SELECT/INSERT/UPDATE/DELETE grant
-- - any payroll table RLS allow policy
-- - any super_admin or ceo payroll bypass
-- - any state-changing payroll RPC
-- - any service-role bypass
-- - any actual month lock/payment/retroactive payment execution

rollback;
