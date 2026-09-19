-- Issue #255: read-only individual payslip draft built only from the latest
-- persisted payroll calculation result.  It never recalculates, pays, remits,
-- locks a month, or exposes raw attendance clocks.
begin;

create or replace function public.get_payroll_employee_payslip_draft(
  p_payroll_month date,
  p_employee_uuid uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  month_row public.payroll_months%rowtype;
  run_row public.payroll_calculation_runs%rowtype;
  result_row public.payroll_employee_results%rowtype;
  employee_id text;
  display_name text;
  statutory jsonb;
  statutory_status text;
  review_reasons jsonb := '[]'::jsonb;
  weekly_hours numeric(10,2);
  weekly_pay numeric(14,2);
  base_pay numeric(14,2);
  draft_status text;
begin
  if p_payroll_month is null
     or date_trunc('month', p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode = '22023', message = 'INVALID_PAYROLL_MONTH';
  end if;
  if p_employee_uuid is null then
    raise exception using errcode = '22023', message = 'PAYROLL_EMPLOYEE_REQUIRED';
  end if;
  if actor_id is null or not public.private_payroll_operator_allowed() then
    perform public.private_append_audit(
      actor_id, 'payroll_payslip_draft_access_denied', 'payroll_month', p_payroll_month::text,
      'denied', '개인 급여명세서 초안 접근 권한 없음',
      jsonb_build_object('payroll_month', p_payroll_month)
    );
    raise exception using errcode = '42501', message = 'PAYROLL_ACCESS_FORBIDDEN';
  end if;

  select * into month_row from public.payroll_months where payroll_month = p_payroll_month;
  if not found then raise exception using errcode = '22023', message = 'PAYROLL_MONTH_NOT_FOUND'; end if;
  if month_row.latest_run_id is null then
    raise exception using errcode = '55000', message = 'PAYROLL_DRAFT_RUN_REQUIRED';
  end if;
  select * into run_row from public.payroll_calculation_runs
  where id = month_row.latest_run_id and payroll_month_id = month_row.id;
  if not found then raise exception using errcode = '55000', message = 'PAYROLL_LATEST_RUN_INTEGRITY_ERROR'; end if;

  select * into result_row
  from public.payroll_employee_results
  where run_id = run_row.id and employee_uuid = p_employee_uuid;
  if not found then raise exception using errcode = '22023', message = 'PAYROLL_EMPLOYEE_RESULT_NOT_FOUND'; end if;

  select e.employee_id, p.full_name into employee_id, display_name
  from public.employees e
  join public.people p on p.id = e.person_id
  where e.id = result_row.employee_uuid;
  if not found then raise exception using errcode = '55000', message = 'PAYROLL_EMPLOYEE_IDENTITY_INTEGRITY_ERROR'; end if;

  statutory := coalesce(result_row.calculation_detail -> 'statutory', '{}'::jsonb);
  statutory_status := coalesce(statutory ->> 'status', 'review_required');
  weekly_hours := coalesce(result_row.weekly_holiday_actual_hours, 0)
    + coalesce(result_row.weekly_holiday_expected_hours, 0);
  weekly_pay := case
    when result_row.rate_status = 'single_rate'
      and result_row.hourly_rate is not null
      and result_row.gross_pay_preview is not null
    then round(weekly_hours * result_row.hourly_rate, 2)
    else null
  end;
  base_pay := case
    when result_row.gross_pay_preview is null then null
    when weekly_pay is null then result_row.gross_pay_preview
    else result_row.gross_pay_preview - weekly_pay
  end;

  if result_row.unresolved_count > 0 then
    review_reasons := review_reasons || jsonb_build_array('unresolved_attendance');
  end if;
  if result_row.weekly_holiday_pending_weeks > 0 then
    review_reasons := review_reasons || jsonb_build_array('weekly_holiday_pending');
  end if;
  if result_row.rate_status not in ('single_rate', 'monthly_salary') then
    review_reasons := review_reasons || jsonb_build_array('rate_review_required');
  end if;
  if result_row.gross_pay_preview is null then
    review_reasons := review_reasons || jsonb_build_array('gross_pay_review_required');
  end if;
  if statutory_status <> 'complete' then
    review_reasons := review_reasons || jsonb_build_array('statutory_deduction_review_required');
  end if;
  draft_status := case when jsonb_array_length(review_reasons) = 0 then 'draft_ready' else 'review_required' end;

  perform public.private_append_audit(
    actor_id, 'payroll_payslip_draft_viewed', 'payroll_employee_result', result_row.id::text,
    'success', '개인 급여명세서 초안 열람',
    jsonb_build_object(
      'payroll_month', p_payroll_month,
      'run_id', run_row.id,
      'employee_uuid', result_row.employee_uuid,
      'draft_status', draft_status
    )
  );

  return jsonb_build_object(
    'kind', 'payslip_draft',
    'payroll_month', p_payroll_month,
    'status', draft_status,
    'review_reasons', review_reasons,
    'run', jsonb_build_object(
      'id', run_row.id,
      'generated_at', run_row.generated_at,
      'calculation_version', run_row.calculation_version,
      'cutoff_date', run_row.cutoff_date
    ),
    'employee', jsonb_build_object('employee_uuid', result_row.employee_uuid, 'employee_id', employee_id, 'display_name', display_name),
    'work_summary', jsonb_build_object(
      'actual_work_hours', result_row.actual_work_hours,
      'expected_work_hours', result_row.expected_work_hours,
      'paid_holiday_hours', result_row.paid_holiday_hours,
      'weekly_holiday_hours', weekly_hours,
      'payable_hours_preview', result_row.payable_hours_preview
    ),
    'earnings', jsonb_build_array(
      jsonb_build_object('code', 'base_pay_preview', 'label', case when result_row.rate_status = 'monthly_salary' then '월 급여 가안' else '기본급 가안' end, 'amount', base_pay),
      jsonb_build_object('code', 'weekly_holiday_pay_preview', 'label', '주휴수당 가안', 'amount', weekly_pay),
      jsonb_build_object('code', 'gross_pay_preview', 'label', '총지급 가안', 'amount', result_row.gross_pay_preview)
    ),
    'deductions', jsonb_build_array(
      jsonb_build_object('code', 'national_pension', 'label', '국민연금 가안', 'amount', nullif(statutory ->> 'nps', '')::numeric),
      jsonb_build_object('code', 'health_insurance', 'label', '건강보험 가안', 'amount', nullif(statutory ->> 'nhi', '')::numeric),
      jsonb_build_object('code', 'long_term_care', 'label', '장기요양보험 가안', 'amount', nullif(statutory ->> 'ltc', '')::numeric),
      jsonb_build_object('code', 'employment_insurance', 'label', '고용보험 가안', 'amount', nullif(statutory ->> 'ei', '')::numeric)
    ),
    'totals', jsonb_build_object(
      'gross_pay_preview', result_row.gross_pay_preview,
      'statutory_deduction_preview', nullif(statutory ->> 'total', '')::numeric,
      'net_pay_preview', case when statutory_status = 'complete' then nullif(statutory ->> 'net', '')::numeric else null end
    ),
    'notice', '급여명세서 초안입니다. 재계산·발송·지급·송금·세금 또는 보험 신고를 수행하지 않습니다.'
  );
end;
$$;

revoke all on function public.get_payroll_employee_payslip_draft(date, uuid) from public, anon;
grant execute on function public.get_payroll_employee_payslip_draft(date, uuid) to authenticated;

comment on function public.get_payroll_employee_payslip_draft(date, uuid) is
  'Issue #255: capability-guarded read-only individual payslip draft from the latest persisted payroll result. No calculation, delivery, payment, remittance, tax filing, or month lock.';

commit;
