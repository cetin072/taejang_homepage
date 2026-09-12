-- Issue #182: keep operator UX lightweight by exposing statutory preview in the existing month context.
-- No new browser input flow or payroll result table is introduced.
begin;

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
  basis_json jsonb := null;
  result jsonb;
begin
  if p_payroll_month is null
     or date_trunc('month', p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;

  if actor_id is null or not public.private_payroll_operator_allowed() then
    perform public.private_append_audit(
      actor_id,'payroll_month_access_denied','payroll_month',p_payroll_month::text,
      'denied','급여월 접근 권한 없음',jsonb_build_object('payroll_month', p_payroll_month)
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
      'payroll_basis',null,
      'employees','[]'::jsonb,
      'carryover',jsonb_build_object('incoming_count',0,'outgoing_count',0),
      'accounting',null
    );
    perform public.private_append_audit(
      actor_id,'payroll_month_viewed','payroll_month',p_payroll_month::text,
      'success','급여월 운영화면 열람',jsonb_build_object('payroll_month', p_payroll_month)
    );
    return result;
  end if;

  if month_row.latest_run_id is not null then
    select * into run_row
    from public.payroll_calculation_runs
    where id = month_row.latest_run_id and payroll_month_id = month_row.id;
    if not found then raise exception using errcode='55000', message='PAYROLL_LATEST_RUN_INTEGRITY_ERROR'; end if;

    basis_json := public.private_current_payroll_basis(month_row.id,run_row.id);

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
          'rate_status',r.rate_status,
          'statutory_status',r.calculation_detail #>> '{statutory,status}',
          'national_pension_preview',nullif(r.calculation_detail #>> '{statutory,nps}','')::numeric,
          'health_insurance_preview',nullif(r.calculation_detail #>> '{statutory,nhi}','')::numeric,
          'long_term_care_preview',nullif(r.calculation_detail #>> '{statutory,ltc}','')::numeric,
          'employment_insurance_preview',nullif(r.calculation_detail #>> '{statutory,ei}','')::numeric,
          'statutory_deduction_preview',nullif(r.calculation_detail #>> '{statutory,total}','')::numeric,
          'net_pay_preview',nullif(r.calculation_detail #>> '{statutory,net}','')::numeric
        ) order by e.employee_id
      ),'[]'::jsonb
    ) into employees_json
    from public.payroll_employee_results r
    join public.employees e on e.id=r.employee_uuid
    join public.people p on p.id=e.person_id
    where r.run_id=run_row.id;
  end if;

  select jsonb_build_object(
    'comparison_id',c.id,
    'run_id',c.run_id,
    'payroll_basis_fingerprint',c.payroll_basis_fingerprint,
    'adjusted_gross_basis',c.adjusted_gross_basis,
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
          where ca.adjustment_id=a.id and ca.applied_run_id=month_row.latest_run_id
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
    'payroll_basis',basis_json,
    'employees',employees_json,
    'carryover',coalesce(carryover_json,'{}'::jsonb),
    'accounting',accounting_json
  );

  perform public.private_append_audit(
    actor_id,'payroll_month_viewed','payroll_month',month_row.id::text,'success',
    '급여월 운영화면 열람',jsonb_build_object('payroll_month',p_payroll_month,'run_id',month_row.latest_run_id)
  );
  return result;
end;
$$;

revoke all on function public.get_payroll_operator_month_context(date) from public, anon, authenticated;
grant execute on function public.get_payroll_operator_month_context(date) to authenticated;

comment on function public.get_payroll_operator_month_context(date) is
  'Existing operator month context enriched with compact statutory deduction and net-pay previews from persisted calculation_detail; no additional operator input flow.';

commit;
